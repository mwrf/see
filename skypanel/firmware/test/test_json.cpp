#include "Json.h"
#include "TestFramework.h"

using skypanel::json::Document;
using skypanel::json::Type;

TEST(json_parses_a_flat_object) {
  Document doc;
  CHECK(doc.parse(R"({"a": 1, "b": "two", "c": true, "d": null})"));
  CHECK_NEAR(doc.memberNumber(doc.root(), "a"), 1.0, 1e-9);
  CHECK_STR(doc.memberString(doc.root(), "b"), "two");
  CHECK(doc.boolAt(doc.member(doc.root(), "c")));
  CHECK(doc.isNull(doc.member(doc.root(), "d")));
}

TEST(json_parses_nested_objects_and_arrays) {
  Document doc;
  CHECK(doc.parse(R"({"lines": [{"text": "A"}, {"text": "B"}]})"));
  const int16_t lines = doc.member(doc.root(), "lines");
  CHECK(doc.node(lines)->type == Type::Array);

  int count = 0;
  for (int16_t item = doc.firstChild(lines); item >= 0; item = doc.nextSibling(item)) {
    ++count;
  }
  CHECK_EQ(count, 2);
  CHECK_STR(doc.memberString(doc.firstChild(lines), "text"), "A");
}

TEST(json_handles_negative_and_exponent_numbers) {
  Document doc;
  CHECK(doc.parse(R"({"a": -12.5, "b": 1.5e3})"));
  CHECK_NEAR(doc.memberNumber(doc.root(), "a"), -12.5, 1e-9);
  CHECK_NEAR(doc.memberNumber(doc.root(), "b"), 1500.0, 1e-9);
}

TEST(json_decodes_escapes) {
  Document doc;
  CHECK(doc.parse(R"({"s": "a\"b\\c\nd\tE"})"));
  CHECK_STR(doc.memberString(doc.root(), "s"), "a\"b\\c\nd\tE");
}

TEST(json_decodes_unicode_escapes_as_utf8) {
  Document doc;
  //  The route arrow is the one non-ASCII character the frame contract uses,
  //  and Python's json.dumps escapes it by default.
  CHECK(doc.parse(R"({"s": "DUB→STN"})"));
  CHECK_STR(doc.memberString(doc.root(), "s"), "DUB\xE2\x86\x92STN");
}

TEST(json_decodes_surrogate_pairs) {
  Document doc;
  CHECK(doc.parse(R"({"s": "🛩"})"));  // U+1F6E9 airplane
  CHECK_STR(doc.memberString(doc.root(), "s"), "\xF0\x9F\x9B\xA9");
}

TEST(json_accepts_raw_utf8_in_strings) {
  Document doc;
  CHECK(doc.parse("{\"s\": \"DUB\xE2\x86\x92STN\"}"));
  CHECK_STR(doc.memberString(doc.root(), "s"), "DUB\xE2\x86\x92STN");
}

TEST(json_tolerates_whitespace_everywhere) {
  Document doc;
  CHECK(doc.parse("  {\n \"a\" :\t[ 1 , 2 ]\r\n }  "));
  CHECK(doc.ok());
}

TEST(json_rejects_malformed_documents) {
  const char *bad[] = {
      "{",  "{\"a\"}", "{\"a\": }", "[1, 2",   "{\"a\": 1,}",
      "",   "nope",    "{\"a\": tru}", "{'a': 1}", "{\"a\": 1} extra",
  };
  for (const char *text : bad) {
    Document doc;
    if (doc.parse(text)) {
      skytest::reportFailure(__FILE__, __LINE__,
                             std::string("should have rejected: ") + text);
    }
  }
}

TEST(json_rejects_a_null_pointer) {
  Document doc;
  CHECK(!doc.parse(nullptr));
}

TEST(json_reports_an_error_message_on_failure) {
  Document doc;
  CHECK(!doc.parse("{\"a\": }"));
  CHECK(std::strlen(doc.error()) > 0);
}

TEST(json_missing_members_fall_back_rather_than_crash) {
  Document doc;
  CHECK(doc.parse(R"({"a": 1})"));
  CHECK_STR(doc.memberString(doc.root(), "absent", "default"), "default");
  CHECK_NEAR(doc.memberNumber(doc.root(), "absent", 7.0), 7.0, 1e-9);
  CHECK(doc.member(doc.root(), "absent") < 0);
}

TEST(json_fails_cleanly_when_the_node_pool_is_exhausted) {
  //  Better a reported failure than a silently truncated frame.
  std::string huge = "[";
  for (int i = 0; i < 500; ++i) {
    huge += "1,";
  }
  huge += "1]";
  Document doc;
  CHECK(!doc.parse(huge.c_str()));
  CHECK(std::strstr(doc.error(), "pool") != nullptr);
}

TEST(json_fails_cleanly_when_the_string_arena_is_exhausted) {
  std::string huge = "{\"s\": \"";
  huge.append(4096, 'x');
  huge += "\"}";
  Document doc;
  CHECK(!doc.parse(huge.c_str()));
  CHECK(std::strstr(doc.error(), "arena") != nullptr);
}
