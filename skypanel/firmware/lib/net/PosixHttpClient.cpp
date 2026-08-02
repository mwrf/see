#include "PosixHttpClient.h"

#include <netdb.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>

#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace skypanel {
namespace {

std::string lower(std::string s) {
  for (char &c : s) {
    c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  }
  return s;
}

/// Case-insensitive header lookup over the raw header block.
bool headerValue(const std::string &headers, const char *name, std::string &out) {
  const std::string needle = "\r\n" + lower(name) + ":";
  const std::string haystack = lower("\r\n" + headers);
  const size_t at = haystack.find(needle);
  if (at == std::string::npos) {
    return false;
  }
  // Offsets line up because lowering does not change the length.
  const size_t valueStart = at + needle.size() - 2;
  const size_t lineEnd = headers.find("\r\n", valueStart);
  out = headers.substr(valueStart, lineEnd == std::string::npos ? std::string::npos
                                                                : lineEnd - valueStart);
  while (!out.empty() && (out.front() == ' ' || out.front() == '\t')) {
    out.erase(out.begin());
  }
  return true;
}

bool decodeChunked(const std::string &raw, std::string &out) {
  size_t i = 0;
  while (i < raw.size()) {
    const size_t lineEnd = raw.find("\r\n", i);
    if (lineEnd == std::string::npos) {
      return false;
    }
    const size_t size = std::strtoul(raw.substr(i, lineEnd - i).c_str(), nullptr, 16);
    i = lineEnd + 2;
    if (size == 0) {
      return true;
    }
    if (i + size > raw.size()) {
      return false;
    }
    out.append(raw, i, size);
    i += size + 2; // trailing CRLF
  }
  return false;
}

} // namespace

ParsedUrl parseUrl(const char *url) {
  ParsedUrl parsed;
  if (url == nullptr) {
    return parsed;
  }
  std::string s(url);
  const std::string scheme = "http://";
  if (s.rfind(scheme, 0) != 0) {
    return parsed;
  }
  s.erase(0, scheme.size());

  const size_t slash = s.find('/');
  std::string authority = slash == std::string::npos ? s : s.substr(0, slash);
  parsed.path = slash == std::string::npos ? "/" : s.substr(slash);

  const size_t colon = authority.find(':');
  if (colon != std::string::npos) {
    const long port = std::strtol(authority.substr(colon + 1).c_str(), nullptr, 10);
    if (port <= 0 || port > 65535) {
      return parsed;
    }
    parsed.port = static_cast<uint16_t>(port);
    authority.erase(colon);
  }
  if (authority.empty()) {
    return parsed;
  }
  parsed.host = authority;
  parsed.valid = true;
  return parsed;
}

bool parseHttpResponse(const std::string &raw, int &status, std::string &body) {
  const size_t split = raw.find("\r\n\r\n");
  if (split == std::string::npos) {
    return false;
  }
  const std::string headers = raw.substr(0, split);
  const std::string rest = raw.substr(split + 4);

  if (headers.rfind("HTTP/", 0) != 0) {
    return false;
  }
  const size_t firstSpace = headers.find(' ');
  if (firstSpace == std::string::npos) {
    return false;
  }
  status = static_cast<int>(std::strtol(headers.c_str() + firstSpace + 1, nullptr, 10));

  std::string encoding;
  if (headerValue(headers, "transfer-encoding", encoding) &&
      lower(encoding).find("chunked") != std::string::npos) {
    body.clear();
    return decodeChunked(rest, body);
  }

  std::string contentLength;
  if (headerValue(headers, "content-length", contentLength)) {
    const size_t length = std::strtoul(contentLength.c_str(), nullptr, 10);
    body = rest.substr(0, length);
    return rest.size() >= length;
  }
  body = rest;
  return true;
}

HttpResponse PosixHttpClient::fail(const char *message) {
  error_ = message;
  return HttpResponse{0, nullptr, 0, error_.c_str()};
}

HttpResponse PosixHttpClient::get(const char *url) {
  const ParsedUrl parsed = parseUrl(url);
  if (!parsed.valid) {
    return fail("malformed URL (expected http://host[:port]/path)");
  }

  char portText[8];
  std::snprintf(portText, sizeof(portText), "%u", parsed.port);

  addrinfo hints{};
  hints.ai_family = AF_UNSPEC;
  hints.ai_socktype = SOCK_STREAM;
  addrinfo *results = nullptr;
  if (getaddrinfo(parsed.host.c_str(), portText, &hints, &results) != 0) {
    return fail("cannot resolve host");
  }

  int fd = -1;
  for (addrinfo *it = results; it != nullptr; it = it->ai_next) {
    fd = socket(it->ai_family, it->ai_socktype, it->ai_protocol);
    if (fd < 0) {
      continue;
    }
    timeval tv{};
    tv.tv_sec = static_cast<time_t>(timeoutMs_ / 1000);
    tv.tv_usec = static_cast<suseconds_t>((timeoutMs_ % 1000) * 1000);
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
    if (connect(fd, it->ai_addr, it->ai_addrlen) == 0) {
      break;
    }
    close(fd);
    fd = -1;
  }
  freeaddrinfo(results);
  if (fd < 0) {
    return fail("connection refused");
  }

  char request[1024];
  const int written = std::snprintf(request, sizeof(request),
                                    "GET %s HTTP/1.1\r\n"
                                    "Host: %s:%u\r\n"
                                    "User-Agent: SkyPanel-emu/0.1\r\n"
                                    "Accept: application/json\r\n"
                                    "Connection: close\r\n\r\n",
                                    parsed.path.c_str(), parsed.host.c_str(), parsed.port);
  if (written <= 0 || send(fd, request, static_cast<size_t>(written), 0) != written) {
    close(fd);
    return fail("failed to send request");
  }

  std::string raw;
  char buffer[2048];
  ssize_t n = 0;
  while ((n = recv(fd, buffer, sizeof(buffer), 0)) > 0) {
    raw.append(buffer, static_cast<size_t>(n));
    if (raw.size() > 1u << 20) {
      break; // a frame is under a kilobyte; anything this big is not our backend
    }
  }
  close(fd);

  if (raw.empty()) {
    return fail("no response (timeout?)");
  }

  int status = 0;
  body_.clear();
  if (!parseHttpResponse(raw, status, body_)) {
    return fail("malformed HTTP response");
  }
  error_.clear();
  return HttpResponse{status, body_.c_str(), body_.size(), ""};
}

} // namespace skypanel
