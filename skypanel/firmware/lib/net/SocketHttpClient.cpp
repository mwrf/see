#include "SocketHttpClient.h"

#include <arpa/inet.h>
#include <netdb.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <unistd.h>

#include <cstdio>
#include <cstring>

namespace skypanel {
namespace {

/// Find the end of the response headers, returning the offset of the body.
std::size_t findBody(const char *data, std::size_t length) {
  for (std::size_t i = 3; i < length; ++i) {
    if (data[i - 3] == '\r' && data[i - 2] == '\n' && data[i - 1] == '\r' &&
        data[i] == '\n') {
      return i + 1;
    }
  }
  return length;
}

int parseStatus(const char *data, std::size_t length) {
  //  "HTTP/1.1 200 OK"
  if (length < 12 || std::strncmp(data, "HTTP/", 5) != 0) {
    return 0;
  }
  return std::atoi(data + 9);
}

}  // namespace

bool SocketHttpClient::parseUrl(const char *url, std::string &host, int &port,
                                std::string &path) {
  if (url == nullptr) {
    return false;
  }
  std::string text(url);
  const std::string prefix = "http://";
  if (text.rfind(prefix, 0) != 0) {
    return false;
  }
  text = text.substr(prefix.size());

  const std::size_t slash = text.find('/');
  std::string authority = slash == std::string::npos ? text : text.substr(0, slash);
  path = slash == std::string::npos ? "/" : text.substr(slash);
  if (authority.empty()) {
    return false;
  }

  port = 80;
  const std::size_t colon = authority.find(':');
  if (colon != std::string::npos) {
    const std::string portText = authority.substr(colon + 1);
    if (portText.empty()) {
      return false;
    }
    port = std::atoi(portText.c_str());
    if (port <= 0 || port > 65535) {
      return false;
    }
    authority = authority.substr(0, colon);
  }
  host = authority;
  return !host.empty();
}

HttpResponse SocketHttpClient::get(const char *url, char *buffer,
                                   std::size_t capacity) {
  HttpResponse response;
  if (buffer == nullptr || capacity == 0) {
    response.error = "no buffer";
    return response;
  }
  buffer[0] = '\0';

  std::string host;
  std::string path;
  int port = 80;
  if (!parseUrl(url, host, port, path)) {
    response.error = "malformed URL (expected http://host[:port]/path)";
    return response;
  }

  char portText[8];
  std::snprintf(portText, sizeof(portText), "%d", port);

  addrinfo hints{};
  hints.ai_family = AF_UNSPEC;
  hints.ai_socktype = SOCK_STREAM;
  addrinfo *results = nullptr;
  if (getaddrinfo(host.c_str(), portText, &hints, &results) != 0) {
    error_ = "cannot resolve " + host;
    response.error = error_.c_str();
    return response;
  }

  int fd = -1;
  for (addrinfo *candidate = results; candidate != nullptr;
       candidate = candidate->ai_next) {
    fd = ::socket(candidate->ai_family, candidate->ai_socktype,
                  candidate->ai_protocol);
    if (fd < 0) {
      continue;
    }
    timeval timeout{};
    timeout.tv_sec = static_cast<time_t>(timeoutMs_ / 1000);
    timeout.tv_usec = static_cast<suseconds_t>((timeoutMs_ % 1000) * 1000);
    ::setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    ::setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));

    if (::connect(fd, candidate->ai_addr, candidate->ai_addrlen) == 0) {
      break;
    }
    ::close(fd);
    fd = -1;
  }
  freeaddrinfo(results);

  if (fd < 0) {
    error_ = "cannot connect to " + host + ":" + portText;
    response.error = error_.c_str();
    return response;
  }

  char request[512];
  const int written = std::snprintf(request, sizeof(request),
                                    "GET %s HTTP/1.1\r\n"
                                    "Host: %s:%d\r\n"
                                    "User-Agent: SkyPanel-emu/1.0\r\n"
                                    "Accept: application/json\r\n"
                                    "Connection: close\r\n\r\n",
                                    path.c_str(), host.c_str(), port);
  if (written <= 0 || ::send(fd, request, static_cast<std::size_t>(written), 0) < 0) {
    ::close(fd);
    response.error = "request failed";
    return response;
  }

  std::string raw;
  char chunk[2048];
  while (true) {
    const ssize_t got = ::recv(fd, chunk, sizeof(chunk), 0);
    if (got <= 0) {
      break;
    }
    raw.append(chunk, static_cast<std::size_t>(got));
    if (raw.size() > capacity * 4) {
      break;  // the body cannot possibly fit; stop early
    }
  }
  ::close(fd);

  if (raw.empty()) {
    response.error = "empty response";
    return response;
  }

  response.status = parseStatus(raw.data(), raw.size());
  const std::size_t bodyStart = findBody(raw.data(), raw.size());
  const std::size_t bodyLength = raw.size() - bodyStart;
  if (bodyLength + 1 > capacity) {
    response.error = "response larger than the frame buffer";
    return response;
  }

  std::memcpy(buffer, raw.data() + bodyStart, bodyLength);
  buffer[bodyLength] = '\0';
  response.body = buffer;
  response.length = bodyLength;
  response.ok = response.status >= 200 && response.status < 300;
  if (!response.ok) {
    response.error = "unexpected HTTP status";
  }
  return response;
}

}  // namespace skypanel
