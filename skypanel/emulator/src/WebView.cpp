#include "WebView.h"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cstring>
#include <fstream>
#include <sstream>

namespace skypanel {
namespace {

constexpr char kBase64Alphabet[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// SHA-1, needed only for the WebSocket handshake. Small enough to carry than to depend
/// on OpenSSL for.
struct Sha1 {
  uint32_t h[5] = {0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0};

  static uint32_t rotl(uint32_t v, int n) { return (v << n) | (v >> (32 - n)); }

  void digest(const std::string &input, uint8_t out[20]) {
    std::string message = input;
    const uint64_t bitLength = static_cast<uint64_t>(message.size()) * 8;
    message.push_back(static_cast<char>(0x80));
    while (message.size() % 64 != 56) {
      message.push_back('\0');
    }
    for (int i = 7; i >= 0; --i) {
      message.push_back(static_cast<char>((bitLength >> (i * 8)) & 0xFF));
    }

    for (size_t chunk = 0; chunk < message.size(); chunk += 64) {
      uint32_t w[80];
      for (int i = 0; i < 16; ++i) {
        const auto *p = reinterpret_cast<const uint8_t *>(message.data() + chunk + i * 4);
        w[i] = (static_cast<uint32_t>(p[0]) << 24) | (static_cast<uint32_t>(p[1]) << 16) |
               (static_cast<uint32_t>(p[2]) << 8) | static_cast<uint32_t>(p[3]);
      }
      for (int i = 16; i < 80; ++i) {
        w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
      }
      uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];
      for (int i = 0; i < 80; ++i) {
        uint32_t f = 0;
        uint32_t k = 0;
        if (i < 20) {
          f = (b & c) | (~b & d);
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
        const uint32_t temp = rotl(a, 5) + f + e + k + w[i];
        e = d;
        d = c;
        c = rotl(b, 30);
        b = a;
        a = temp;
      }
      h[0] += a;
      h[1] += b;
      h[2] += c;
      h[3] += d;
      h[4] += e;
    }
    for (int i = 0; i < 5; ++i) {
      out[i * 4] = static_cast<uint8_t>(h[i] >> 24);
      out[i * 4 + 1] = static_cast<uint8_t>(h[i] >> 16);
      out[i * 4 + 2] = static_cast<uint8_t>(h[i] >> 8);
      out[i * 4 + 3] = static_cast<uint8_t>(h[i]);
    }
  }
};

std::string headerValue(const std::string &request, const char *name) {
  std::istringstream stream(request);
  std::string line;
  const std::string prefix = name;
  while (std::getline(stream, line)) {
    if (line.size() <= prefix.size()) {
      continue;
    }
    if (strncasecmp(line.c_str(), prefix.c_str(), prefix.size()) != 0) {
      continue;
    }
    if (line[prefix.size()] != ':') {
      continue;
    }
    std::string value = line.substr(prefix.size() + 1);
    while (!value.empty() && (value.front() == ' ' || value.front() == '\t')) {
      value.erase(value.begin());
    }
    while (!value.empty() && (value.back() == '\r' || value.back() == '\n')) {
      value.pop_back();
    }
    return value;
  }
  return "";
}

const char *kPage = nullptr; // resolved at runtime from web/index.html

std::string loadPage() {
  // The page lives next to the binary's source so it can be edited without rebuilding.
  for (const char *candidate :
       {"emulator/web/index.html", "web/index.html", "../web/index.html"}) {
    std::ifstream file(candidate);
    if (file) {
      std::ostringstream buffer;
      buffer << file.rdbuf();
      return buffer.str();
    }
  }
  return "<!doctype html><title>SkyPanel</title>"
         "<p>emulator/web/index.html not found — run from the repository root.";
}

} // namespace

std::string base64(const uint8_t *data, size_t length) {
  std::string out;
  out.reserve(((length + 2) / 3) * 4);
  for (size_t i = 0; i < length; i += 3) {
    const uint32_t a = data[i];
    const uint32_t b = i + 1 < length ? data[i + 1] : 0;
    const uint32_t c = i + 2 < length ? data[i + 2] : 0;
    const uint32_t triple = (a << 16) | (b << 8) | c;
    out.push_back(kBase64Alphabet[(triple >> 18) & 0x3F]);
    out.push_back(kBase64Alphabet[(triple >> 12) & 0x3F]);
    out.push_back(i + 1 < length ? kBase64Alphabet[(triple >> 6) & 0x3F] : '=');
    out.push_back(i + 2 < length ? kBase64Alphabet[triple & 0x3F] : '=');
  }
  return out;
}

std::string websocketAccept(const std::string &key) {
  Sha1 sha;
  uint8_t out[20];
  sha.digest(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11", out);
  return base64(out, sizeof(out));
}

WebView::~WebView() { stop(); }

bool WebView::start(int port) {
  listenFd_ = socket(AF_INET, SOCK_STREAM, 0);
  if (listenFd_ < 0) {
    error_ = "cannot create socket";
    return false;
  }
  int reuse = 1;
  setsockopt(listenFd_, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));

  sockaddr_in address{};
  address.sin_family = AF_INET;
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  address.sin_port = htons(static_cast<uint16_t>(port));
  if (bind(listenFd_, reinterpret_cast<sockaddr *>(&address), sizeof(address)) != 0) {
    error_ = "cannot bind port";
    close(listenFd_);
    listenFd_ = -1;
    return false;
  }
  if (listen(listenFd_, 4) != 0) {
    error_ = "cannot listen";
    close(listenFd_);
    listenFd_ = -1;
    return false;
  }
  running_.store(true);
  acceptor_ = std::thread([this] { acceptLoop(); });
  return true;
}

void WebView::stop() {
  if (!running_.exchange(false)) {
    return;
  }
  if (listenFd_ >= 0) {
    shutdown(listenFd_, SHUT_RDWR);
    close(listenFd_);
    listenFd_ = -1;
  }
  if (acceptor_.joinable()) {
    acceptor_.join();
  }
  std::lock_guard<std::mutex> lock(clientsMutex_);
  for (const int fd : clients_) {
    close(fd);
  }
  clients_.clear();
}

void WebView::acceptLoop() {
  while (running_.load()) {
    const int fd = accept(listenFd_, nullptr, nullptr);
    if (fd < 0) {
      break;
    }
    char buffer[4096];
    const ssize_t n = recv(fd, buffer, sizeof(buffer) - 1, 0);
    if (n <= 0) {
      close(fd);
      continue;
    }
    buffer[n] = '\0';
    const std::string request(buffer);

    if (!headerValue(request, "Sec-WebSocket-Key").empty()) {
      if (handshake(fd, request)) {
        std::lock_guard<std::mutex> lock(clientsMutex_);
        clients_.push_back(fd);
      } else {
        close(fd);
      }
      continue;
    }
    serveHttp(fd, request);
    close(fd);
  }
}

bool WebView::handshake(int fd, const std::string &request) {
  const std::string key = headerValue(request, "Sec-WebSocket-Key");
  if (key.empty()) {
    return false;
  }
  const std::string response = "HTTP/1.1 101 Switching Protocols\r\n"
                               "Upgrade: websocket\r\n"
                               "Connection: Upgrade\r\n"
                               "Sec-WebSocket-Accept: " +
                               websocketAccept(key) + "\r\n\r\n";
  return send(fd, response.data(), response.size(), MSG_NOSIGNAL) ==
         static_cast<ssize_t>(response.size());
}

void WebView::serveHttp(int fd, const std::string &request) {
  (void)request;
  const std::string page = kPage != nullptr ? kPage : loadPage();
  const std::string response = "HTTP/1.1 200 OK\r\n"
                               "Content-Type: text/html; charset=utf-8\r\n"
                               "Content-Length: " +
                               std::to_string(page.size()) +
                               "\r\n"
                               "Connection: close\r\n\r\n" +
                               page;
  send(fd, response.data(), response.size(), MSG_NOSIGNAL);
}

void WebView::sendText(int fd, const std::string &payload) {
  std::string header;
  header.push_back(static_cast<char>(0x81)); // FIN + text opcode
  const size_t length = payload.size();
  if (length < 126) {
    header.push_back(static_cast<char>(length));
  } else if (length <= 0xFFFF) {
    header.push_back(126);
    header.push_back(static_cast<char>((length >> 8) & 0xFF));
    header.push_back(static_cast<char>(length & 0xFF));
  } else {
    header.push_back(127);
    for (int i = 7; i >= 0; --i) {
      header.push_back(static_cast<char>((length >> (i * 8)) & 0xFF));
    }
  }
  send(fd, header.data(), header.size(), MSG_NOSIGNAL);
  send(fd, payload.data(), payload.size(), MSG_NOSIGNAL);
}

void WebView::broadcast(const DisplayFrame &frame, const Image &image) {
  {
    std::lock_guard<std::mutex> lock(clientsMutex_);
    if (clients_.empty()) {
      return;
    }
  }
  if (image.width <= 0 || image.height <= 0) {
    return;
  }
  const int scale = image.width / kPanelWidth;
  if (scale <= 0) {
    return;
  }

  // Sample the centre of each LED cell: that pixel is fully covered by the dot, so it is
  // exactly the emitted colour the painter computed.
  std::vector<uint8_t> rgb(static_cast<size_t>(kPanelWidth) * kPanelHeight * 3);
  size_t at = 0;
  for (int y = 0; y < kPanelHeight; ++y) {
    for (int x = 0; x < kPanelWidth; ++x) {
      const size_t i = image.index(x * scale + scale / 2, y * scale + scale / 2);
      rgb[at++] = image.pixels[i];
      rgb[at++] = image.pixels[i + 1];
      rgb[at++] = image.pixels[i + 2];
    }
  }

  std::ostringstream json;
  json << R"({"w":)" << kPanelWidth << R"(,"h":)" << kPanelHeight << R"(,"source":")"
       << frame.source << R"(","status":")"
       << (frame.status == FrameStatus::Live      ? "live"
           : frame.status == FrameStatus::Stale   ? "stale"
                                                  : "offline")
       << R"(","px":")" << base64(rgb.data(), rgb.size()) << R"("})";
  const std::string payload = json.str();

  std::vector<int> dead;
  {
    std::lock_guard<std::mutex> lock(clientsMutex_);
    for (const int fd : clients_) {
      sendText(fd, payload);
    }
  }
}

} // namespace skypanel
