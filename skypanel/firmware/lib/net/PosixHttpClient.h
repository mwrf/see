// The desktop `IHttpClient`.
//
// Written against POSIX sockets rather than libcurl. The spec suggested curl, but the
// whole client is one blocking GET of a sub-kilobyte JSON document from a host on the
// LAN, and a 60-line socket implementation is a smaller thing to depend on, to build and
// to reason about than libcurl and its TLS stack.

#pragma once

#include <string>
#include <vector>

#include "IHttpClient.h"

namespace skypanel {

class PosixHttpClient : public IHttpClient {
public:
  HttpResponse get(const char *url) override;
  void setTimeoutMs(uint32_t timeoutMs) override { timeoutMs_ = timeoutMs; }

private:
  uint32_t timeoutMs_ = 3000;
  std::string body_;
  std::string error_;

  HttpResponse fail(const char *message);
};

/// A parsed `http://host[:port]/path` URL. Exposed for testing.
struct ParsedUrl {
  bool valid = false;
  std::string host;
  uint16_t port = 80;
  std::string path = "/";
};

ParsedUrl parseUrl(const char *url);

/// Split an HTTP response into status and body, handling both `Content-Length` and
/// `Transfer-Encoding: chunked`. Exposed for testing.
bool parseHttpResponse(const std::string &raw, int &status, std::string &body);

} // namespace skypanel
