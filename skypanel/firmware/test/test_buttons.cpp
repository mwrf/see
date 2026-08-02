#include "Buttons.h"
#include "testing.h"

using namespace skypanel;

namespace {

ButtonInput top(bool down) { return ButtonInput{down, false, false}; }
ButtonInput front(bool down) { return ButtonInput{false, down, down}; }

/// Feed a steady input from `from` to `to` in 10 ms steps, returning the last event
/// that was not `None`.
ButtonEvent hold(Buttons &buttons, ButtonInput input, uint32_t from, uint32_t to) {
  ButtonEvent last = ButtonEvent::None;
  for (uint32_t t = from; t <= to; t += 10) {
    const ButtonEvent event = buttons.update(t, input);
    if (event != ButtonEvent::None) {
      last = event;
    }
  }
  return last;
}

} // namespace

TEST(a_tap_on_the_top_button_cycles_the_info_lines) {
  Buttons buttons;
  hold(buttons, top(true), 0, 200);
  CHECK(hold(buttons, top(false), 210, 400) == ButtonEvent::CycleLines);
}

TEST(holding_the_top_button_cancels_tracking) {
  Buttons buttons;
  CHECK(hold(buttons, top(true), 0, 2000) == ButtonEvent::CancelTracking);
}

TEST(a_long_press_does_not_also_fire_a_tap_on_release) {
  Buttons buttons;
  hold(buttons, top(true), 0, 2000);
  CHECK(hold(buttons, top(false), 2010, 2400) == ButtonEvent::None);
}

TEST(cancel_fires_once_however_long_the_button_is_held) {
  Buttons buttons;
  int fired = 0;
  for (uint32_t t = 0; t <= 8000; t += 10) {
    if (buttons.update(t, top(true)) == ButtonEvent::CancelTracking) {
      fired++;
    }
  }
  CHECK_EQ(fired, 1);
}

TEST(contact_bounce_does_not_produce_phantom_presses) {
  Buttons buttons;
  int events = 0;
  // 5 ms of chatter, well inside the 30 ms debounce window.
  for (uint32_t t = 0; t < 25; t += 5) {
    if (buttons.update(t, top(t % 10 == 0)) != ButtonEvent::None) {
      events++;
    }
  }
  CHECK_EQ(events, 0);
}

TEST(holding_both_front_buttons_for_three_seconds_enters_setup) {
  Buttons buttons;
  CHECK(hold(buttons, front(true), 0, 2500) == ButtonEvent::None);
  CHECK(hold(buttons, front(true), 2510, 3200) == ButtonEvent::EnterSetup);
}

TEST(setup_fires_once_per_hold_not_repeatedly) {
  Buttons buttons;
  int fired = 0;
  for (uint32_t t = 0; t <= 10000; t += 10) {
    if (buttons.update(t, front(true)) == ButtonEvent::EnterSetup) {
      fired++;
    }
  }
  CHECK_EQ(fired, 1);
}

TEST(releasing_and_re_holding_the_front_pair_arms_setup_again) {
  Buttons buttons;
  hold(buttons, front(true), 0, 3200);
  hold(buttons, front(false), 3210, 3400);
  CHECK(hold(buttons, front(true), 3410, 6700) == ButtonEvent::EnterSetup);
}

TEST(one_front_button_alone_never_enters_setup) {
  Buttons buttons;
  const ButtonInput onlyLeft{false, true, false};
  CHECK(hold(buttons, onlyLeft, 0, 8000) == ButtonEvent::None);
  CHECK(!buttons.bothFrontHeld());
}

TEST(the_setup_hold_progress_is_reported_for_the_panel_hint) {
  Buttons buttons;
  buttons.update(0, front(true));
  buttons.update(1500, front(true));
  CHECK_EQ(buttons.setupHoldElapsedMs(1500), 1500u);
  buttons.update(1600, front(false));
  CHECK_EQ(buttons.setupHoldElapsedMs(1600), 0u);
}
