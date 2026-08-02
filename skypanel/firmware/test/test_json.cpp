#include "Json.h"
#include "testing.h"

using namespace skypanel;
using namespace skypanel::json;

namespace {

std::string str(const Document &doc, uint16_t node) {
  char buffer[128];
  doc.string(node, buffer, sizeof(buffer));
  return buffer;
}

} // namespace

TEST(json_parses_a_flat_object) {
  Document doc;
  CHECK(doc.parse(R"({"a": 1, "b": "two", "c": true, "d": null})"));
  CHECK_NEAR(doc.number(doc.member(doc.root(), "a")), 1.0, 1e-9);
  CHECK_EQ(str(doc, doc.member(doc.root(), "b")), std::string("two"));
  CHECK(doc.boolean(doc.member(doc.root(), "c")));
  CHECK(doc.isNull(doc.member(doc.root(), "d")));
}

TEST(json_parses_nested_arrays_of_objects) {
  Document doc;
  CHECK(doc.parse(R"({"lines":[{"text":"A"},{"text":"B"},{"text":"C"}]})"));
  const uint16_t lines = doc.member(doc.root(), "lines");
  CHECK_EQ(doc.count(lines), 3);
  CHECK_EQ(str(doc, doc.member(doc.element(lines, 1), "text")), std::string("B"));
  CHECK_EQ(doc.element(lines, 9), kInvalid);
}

TEST(json_handles_negative_and_fractional_numbers) {
  Document doc;
  CHECK(doc.parse(R"({"lat": -6.2603, "alt": 2.4e4})"));
  CHECK_NEAR(doc.number(doc.member(doc.root(), "lat")), -6.2603, 1e-9);
  CHECK_NEAR(doc.number(doc.member(doc.root(), "alt")), 24000.0, 1e-6);
}

TEST(json_unescapes_strings) {
  Document doc;
  CHECK(doc.parse(R"({"s": "a\"b\\c\nd\/e"})"));
  CHECK_EQ(str(doc, doc.member(doc.root(), "s")), std::string("a\"b\\c\nd/e"));
}

TEST(json_decodes_unicode_escapes_to_utf8) {
  Document doc;
  CHECK(doc.parse(R"({"s": "DUB→STN"})"));
  CHECK_EQ(str(doc, doc.member(doc.root(), "s")), std::string("DUB\xE2\x86\x92STN"));
}

TEST(json_ignores_whitespace) {
  Document doc;
  CHECK(doc.parse("{\n  \"a\" : [ 1 , 2 ]\n}\n"));
  CHECK_EQ(doc.count(doc.member(doc.root(), "a")), 2);
}

TEST(json_accepts_empty_containers) {
  Document doc;
  CHECK(doc.parse(R"({"a":[],"b":{}})"));
  CHECK_EQ(doc.count(doc.member(doc.root(), "a")), 0);
  CHECK_EQ(doc.count(doc.member(doc.root(), "b")), 0);
}

TEST(json_rejects_rather_than_guesses) {
  Document doc;
  CHECK(!doc.parse("{"));
  CHECK(!doc.parse(R"({"a": })"));
  CHECK(!doc.parse(R"({"a" 1})"));
  CHECK(!doc.parse(R"({"a": "unterminated)"));
  CHECK(!doc.parse("[1,2] trailing"));
  CHECK(!doc.parse(nullptr));
}

TEST(json_typed_accessors_fall_back_instead_of_crashing) {
  Document doc;
  CHECK(doc.parse(R"({"s":"text"})"));
  const uint16_t s = doc.member(doc.root(), "s");
  CHECK_NEAR(doc.number(s, 42.0), 42.0, 1e-9); // wrong type
  CHECK(doc.boolean(doc.member(doc.root(), "missing"), true));
  CHECK_NEAR(doc.number(kInvalid, -1.0), -1.0, 1e-9);
}

TEST(json_string_always_terminates_even_when_truncated) {
  Document doc;
  CHECK(doc.parse(R"({"s":"abcdefghij"})"));
  char small[4];
  const size_t n = doc.string(doc.member(doc.root(), "s"), small, sizeof(small));
  CHECK_EQ(n, static_cast<size_t>(3));
  CHECK_STREQ(small, "abc");
}

TEST(json_arena_exhaustion_is_a_failure_not_a_crash) {
  std::string deep = "[";
  for (int i = 0; i < 400; ++i) {
    deep += "1,";
  }
  deep += "1]";
  Document doc;
  CHECK(!doc.parse(deep.c_str()));
  CHECK_STREQ(doc.error(), "arena exhausted");
}

TEST(json_string_equals_compares_decoded_values) {
  Document doc;
  CHECK(doc.parse(R"({"mode":"nearest"})"));
  CHECK(doc.stringEquals(doc.member(doc.root(), "mode"), "nearest"));
  CHECK(!doc.stringEquals(doc.member(doc.root(), "mode"), "tracking"));
}
