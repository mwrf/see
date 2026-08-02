// A clock the emulator can lie to.
//
// `--speed 4` runs a recorded scenario four times faster; `--time 2400` freezes the
// clock so a snapshot always catches the same moment of a scrolling line. Both matter
// because the renderer's animation is a pure function of elapsed milliseconds, and that
// is only useful if the milliseconds are controllable.

#pragma once

#include <chrono>
#include <cstdint>

namespace skypanel {

class Clock {
public:
  explicit Clock(float speed = 1.0F) : speed_(speed <= 0.0F ? 1.0F : speed) {}

  /// Freeze the clock at a fixed reading. Used by `--time` and `--snapshot`.
  void freeze(uint32_t atMs) {
    frozen_ = true;
    frozenMs_ = atMs;
  }

  void advance(uint32_t deltaMs) { frozenMs_ += deltaMs; }

  uint32_t nowMs() const {
    if (frozen_) {
      return frozenMs_;
    }
    const auto elapsed = std::chrono::steady_clock::now() - start_;
    const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(elapsed).count();
    return static_cast<uint32_t>(static_cast<double>(ms) * static_cast<double>(speed_));
  }

  float speed() const { return speed_; }
  bool isFrozen() const { return frozen_; }

private:
  float speed_;
  bool frozen_ = false;
  uint32_t frozenMs_ = 0;
  std::chrono::steady_clock::time_point start_ = std::chrono::steady_clock::now();
};

} // namespace skypanel
