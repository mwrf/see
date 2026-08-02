#include "WebView.h"
#include "testing.h"

using namespace skypanel;

TEST(base64_matches_the_rfc_test_vectors) {
  auto encode = [](const char *s) {
    return base64(reinterpret_cast<const uint8_t *>(s), std::strlen(s));
  };
  CHECK_EQ(encode(""), std::string(""));
  CHECK_EQ(encode("f"), std::string("Zg=="));
  CHECK_EQ(encode("fo"), std::string("Zm8="));
  CHECK_EQ(encode("foo"), std::string("Zm9v"));
  CHECK_EQ(encode("foobar"), std::string("Zm9vYmFy"));
}

TEST(websocket_handshake_uses_the_rfc6455_example) {
  // The worked example from RFC 6455 §1.3.
  CHECK_EQ(websocketAccept("dGhlIHNhbXBsZSBub25jZQ=="),
           std::string("s3pPLMBiTxaQ9kYGzzhZRbK+xOo="));
}
