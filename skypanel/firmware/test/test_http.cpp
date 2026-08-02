#include "PosixHttpClient.h"
#include "testing.h"

using namespace skypanel;

TEST(url_parsing_handles_the_forms_the_device_will_meet) {
  ParsedUrl parsed = parseUrl("http://localhost:8000/api/frame");
  CHECK(parsed.valid);
  CHECK_EQ(parsed.host, std::string("localhost"));
  CHECK_EQ(static_cast<int>(parsed.port), 8000);
  CHECK_EQ(parsed.path, std::string("/api/frame"));

  parsed = parseUrl("http://raspberrypi.local/api/frame");
  CHECK(parsed.valid);
  CHECK_EQ(static_cast<int>(parsed.port), 80);

  parsed = parseUrl("http://192.168.1.20:8000");
  CHECK(parsed.valid);
  CHECK_EQ(parsed.path, std::string("/"));
}

TEST(url_parsing_rejects_what_it_cannot_fetch) {
  CHECK(!parseUrl("https://example.com/").valid); // no TLS on the device, by design
  CHECK(!parseUrl("localhost:8000").valid);
  CHECK(!parseUrl("http://").valid);
  CHECK(!parseUrl("http://host:99999/").valid);
  CHECK(!parseUrl(nullptr).valid);
}

TEST(response_parsing_uses_content_length) {
  const std::string raw = "HTTP/1.1 200 OK\r\n"
                          "Content-Type: application/json\r\n"
                          "Content-Length: 13\r\n\r\n"
                          "{\"mode\":\"x\"}\nTRAILING GARBAGE";
  int status = 0;
  std::string body;
  CHECK(parseHttpResponse(raw, status, body));
  CHECK_EQ(status, 200);
  CHECK_EQ(body, std::string("{\"mode\":\"x\"}\n"));
}

TEST(response_parsing_decodes_chunked_bodies) {
  const std::string raw = "HTTP/1.1 200 OK\r\n"
                          "Transfer-Encoding: chunked\r\n\r\n"
                          "5\r\nhello\r\n"
                          "6\r\n world\r\n"
                          "0\r\n\r\n";
  int status = 0;
  std::string body;
  CHECK(parseHttpResponse(raw, status, body));
  CHECK_EQ(body, std::string("hello world"));
}

TEST(response_parsing_is_case_insensitive_about_headers) {
  const std::string raw = "HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok";
  int status = 0;
  std::string body;
  CHECK(parseHttpResponse(raw, status, body));
  CHECK_EQ(body, std::string("ok"));
}

TEST(response_parsing_reports_error_statuses) {
  const std::string raw = "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n";
  int status = 0;
  std::string body;
  CHECK(parseHttpResponse(raw, status, body));
  CHECK_EQ(status, 503);
}

TEST(response_parsing_rejects_a_truncated_response) {
  int status = 0;
  std::string body;
  CHECK(!parseHttpResponse("HTTP/1.1 200 OK\r\nContent-Length: 5\r\n", status, body));
  CHECK(!parseHttpResponse("garbage\r\n\r\nbody", status, body));
}

TEST(a_malformed_url_fails_without_touching_the_network) {
  PosixHttpClient client;
  const HttpResponse response = client.get("nonsense");
  CHECK_EQ(response.status, 0);
  CHECK(!response.ok());
  CHECK(std::string(response.error).find("malformed") != std::string::npos);
}
