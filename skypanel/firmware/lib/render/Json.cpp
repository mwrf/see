#include "Json.h"

#include <cstdlib>
#include <cstring>

namespace skypanel {
namespace json {
namespace {

void skipWhitespace(const char *&p) {
  while (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r') {
    ++p;
  }
}

/// Encode one code point as UTF-8. Returns bytes written (1-3; JSON escapes
/// cannot reach the 4-byte range without a surrogate pair, handled by caller).
std::size_t encodeUtf8(uint32_t code, char *out) {
  if (code < 0x80) {
    out[0] = static_cast<char>(code);
    return 1;
  }
  if (code < 0x800) {
    out[0] = static_cast<char>(0xC0 | (code >> 6));
    out[1] = static_cast<char>(0x80 | (code & 0x3F));
    return 2;
  }
  if (code < 0x10000) {
    out[0] = static_cast<char>(0xE0 | (code >> 12));
    out[1] = static_cast<char>(0x80 | ((code >> 6) & 0x3F));
    out[2] = static_cast<char>(0x80 | (code & 0x3F));
    return 3;
  }
  out[0] = static_cast<char>(0xF0 | (code >> 18));
  out[1] = static_cast<char>(0x80 | ((code >> 12) & 0x3F));
  out[2] = static_cast<char>(0x80 | ((code >> 6) & 0x3F));
  out[3] = static_cast<char>(0x80 | (code & 0x3F));
  return 4;
}

bool hex4(const char *p, uint32_t &out) {
  out = 0;
  for (int i = 0; i < 4; ++i) {
    const char c = p[i];
    out <<= 4;
    if (c >= '0' && c <= '9') {
      out |= static_cast<uint32_t>(c - '0');
    } else if (c >= 'a' && c <= 'f') {
      out |= static_cast<uint32_t>(c - 'a' + 10);
    } else if (c >= 'A' && c <= 'F') {
      out |= static_cast<uint32_t>(c - 'A' + 10);
    } else {
      return false;
    }
  }
  return true;
}

}  // namespace

bool Document::fail(const char *message) {
  ok_ = false;
  error_ = message;
  return false;
}

int16_t Document::allocNode() {
  if (count_ >= kMaxNodes) {
    return -1;
  }
  nodes_[count_] = Node{};
  return static_cast<int16_t>(count_++);
}

bool Document::parse(const char *text) {
  count_ = 0;
  arenaUsed_ = 0;
  ok_ = true;
  error_ = "";
  if (text == nullptr) {
    return fail("null input");
  }

  const int16_t rootIndex = allocNode();
  if (rootIndex < 0) {
    return fail("node pool exhausted");
  }

  const char *p = text;
  skipWhitespace(p);
  if (!parseValue(p, rootIndex)) {
    return false;
  }
  skipWhitespace(p);
  if (*p != '\0') {
    return fail("trailing data after value");
  }
  return true;
}

bool Document::parseValue(const char *&p, int16_t index) {
  skipWhitespace(p);
  switch (*p) {
    case '{':
      return parseObject(p, index);
    case '[':
      return parseArray(p, index);
    case '"': {
      int16_t offset = -1;
      if (!parseString(p, offset)) {
        return false;
      }
      nodes_[index].type = Type::String;
      nodes_[index].valueOffset = offset;
      return true;
    }
    case 't':
    case 'f':
    case 'n':
      return parseLiteral(p, index);
    case '\0':
      return fail("unexpected end of input");
    default:
      return parseNumber(p, index);
  }
}

bool Document::parseObject(const char *&p, int16_t index) {
  ++p;  // consume '{'
  nodes_[index].type = Type::Object;
  skipWhitespace(p);
  if (*p == '}') {
    ++p;
    return true;
  }

  int16_t previous = -1;
  while (true) {
    skipWhitespace(p);
    if (*p != '"') {
      return fail("object key must be a string");
    }
    int16_t keyOffset = -1;
    if (!parseString(p, keyOffset)) {
      return false;
    }
    skipWhitespace(p);
    if (*p != ':') {
      return fail("expected ':' after object key");
    }
    ++p;

    const int16_t child = allocNode();
    if (child < 0) {
      return fail("node pool exhausted");
    }
    nodes_[child].keyOffset = keyOffset;
    if (!parseValue(p, child)) {
      return false;
    }

    if (previous < 0) {
      nodes_[index].firstChild = child;
    } else {
      nodes_[previous].nextSibling = child;
    }
    previous = child;

    skipWhitespace(p);
    if (*p == ',') {
      ++p;
      continue;
    }
    if (*p == '}') {
      ++p;
      return true;
    }
    return fail("expected ',' or '}' in object");
  }
}

bool Document::parseArray(const char *&p, int16_t index) {
  ++p;  // consume '['
  nodes_[index].type = Type::Array;
  skipWhitespace(p);
  if (*p == ']') {
    ++p;
    return true;
  }

  int16_t previous = -1;
  while (true) {
    const int16_t child = allocNode();
    if (child < 0) {
      return fail("node pool exhausted");
    }
    if (!parseValue(p, child)) {
      return false;
    }
    if (previous < 0) {
      nodes_[index].firstChild = child;
    } else {
      nodes_[previous].nextSibling = child;
    }
    previous = child;

    skipWhitespace(p);
    if (*p == ',') {
      ++p;
      continue;
    }
    if (*p == ']') {
      ++p;
      return true;
    }
    return fail("expected ',' or ']' in array");
  }
}

bool Document::parseString(const char *&p, int16_t &offset) {
  ++p;  // consume opening quote
  const std::size_t start = arenaUsed_;

  auto push = [&](char c) -> bool {
    if (arenaUsed_ + 1 >= kArenaBytes) {
      return false;
    }
    arena_[arenaUsed_++] = c;
    return true;
  };

  while (*p != '"') {
    if (*p == '\0') {
      return fail("unterminated string");
    }
    if (*p != '\\') {
      if (!push(*p++)) {
        return fail("string arena exhausted");
      }
      continue;
    }

    ++p;  // consume backslash
    switch (*p) {
      case '"':
      case '\\':
      case '/':
        if (!push(*p++)) {
          return fail("string arena exhausted");
        }
        break;
      case 'b':
        ++p;
        if (!push('\b')) return fail("string arena exhausted");
        break;
      case 'f':
        ++p;
        if (!push('\f')) return fail("string arena exhausted");
        break;
      case 'n':
        ++p;
        if (!push('\n')) return fail("string arena exhausted");
        break;
      case 'r':
        ++p;
        if (!push('\r')) return fail("string arena exhausted");
        break;
      case 't':
        ++p;
        if (!push('\t')) return fail("string arena exhausted");
        break;
      case 'u': {
        ++p;
        uint32_t code = 0;
        if (!hex4(p, code)) {
          return fail("bad \\u escape");
        }
        p += 4;
        //  Surrogate pair: the backend emits "→" for the route arrow, but
        //  anything above the BMP would arrive as a pair, so handle both.
        if (code >= 0xD800 && code <= 0xDBFF && p[0] == '\\' && p[1] == 'u') {
          uint32_t low = 0;
          if (hex4(p + 2, low) && low >= 0xDC00 && low <= 0xDFFF) {
            code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
            p += 6;
          }
        }
        char encoded[4];
        const std::size_t written = encodeUtf8(code, encoded);
        for (std::size_t i = 0; i < written; ++i) {
          if (!push(encoded[i])) {
            return fail("string arena exhausted");
          }
        }
        break;
      }
      default:
        return fail("unknown escape sequence");
    }
  }
  ++p;  // consume closing quote

  if (!push('\0')) {
    return fail("string arena exhausted");
  }
  offset = static_cast<int16_t>(start);
  return true;
}

bool Document::parseNumber(const char *&p, int16_t index) {
  char *end = nullptr;
  const double value = std::strtod(p, &end);
  if (end == p) {
    return fail("expected a value");
  }
  p = end;
  nodes_[index].type = Type::Number;
  nodes_[index].number = value;
  return true;
}

bool Document::parseLiteral(const char *&p, int16_t index) {
  if (std::strncmp(p, "true", 4) == 0) {
    p += 4;
    nodes_[index].type = Type::Bool;
    nodes_[index].boolean = true;
    return true;
  }
  if (std::strncmp(p, "false", 5) == 0) {
    p += 5;
    nodes_[index].type = Type::Bool;
    nodes_[index].boolean = false;
    return true;
  }
  if (std::strncmp(p, "null", 4) == 0) {
    p += 4;
    nodes_[index].type = Type::Null;
    return true;
  }
  return fail("unknown literal");
}

int16_t Document::member(int16_t object, const char *key) const {
  const Node *parent = node(object);
  if (parent == nullptr || parent->type != Type::Object || key == nullptr) {
    return -1;
  }
  for (int16_t child = parent->firstChild; child >= 0;
       child = nodes_[child].nextSibling) {
    const int16_t offset = nodes_[child].keyOffset;
    if (offset >= 0 && std::strcmp(&arena_[offset], key) == 0) {
      return child;
    }
  }
  return -1;
}

int16_t Document::firstChild(int16_t parent) const {
  const Node *n = node(parent);
  return n == nullptr ? -1 : n->firstChild;
}

int16_t Document::nextSibling(int16_t index) const {
  const Node *n = node(index);
  return n == nullptr ? -1 : n->nextSibling;
}

const char *Document::stringAt(int16_t index, const char *fallback) const {
  const Node *n = node(index);
  if (n == nullptr || n->type != Type::String || n->valueOffset < 0) {
    return fallback;
  }
  return &arena_[n->valueOffset];
}

double Document::numberAt(int16_t index, double fallback) const {
  const Node *n = node(index);
  return (n != nullptr && n->type == Type::Number) ? n->number : fallback;
}

bool Document::boolAt(int16_t index, bool fallback) const {
  const Node *n = node(index);
  return (n != nullptr && n->type == Type::Bool) ? n->boolean : fallback;
}

bool Document::isNull(int16_t index) const {
  const Node *n = node(index);
  return n == nullptr || n->type == Type::Null;
}

}  // namespace json
}  // namespace skypanel
