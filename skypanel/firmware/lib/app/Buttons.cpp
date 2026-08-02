#include "Buttons.h"

namespace skypanel {

bool ButtonDebouncer::update(bool pressed, uint32_t nowMs) {
  if (pressed != candidate_) {
    candidate_ = pressed;
    candidateSinceMs_ = nowMs;
    return false;
  }
  if (candidate_ == stable_) {
    return false;
  }
  if (nowMs - candidateSinceMs_ < kDebounceMs) {
    return false;
  }
  stable_ = candidate_;
  stableSinceMs_ = nowMs;
  return true;
}

}  // namespace skypanel
