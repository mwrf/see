#include "WebSocketServer.h"

#include <arpa/inet.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cstdio>
#include <cstring>

namespace skypanel {
namespace {

// -- SHA-1, needed only for the WebSocket handshake ---------------------

struct Sha1 {
  uint32_t h[5] = {0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0};

  static uint32_t rol(uint32_t value, int bits) {
    return (value << bits) | (value >> (32 - bits));
  }

  void block(const uint8_t *chunk) {
    uint32_t w[80];
    for (int i = 0; i < 16; ++i) {
      w[i] = (static_cast<uint32_t>(chunk[i * 4]) << 24) |
             (static_cast<uint32_t>(chunk[i * 4 + 1]) << 16) |
             (static_cast<uint32_t>(chunk[i * 4 + 2]) << 8) |
             static_cast<uint32_t>(chunk[i * 4 + 3]);
    }
    for (int i = 16; i < 80; ++i) {
      w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    }

    uint32_t a = h[0];
    uint32_t b = h[1];
    uint32_t c = h[2];
    uint32_t d = h[3];
    uint32_t e = h[4];
    for (int i = 0; i < 80; ++i) {
      uint32_t f = 0;
      uint32_t k = 0;
      if (i < 20) {
        f = (b & c) | ((~b) & d);
        k = 0x5A827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ED9EBA1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8F1BBCDC;
      } else {
        f = b ^ c ^ d;
        k = 0xCA62C1D6;
      }
      const uint32_t temp = rol(a, 5) + f + e + k + w[i];
      e = d;
      d = c;
      c = rol(b, 30);
      b = a;
      a = temp;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
  }

  void digest(const std::string &input, uint8_t out[20]) {
    std::string padded = input;
    const uint64_t bits = static_cast<uint64_t>(input.size()) * 8;
    padded.push_back(static_cast<char>(0x80));
    while (padded.size() % 64 != 56) {
      padded.push_back('\0');
    }
    for (int i = 7; i >= 0; --i) {
      padded.push_back(static_cast<char>((bits >> (i * 8)) & 0xFF));
    }
    for (std::size_t i = 0; i < padded.size(); i += 64) {
      block(reinterpret_cast<const uint8_t *>(padded.data() + i));
    }
    for (int i = 0; i < 5; ++i) {
      out[i * 4] = static_cast<uint8_t>(h[i] >> 24);
      out[i * 4 + 1] = static_cast<uint8_t>(h[i] >> 16);
      out[i * 4 + 2] = static_cast<uint8_t>(h[i] >> 8);
      out[i * 4 + 3] = static_cast<uint8_t>(h[i]);
    }
  }
};

std::string base64(const uint8_t *data, std::size_t length) {
  static const char *kAlphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  for (std::size_t i = 0; i < length; i += 3) {
    const uint32_t a = data[i];
    const uint32_t b = i + 1 < length ? data[i + 1] : 0;
    const uint32_t c = i + 2 < length ? data[i + 2] : 0;
    const uint32_t triple = (a << 16) | (b << 8) | c;
    out.push_back(kAlphabet[(triple >> 18) & 0x3F]);
    out.push_back(kAlphabet[(triple >> 12) & 0x3F]);
    out.push_back(i + 1 < length ? kAlphabet[(triple >> 6) & 0x3F] : '=');
    out.push_back(i + 2 < length ? kAlphabet[triple & 0x3F] : '=');
  }
  return out;
}

void setNonBlocking(int fd) {
  const int flags = fcntl(fd, F_GETFL, 0);
  fcntl(fd, F_SETFL, flags | O_NONBLOCK);
}

bool sendAll(int fd, const void *data, std::size_t length) {
  const auto *bytes = static_cast<const uint8_t *>(data);
  std::size_t sent = 0;
  while (sent < length) {
    const ssize_t wrote = ::send(fd, bytes + sent, length - sent, MSG_NOSIGNAL);
    if (wrote <= 0) {
      return false;
    }
    sent += static_cast<std::size_t>(wrote);
  }
  return true;
}

std::string headerValue(const std::string &request, const char *name) {
  //  Header names are case-insensitive; browsers are consistent enough that a
  //  lowercase scan of a lowercased copy is sufficient here.
  std::string lower;
  lower.reserve(request.size());
  for (const char c : request) {
    lower.push_back(static_cast<char>(c >= 'A' && c <= 'Z' ? c + 32 : c));
  }
  const std::size_t at = lower.find(name);
  if (at == std::string::npos) {
    return "";
  }
  std::size_t start = request.find(':', at);
  if (start == std::string::npos) {
    return "";
  }
  ++start;
  while (start < request.size() && (request[start] == ' ' || request[start] == '\t')) {
    ++start;
  }
  const std::size_t end = request.find("\r\n", start);
  return request.substr(start, end == std::string::npos ? std::string::npos
                                                        : end - start);
}

}  // namespace

WebSocketServer::~WebSocketServer() { stop(); }

bool WebSocketServer::start(int port, std::string &error) {
  listenFd_ = ::socket(AF_INET, SOCK_STREAM, 0);
  if (listenFd_ < 0) {
    error = "cannot create socket";
    return false;
  }
  int one = 1;
  ::setsockopt(listenFd_, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));

