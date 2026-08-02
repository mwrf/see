// Just enough of Arduino's String for Adafruit_GFX.h to declare its
// getTextBounds overloads.
//
// SkyPanel's own render path never touches these -- the spec bans Arduino
// String there, and the renderer measures text itself with const char* so that
// scroll offsets are exact. This exists purely so the vendored header compiles
// natively.
#pragma once

#include <cstddef>
#include <string>

class __FlashStringHelper;

class String {
public:
  String() = default;
  String(const char *text) : value_(text ? text : "") {}

  unsigned int length() const { return static_cast<unsigned int>(value_.size()); }
  char charAt(unsigned int index) const {
    return index < value_.size() ? value_[index] : '\0';
  }
  const char *c_str() const { return value_.c_str(); }

private:
  std::string value_;
};
