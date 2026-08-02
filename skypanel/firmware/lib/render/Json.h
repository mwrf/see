// A very small JSON reader.
//
// The device parses exactly one document shape — the display frame — and it is under a
// kilobyte. That does not justify pulling in a general-purpose library on either target,
// and it does justify a parser with no allocation: nodes live in a fixed arena and
// strings are spans into the caller's buffer until someone asks for a copy.
//
// Not a complete JSON implementation: it rejects rather than guesses, which for a
// device that must not render garbage is the right failure mode.

#pragma once

#include <cstddef>
#include <cstdint>

namespace skypanel {
namespace json {

constexpr uint16_t kMaxNodes = 192;
constexpr uint16_t kInvalid = 0xFFFF;

enum class Type : uint8_t { Null, Bool, Number, String, Array, Object };

struct Node {
  Type type = Type::Null;
  uint16_t start = 0; ///< span into the source text (string body / number text)
  uint16_t length = 0;
  uint16_t keyStart = 0; ///< for object members
  uint16_t keyLength = 0;
  uint16_t firstChild = kInvalid;
  uint16_t nextSibling = kInvalid;
  bool boolean = false;
};

/// Parsed document. Borrows the source text — it must outlive the document.
class Document {
public:
  /// Returns false on malformed input or if the arena is exhausted.
  bool parse(const char *text);

  bool valid() const { return valid_; }
  const char *error() const { return error_; }

  uint16_t root() const { return valid_ ? 0 : kInvalid; }
  const Node &node(uint16_t index) const { return nodes_[index]; }

  /// Member of an object by key, or `kInvalid`.
  uint16_t member(uint16_t object, const char *key) const;

  /// Element of an array by position, or `kInvalid`.
  uint16_t element(uint16_t array, uint16_t index) const;

  uint16_t count(uint16_t container) const;

  /// Typed accessors. Each returns `fallback` when the node is missing or the wrong
  /// type, so callers never need to check twice.
  double number(uint16_t index, double fallback = 0.0) const;
  bool boolean(uint16_t index, bool fallback = false) const;

  /// Copies an (unescaped) string into `out`, always NUL-terminating. Returns the
  /// number of characters written.
  size_t string(uint16_t index, char *out, size_t capacity) const;

  /// True when the node is a string whose decoded value equals `expected`.
  bool stringEquals(uint16_t index, const char *expected) const;

  bool isNull(uint16_t index) const;

private:
  const char *text_ = nullptr;
  Node nodes_[kMaxNodes];
  uint16_t used_ = 0;
  bool valid_ = false;
  const char *error_ = "not parsed";

  uint16_t allocate();
  bool parseValue(size_t &i, uint16_t into);
  bool parseString(size_t &i, uint16_t into);
  bool parseNumber(size_t &i, uint16_t into);
  bool parseLiteral(size_t &i, uint16_t into, const char *literal, Type type, bool value);
  bool parseArray(size_t &i, uint16_t into);
  bool parseObject(size_t &i, uint16_t into);
  void skipWhitespace(size_t &i) const;
  bool fail(const char *message);
};

} // namespace json
} // namespace skypanel