  sockaddr_in address{};
  address.sin_family = AF_INET;
  address.sin_addr.s_addr = htonl(INADDR_ANY);
  address.sin_port = htons(static_cast<uint16_t>(port));
  if (::bind(listenFd_, reinterpret_cast<sockaddr *>(&address), sizeof(address)) != 0) {
    error = "cannot bind port " + std::to_string(port);
    stop();
    return false;
  }
  if (::listen(listenFd_, 4) != 0) {
    error = "cannot listen on port " + std::to_string(port);
    stop();
    return false;
  }
  setNonBlocking(listenFd_);
  port_ = port;
  return true;
}

void WebSocketServer::stop() {
  for (const int fd : clients_) {
    ::close(fd);
  }
  clients_.clear();
  if (listenFd_ >= 0) {
    ::close(listenFd_);
    listenFd_ = -1;
  }
}

bool WebSocketServer::handshake(int fd) {
  char buffer[2048];
  const ssize_t got = ::recv(fd, buffer, sizeof(buffer) - 1, 0);
  if (got <= 0) {
    return false;
  }
  buffer[got] = '\0';
  const std::string request(buffer);

  const std::string key = headerValue(request, "sec-websocket-key");
  if (key.empty()) {
    //  Not a WebSocket upgrade: serve the viewer page so a single URL is all
    //  the user needs.
    const std::string body = page_.empty() ? std::string(webViewerHtml()) : page_;
    const std::string response =
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: " +
        std::to_string(body.size()) + "\r\nConnection: close\r\n\r\n" + body;
    sendAll(fd, response.data(), response.size());
    return false;
  }

  uint8_t hash[20];
  Sha1 sha;
  sha.digest(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11", hash);
  const std::string accept = base64(hash, sizeof(hash));

  const std::string response =
      "HTTP/1.1 101 Switching Protocols\r\n"
      "Upgrade: websocket\r\n"
      "Connection: Upgrade\r\n"
      "Sec-WebSocket-Accept: " +
      accept + "\r\n\r\n";
  if (!sendAll(fd, response.data(), response.size())) {
    return false;
  }
  setNonBlocking(fd);
  int one = 1;
  ::setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof(one));
  return true;
}

void WebSocketServer::poll() {
  if (listenFd_ < 0) {
    return;
  }
  while (true) {
    const int fd = ::accept(listenFd_, nullptr, nullptr);
    if (fd < 0) {
      break;
    }
    if (handshake(fd)) {
      clients_.push_back(fd);
    } else {
      ::close(fd);
    }
  }

  //  Drain anything a client sends (pings, closes) so its buffer never fills;
  //  a read error means it has gone away.
  for (std::size_t i = 0; i < clients_.size();) {
    char scratch[256];
    const ssize_t got = ::recv(clients_[i], scratch, sizeof(scratch), MSG_DONTWAIT);
    if (got == 0) {
      ::close(clients_[i]);
      clients_.erase(clients_.begin() + static_cast<long>(i));
      continue;
    }
    ++i;
  }
}

void WebSocketServer::broadcast(const Image &image) {
  if (clients_.empty() || image.empty()) {
    return;
  }

  std::vector<uint8_t> payload;
  payload.reserve(image.rgb.size() + 4);
  payload.push_back(static_cast<uint8_t>(image.width & 0xFF));
  payload.push_back(static_cast<uint8_t>((image.width >> 8) & 0xFF));
  payload.push_back(static_cast<uint8_t>(image.height & 0xFF));
  payload.push_back(static_cast<uint8_t>((image.height >> 8) & 0xFF));
  payload.insert(payload.end(), image.rgb.begin(), image.rgb.end());

  std::vector<uint8_t> header;
  header.push_back(0x82);  // FIN + binary opcode
  const std::size_t length = payload.size();
  if (length < 126) {
    header.push_back(static_cast<uint8_t>(length));
  } else if (length < 65536) {
    header.push_back(126);
    header.push_back(static_cast<uint8_t>((length >> 8) & 0xFF));
    header.push_back(static_cast<uint8_t>(length & 0xFF));
  } else {
    header.push_back(127);
    for (int shift = 56; shift >= 0; shift -= 8) {
      header.push_back(static_cast<uint8_t>((length >> shift) & 0xFF));
    }
  }

  for (std::size_t i = 0; i < clients_.size();) {
    const bool ok = sendAll(clients_[i], header.data(), header.size()) &&
                    sendAll(clients_[i], payload.data(), payload.size());
    if (!ok) {
      ::close(clients_[i]);
      clients_.erase(clients_.begin() + static_cast<long>(i));
      continue;
    }
    ++i;
  }
}

}  // namespace skypanel
