#include "Json.h"

#include <cstdlib>
#include <cstring>

namespace skypanel {
namespace json {
namespace {

bool isWhitespace(char c) {
  return c == ' ' || c == '\t' || c == '\n' || c == '\r';
}

bool isDigit(char c) { return c >= '0' && c <= '9'; }

int hexValue(char c) {
  if (c >= '0' && c <= '9') {
    return c - '0';
  }
  if (c >= 'a' && c <= 'f') {
    return c - 'a' + 10;
  }
  if (c >= 'A' && c <= 'F') {
    return c - 'A' + 10;
  }
  return -1;
}

/// Append a code point as UTF-8. Used when unescaping \\uXXXX.
size_t appendUtf8(uint32_t cp, char *out, size_t capacity, size_t at) {
  auto put = [&](char c) {
    if (at + 1 < capacity) {
      out[at++] = c;
    }
  };
  if (cp < 0x80) {
    put(static_cast<char>(cp));
  } else if (cp < 0x800) {
    put(static_cast<char>(0xC0 | (cp >> 6)));
    put(static_cast<char>(0x80 | (cp & 0x3F)));
  } else {
    put(static_cast<char>(0xE0 | (cp >> 12)));
    put(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
    put(static_cast<char>(0x80 | (cp & 0x3F)));
  }
  return at;
}

} // namespace

uint16_t Document::allocate() {
  if (used_ >= kMaxNodes) {
    return kInvalid;
  }
  nodes_[used_] = Node{};
  return used_++;
}

bool Document::fail(const char *message) {
  valid_ = false;
  error_ = message;
  return false;
}

void Document::skipWhitespace(size_t &i) const {
  while (text_[i] != '\0' && isWhitespace(text_[i])) {
    ++i;
  }
}

bool Document::parse(const char *text) {
  text_ = text;
  used_ = 0;
  valid_ = true;
  error_ = "";
  if (text == nullptr) {
    return fail("null input");
  }
  const uint16_t root = allocate();
  if (root == kInvalid) {
    return fail("arena exhausted");
  }
  size_t i = 0;
  if (!parseValue(i, root)) {
    return false;
  }
  skipWhitespace(i);
  if (text_[i] != '\0') {
    return fail("trailing data");
  }
  return true;
}

bool Document::parseValue(size_t &i, uint16_t into) {
  skipWhitespace(i);
  switch (text_[i]) {
  case '"':
    return parseString(i, into);
  case '{':
    return parseObject(i, into);
  case '[':
    return parseArray(i, into);
  case 't':
    return parseLiteral(i, into, "true", Type::Bool, true);
  case 'f':
    return parseLiteral(i, into, "false", Type::Bool, false);
  case 'n':
    return parseLiteral(i, into, "null", Type::Null, false);
  default:
    if (text_[i] == '-' || isDigit(text_[i])) {
      return parseNumber(i, into);
    }
    return fail("unexpected character");
  }
}

bool Document::parseLiteral(size_t &i, uint16_t into, const char *literal, Type type,
                            bool value) {
  const size_t len = std::strlen(literal);
  if (std::strncmp(text_ + i, literal, len) != 0) {
    return fail("bad literal");
  }
  nodes_[into].type = type;
  nodes_[into].boolean = value;
  i += len;
  return true;
}

bool Document::parseNumber(size_t &i, uint16_t into) {
  const size_t start = i;
  if (text_[i] == '-') {
    ++i;
  }
  while (isDigit(text_[i])) {
    ++i;
  }
  if (text_[i] == '.') {
    ++i;
    while (isDigit(text_[i])) {
      ++i;
    }
  }
  if (text_[i] == 'e' || text_[i] == 'E') {
    ++i;
    if (text_[i] == '+' || text_[i] == '-') {
      ++i;
    }
    while (isDigit(text_[i])) {
      ++i;
    }
  }
  if (i == start) {
    return fail("empty number");
  }
  nodes_[into].type = Type::Number;
  nodes_[into].start = static_cast<uint16_t>(start);
  nodes_[into].length = static_cast<uint16_t>(i - start);
  return true;
}

bool Document::parseString(size_t &i, uint16_t into) {
  if (text_[i] != '"') {
    return fail("expected string");
  }
  ++i;
  const size_t start = i;
  while (text_[i] != '"') {
    if (text_[i] == '\0') {
      return fail("unterminated string");
    }
    if (text_[i] == '\\') {
      ++i;
      if (text_[i] == '\0') {
        return fail("unterminated escape");
      }
    }
    ++i;
  }
  nodes_[into].type = Type::String;
  nodes_[into].start = static_cast<uint16_t>(start);
  nodes_[into].length = static_cast<uint16_t>(i - start);
  ++i; // closing quote
  return true;
}

bool Document::parseArray(size_t &i, uint16_t into) {
  nodes_[into].type = Type::Array;
  ++i; // '['
  skipWhitespace(i);
  if (text_[i] == ']') {
    ++i;
    return true;
  }
  uint16_t previous = kInvalid;
  while (true) {
    const uint16_t child = allocate();
    if (child == kInvalid) {
      return fail("arena exhausted");
    }
    if (previous == kInvalid) {
      nodes_[into].firstChild = child;
    } else {
      nodes_[previous].nextSibling = child;
    }
    previous = child;
    if (!parseValue(i, child)) {
      return false;
    }
    skipWhitespace(i);
    if (text_[i] == ',') {
      ++i;
      continue;
    }
    if (text_[i] == ']') {
      ++i;
      return true;
    }
    return fail("expected , or ] in array");
  }
}

bool Document::parseObject(size_t &i, uint16_t into) {
  nodes_[into].type = Type::Object;
  ++i; // '{'
  skipWhitespace(i);
  if (text_[i] == '}') {
    ++i;
    return true;
  }
  uint16_t previous = kInvalid;
  while (true) {
    skipWhitespace(i);
    const uint16_t child = allocate();
    if (child == kInvalid) {
      return fail("arena exhausted");
    }
    // The key is parsed into the child node, then moved into its key span.
    if (!parseString(i, child)) {
      return false;
    }
    nodes_[child].keyStart = nodes_[child].start;
    nodes_[child].keyLength = nodes_[child].length;
    nodes_[child].start = 0;
    nodes_[child].length = 0;

    skipWhitespace(i);
    if (text_[i] != ':') {
      return fail("expected : in object");
    }
    ++i;
    if (!parseValue(i, child)) {
      return false;
    }
    if (previous == kInvalid) {
      nodes_[into].firstChild = child;
    } else {
      nodes_[previous].nextSibling = child;
    }
    previous = child;

    skipWhitespace(i);
    if (text_[i] == ',') {
      ++i;
      continue;
    }
    if (text_[i] == '}') {
      ++i;
      return true;
    }
    return fail("expected , or } in object");
  }
}

uint16_t Document::member(uint16_t object, const char *key) const {
  if (!valid_ || object == kInvalid || nodes_[object].type != Type::Object) {
    return kInvalid;
  }
  const size_t keyLen = std::strlen(key);
  for (uint16_t child = nodes_[object].firstChild; child != kInvalid;
       child = nodes_[child].nextSibling) {
    const Node &n = nodes_[child];
    if (n.keyLength == keyLen && std::strncmp(text_ + n.keyStart, key, keyLen) == 0) {
      return child;
    }
  }
  return kInvalid;
}

uint16_t Document::element(uint16_t array, uint16_t index) const {
  if (!valid_ || array == kInvalid || nodes_[array].type != Type::Array) {
    return kInvalid;
  }
  uint16_t at = 0;
  for (uint16_t child = nodes_[array].firstChild; child != kInvalid;
       child = nodes_[child].nextSibling, ++at) {
    if (at == index) {
      return child;
    }
  }
  return kInvalid;
}

uint16_t Document::count(uint16_t container) const {
  if (!valid_ || container == kInvalid) {
    return 0;
  }
  uint16_t n = 0;
  for (uint16_t child = nodes_[container].firstChild; child != kInvalid;
       child = nodes_[child].nextSibling) {
    ++n;
  }
  return n;
}

double Document::number(uint16_t index, double fallback) const {
  if (!valid_ || index == kInvalid || nodes_[index].type != Type::Number) {
    return fallback;
  }
  char buffer[32];
  const size_t len = nodes_[index].length < sizeof(buffer) - 1 ? nodes_[index].length
                                                               : sizeof(buffer) - 1;
  std::memcpy(buffer, text_ + nodes_[index].start, len);
  buffer[len] = '\0';
  return std::strtod(buffer, nullptr);
}

bool Document::boolean(uint16_t index, bool fallback) const {
  if (!valid_ || index == kInvalid || nodes_[index].type != Type::Bool) {
    return fallback;
  }
  return nodes_[index].boolean;
}

bool Document::isNull(uint16_t index) const {
  return !valid_ || index == kInvalid || nodes_[index].type == Type::Null;
}

size_t Document::string(uint16_t index, char *out, size_t capacity) const {
  if (capacity == 0) {
    return 0;
  }
  out[0] = '\0';
  if (!valid_ || index == kInvalid || nodes_[index].type != Type::String) {
    return 0;
  }
  const Node &n = nodes_[index];
  size_t at = 0;
  for (size_t i = 0; i < n.length && at + 1 < capacity; ++i) {
    const char c = text_[n.start + i];
    if (c != '\\') {
      out[at++] = c;
      continue;
    }
    ++i;
    if (i >= n.length) {
      break;
    }
    switch (text_[n.start + i]) {
    case 'n': out[at++] = '\n'; break;
    case 't': out[at++] = '\t'; break;
    case 'r': out[at++] = '\r'; break;
    case 'b': out[at++] = '\b'; break;
    case 'f': out[at++] = '\f'; break;
    case '/': out[at++] = '/'; break;
    case '"': out[at++] = '"'; break;
    case '\\': out[at++] = '\\'; break;
    case 'u': {
      uint32_t cp = 0;
      bool ok = true;
      for (int k = 1; k <= 4; ++k) {
        const int digit = (i + k < n.length) ? hexValue(text_[n.start + i + k]) : -1;
        if (digit < 0) {
          ok = false;
          break;
        }
        cp = (cp << 4) | static_cast<uint32_t>(digit);
      }
      if (!ok) {
        break;
      }
      i += 4;
      at = appendUtf8(cp, out, capacity, at);
      break;
    }
    default:
      out[at++] = text_[n.start + i];
      break;
    }
  }
  out[at] = '\0';
  return at;
}

bool Document::stringEquals(uint16_t index, const char *expected) const {
  char buffer[64];
  string(index, buffer, sizeof(buffer));
  return std::strcmp(buffer, expected) == 0;
}

} // namespace json
} // namespace skypanel
