// A very small, allocation-free JSON reader.
//
// SkyPanel parses exactly one document shape -- the DisplayFrame contract in
// section 5 of the spec -- and does it on a microcontroller in the poll loop.
// A general-purpose library would work, but this is ~200 lines, has no heap
// behaviour to reason about, and its failure mode is a bool rather than an
// exception or a silently truncated document.
//
// Nodes live in a fixed pool; strings are unescaped into a fixed arena. Both
// are sized for frames a few hundred bytes long, and overflow is reported
// rather than ignored.
#pragma once

#include <cstddef>
#include <cstdint>

namespace skypanel {
namespace json {

constexpr std::size_t kMaxNodes = 96;
constexpr std::size_t kArenaBytes = 1024;

enum class Type : uint8_t { Null, Bool, Number, String, Array, Object };

struct Node {
  Type type = Type::Null;
  bool boolean = false;
  double number = 0.0;
  //: Index into the arena for String nodes, and for object members' keys.
  int16_t valueOffset = -1;
  int16_t keyOffset = -1;
  int16_t firstChild = -1;
  int16_t nextSibling = -1;
};

/// A parsed document. Copyable, but big enough (~2 KB) that you want it on the
/// stack of the poll task rather than in a struct you pass around by value.
class Document {
 public:
  /// Parse NUL-terminated JSON. Returns false on malformed input or on
  /// exhausting the node pool / string arena.
  bool parse(const char *text);

  bool ok() const { return ok_; }
  const char *error() const { return error_; }

  /// Root node index, or -1 if parsing failed.
  int16_t root() const { return ok_ ? 0 : -1; }

  const Node *node(int16_t index) const {
    return (index >= 0 && index < static_cast<int16_t>(count_)) ? &nodes_[index]
                                                                : nullptr;
  }

  /// Look up a member of an object node. Returns -1 when absent.
  int16_t member(int16_t object, const char *key) const;

  /// Iterate array elements: first(), then next() on each result.
  int16_t firstChild(int16_t parent) const;
  int16_t nextSibling(int16_t index) const;

  /// Typed accessors that fall back to a default rather than failing, because
  /// a frame missing an optional field must still render.
  const char *stringAt(int16_t index, const char *fallback = "") const;
  double numberAt(int16_t index, double fallback = 0.0) const;
  bool boolAt(int16_t index, bool fallback = false) const;
  bool isNull(int16_t index) const;

  const char *memberString(int16_t object, const char *key,
                           const char *fallback = "") const {
    return stringAt(member(object, key), fallback);
  }
  double memberNumber(int16_t object, const char *key,
                      double fallback = 0.0) const {
    return numberAt(member(object, key), fallback);
  }

  std::size_t nodeCount() const { return count_; }

 private:
  int16_t allocNode();
  int16_t internString(const char *begin, const char *end);
  bool parseValue(const char *&p, int16_t index);
  bool parseObject(const char *&p, int16_t index);
  bool parseArray(const char *&p, int16_t index);
  bool parseString(const char *&p, int16_t &offset);
  bool parseNumber(const char *&p, int16_t index);
  bool parseLiteral(const char *&p, int16_t index);
  bool fail(const char *message);

  Node nodes_[kMaxNodes];
  char arena_[kArenaBytes] = {};
  std::size_t count_ = 0;
  std::size_t arenaUsed_ = 0;
  bool ok_ = false;
  const char *error_ = "not parsed";
};

}  // namespace json
}  // namespace skypanel
