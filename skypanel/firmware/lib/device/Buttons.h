// Button handling as a pure state machine.
//
// No Arduino calls in here — the caller passes in the current time and the raw pin
// states, so the debounce, the long-press timer and the two-button hold can all be
// tested on the desktop. Button bugs on an embedded target are miserable to diagnose
// with an LED and a serial log; this is the one part of the firmware that is cheap to
// make certain about.

#pragma once

#include <cstdint>

namespace skypanel {

enum class ButtonEvent : uint8_t {
  None,
  /// Top button, short press: step through the info lines.
  CycleLines,
  /// Top button, held: leave tracking mode and go back to the nearest aircraft.
  CancelTracking,
  /// Both front buttons held together: re-enter WiFi provisioning.
  EnterSetup,
};

struct ButtonTiming {
  uint32_t debounceMs = 30;
  uint32_t longPressMs = 1200;
  uint32_t setupHoldMs = 3000;
};

/// Raw, active-high pin states for one sample.
struct ButtonInput {
  bool top = false;
  bool frontLeft = false;
  bool frontRight = false;
};

class Buttons {
public:
  explicit Buttons(ButtonTiming timing = {}) : timing_(timing) {}

  /// Feed one sample; returns the event it produced, if any.
  ButtonEvent update(uint32_t nowMs, ButtonInput input);

  /// How long the front pair has been held, for a progress hint on the panel.
  uint32_t setupHoldElapsedMs(uint32_t nowMs) const;

  bool bothFrontHeld() const { return frontHeld_; }

private:
  ButtonTiming timing_;

  bool topStable_ = false;
  bool topPending_ = false;
  uint32_t topChangedAtMs_ = 0;
  uint32_t topDownAtMs_ = 0;
  bool topLongFired_ = false;

  bool frontHeld_ = false;
  uint32_t frontDownAtMs_ = 0;
  bool setupFired_ = false;
};

} // namespace skypanel
