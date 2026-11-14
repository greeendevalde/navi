// Hold spots, the one-shot cancel and the tap-hold tap length, 30 ms (fixture.test.ts → optionsHostProject). Positions (n = row * 10 + col):
//   0 LT(1, KC_SPC)   1 LGUI_T(KC_Q): holds when a key at 5, 13 or 39 is pressed   2 KC_C   3 MO(1)
//   4 OSM(MOD_LSFT), a second tap cancels it   5 KC_E (layer 1: KC_A)   6 KC_X (layer 1: the task switcher key)   13 KC_N   39 KC_S
#include "../navi_host.hpp"

// A press at a spot makes the tap-hold key a hold at once, whatever the key types there
TEST_F(NaviHost, hold_spot_press_makes_the_tap_hold_key_a_hold) {
    EXPECT_EQ(play({"+1", "+5", "-5", "-1"}), "LGUI LGUI+E LGUI -");
}

TEST_F(NaviHost, hold_spot_in_the_last_row_makes_the_tap_hold_key_a_hold) {
    EXPECT_EQ(play({"+1", "+39", "-39", "-1"}), "LGUI LGUI+S LGUI -");
}

TEST_F(NaviHost, hold_spot_counts_by_position_not_by_keycode_on_another_layer) {
    EXPECT_EQ(play({"+3", "+1", "+5", "-5", "-1", "-3"}), "LGUI LGUI+A LGUI -");
}

TEST_F(NaviHost, key_outside_the_spots_rolled_in_still_taps) {
    EXPECT_EQ(play({"+1", "+2", "-1", "-2"}), "Q Q+C C -");
}

// QMK's replay trap: the tap-hold key's press and release wait behind the undecided layer-tap
TEST_F(NaviHost, hold_spot_rolled_behind_an_undecided_layer_tap_holds) {
    EXPECT_EQ(play({"+0", "+1", "+39", "-1", "-39", "wait", "-0"}), "LGUI LGUI+S S -");
}

TEST_F(NaviHost, key_outside_the_spots_rolled_behind_an_undecided_layer_tap_still_taps) {
    EXPECT_EQ(play({"+0", "+1", "+2", "-1", "-2", "wait", "-0"}), "Q Q+C C -");
}

// A second tap of a one-shot mod cancels it
TEST_F(NaviHost, one_tap_of_a_one_shot_shift_shifts_the_next_key) {
    EXPECT_EQ(play({"+4", "-4", "+5", "-5"}), "LSFT+E -"); // the one-shot Shift is a weak mod: it goes out in the key's own report
}

TEST_F(NaviHost, second_tap_of_a_one_shot_shift_cancels_it) {
    EXPECT_EQ(play({"+4", "-4", "+4", "-4", "+5", "-5"}), "E -");
}

TEST_F(NaviHost, one_shot_shift_works_again_after_a_cancel) {
    EXPECT_EQ(play({"+4", "-4", "+4", "-4", "+4", "-4", "+5", "-5"}), "LSFT+E -");
}

TEST_F(NaviHost, cancel_leaves_a_held_shift_alone) {
    // The real Shift is the OSM key's own hold: held past the term it is a plain Shift, not a one-shot
    EXPECT_EQ(play({"+4", "wait", "+5", "-5", "-4"}), "LSFT LSFT+E LSFT -");
}

// The task switcher key (6, layer 1 by holding 3) holds Ctrl+Alt+Tab while held: the computer's key repeat moves on
TEST_F(NaviHost, task_switcher_key_holds_ctrl_alt_tab_while_held) {
    EXPECT_EQ(play({"+3", "+6", "+5", "-5", "-6", "-3"}), "LCTL+LALT LCTL+LALT+0x2B 0x2B+A 0x2B - 0x28 -"); // A clears the weak mods, as QMK does
}

// The layer key let go with the switcher key still held: Ctrl+Alt+Tab goes up first, Enter picks alone
TEST_F(NaviHost, task_switcher_pick_with_the_key_still_held_lets_go_of_it_first) {
    EXPECT_EQ(play({"+3", "+6", "-3", "-6"}), "LCTL+LALT LCTL+LALT+0x2B LCTL+LALT - 0x28 -");
}

// A quick tap: the layer key let go right after the switcher key. Enter waits until 150 ms after the press, since
// Windows opens the switcher a moment later and an earlier Enter leaves it open
TEST_F(NaviHost, task_switcher_pick_waits_for_the_switcher_to_open) {
    EXPECT_EQ(play({"+3", "+6", "-6", "-3", "idle:140"}, false), "LCTL+LALT LCTL+LALT+0x2B LCTL+LALT -");
    EXPECT_EQ(play({"idle:20"}, false), "LCTL+LALT LCTL+LALT+0x2B LCTL+LALT - 0x28 -");
}

// A key pressed while the pick waits: Enter goes first, so the key reaches the picked window
TEST_F(NaviHost, task_switcher_pick_goes_before_a_key_pressed_while_it_waits) {
    EXPECT_EQ(play({"+3", "+6", "-6", "-3", "+5", "-5"}), "LCTL+LALT LCTL+LALT+0x2B LCTL+LALT - 0x28 - E -");
}

// A tap-hold key's tap stays down 30 ms (firmware.tapHoldTapMs): QMK alone sends its release in the same scan
TEST_F(NaviHost, tap_hold_tap_stays_down_the_tap_length) {
    EXPECT_EQ(play({"+1", "-1"}), "Q -");
    EXPECT_GE(report_times[1] - report_times[0], 30u);
}

// A plain key's tap isn't held back
TEST_F(NaviHost, plain_key_tap_is_not_held_back) {
    EXPECT_EQ(play({"+2", "-2"}), "C -");
    EXPECT_LT(report_times[1] - report_times[0], 30u);
}
