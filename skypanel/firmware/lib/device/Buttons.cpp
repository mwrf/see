#include "Buttons.h"

namespace skypanel {

ButtonEvent Buttons::update(uint32_t nowMs, ButtonInput input) {
  ButtonEvent event = ButtonEvent::None;

  // ---- front pair: hold both to re-enter provisioning.
  const bool bothDown = input.frontLeft && input.frontRight;
  if (bothDown && !frontHeld_) {
    frontHeld_ = true;
    frontDownAtMs_ = nowMs;
    setupFired_ = false;
  } else if (!bothDown && frontHeld_) {
    frontHeld_ = false;
    setupFired_ = false;
  }
  if (frontHeld_ && !setupFired_ && nowMs - frontDownAtMs_ >= timing_.setupHoldMs) {
    setupFired_ = true;
    return ButtonEvent::EnterSetup;
  }

  // ---- top button: debounce, then distinguish a tap from a hold.
  if (input.top != topPending_) {
    topPending_ = input.top;
    topChangedAtMs_ = nowMs;
  }
  if (topPending_ != topStable_ && nowMs - topChangedAtMs_ >= timing_.debounceMs) {
    topStable_ = topPending_;
    if (topStable_) {
      topDownAtMs_ = nowMs;
      topLongFired_ = false;
    } else if (!topLongFired_) {
      // Released before the long-press threshold: it was a tap.
      event = ButtonEvent::CycleLines;
    }
  }
  if (topStable_ && !topLongFired_ && nowMs - topDownAtMs_ >= timing_.longPressMs) {
    // Fire on the threshold rather than on release, so the panel reacts while the
    // finger is still down and the user knows it worked.
    topLongFired_ = true;
    event = ButtonEvent::CancelTracking;
  }

  return event;
}

uint32_t Buttons::setupHoldElapsedMs(uint32_t nowMs) const {
  return frontHeld_ ? nowMs - frontDownAtMs_ : 0;
}

} // namespace skypanel
