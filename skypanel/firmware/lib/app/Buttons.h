// Physical button semantics, shared by the firmware and the emulator.
//
// The MatrixPortal S3 has one button on top and two on the front edge. The
// emulator maps keys onto these same events, so button behaviour is exercised
// on a laptop rather than discovered on hardware.
#pragma once

#include <cstdint>

namespace skypanel {

enum class ButtonEvent : uint8_t {
  None,
  /// Top button, short press: leave tracking mode / cycle the info lines.
  TopShort,
  /// Top button, long press: force an immediate poll.
  TopLong,
  /// Both front buttons held for 3 s: re-enter WiFi provisioning.
  SetupHold,
};

/// Debounce and classify one button's raw level.
///
/// Written without Arduino calls so it can be unit-tested natively: the caller
/// supplies both the level and the timestamp.
class ButtonDebouncer {
 public:
  static constexpr uint32_t kDebounceMs = 25;
  static constexpr uint32_t kLongPressMs = 700;

  /// Feed a raw reading. ``pressed`` is already active-high.
  /// Returns true on a confirmed state change.
  bool update(bool pressed, uint32_t nowMs);

  bool pressed() const { return stable_; }

  /// Milliseconds the button has been held, or 0 when released.
  uint32_t heldMs(uint32_t nowMs) const {
    return stable_ ? nowMs - stableSinceMs_ : 0;
  }

  bool isLongPress(uint32_t nowMs) const { return heldMs(nowMs) >= kLongPressMs; }

 private:
  bool stable_ = false;
  bool candidate_ = false;
  uint32_t candidateSinceMs_ = 0;
  uint32_t stableSinceMs_ = 0;
};

}  // namespace skypanel
