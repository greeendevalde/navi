// Plays key sequences on the keymap.c NAVI generated (fixture.test.ts) inside QMK's unit test framework and checks
// the HID reports the computer would get. Positions are row 0 of the test matrix:
//   0 LT(1, KC_SPC)   1 LSFT_T(KC_P) hold-preferred   2 KC_C (layer 2: KC_V)
//   3 tap C(KC_Z) / hold layer 2 + Ctrl   4 tap S(KC_1) / hold Alt, hold-preferred   5 tap KC_A / hold C(KC_X)
//   6 LCTL_T(KC_D) holds when KC_C is pressed   7 KC_E   8 tap C(KC_C) / hold Ctrl, a stand-in on KC_ALTERNATE_ERASE
// Tap dances on rows 1 and 2 (position n = row n / 10, column n % 10):
//   10 tap C(KC_C)   11 tap KC_Q / hold LM(1, MOD_LSFT)   12 tap KC_SPC / hold KC_LSFT   13 KC_N (layer 1: KC_A)
//   14 tap KC_T / double tap TG(1) (layer 1: KC_B)   15 tap LT(1, KC_X)
//   16 every tap: "!" (Shift: "->"), "="   17 every tap: "a"   18 every tap: "a" (Shift: nothing)
//   19 every tap: HOST_KEY (the own lines tap KC_Z)   20 own C: host_each taps KC_X on the second tap   21 KC_LSFT
//   22 every tap: tap KC_A, tap KC_B   23 tap: the stand-in at 3 / hold: the stand-in at 4
//   layer 3 (on with 30 + 19, TG(3), or 30 + 20, MO(3)): 10 tap KC_T / double tap TG(3)   6 KC_NO
// Combos (layers 1, 2 and 3 read combo keys from themselves, layer 0 from layer 0):
//   30 MO(1)   31 MO(2)   20 on layer 1: MO(3)
//   32 33 Q W (layer 1: 1 2) → ESC   34 35 R T (layer 2: 3, transparent) → ENTER
//   36 37 Y U → G, only with layer 1 on top   38 39 I O → X on layer 0, Y on layer 1
//   24 LSFT_T(KC_A) holds when KC_Z is pressed   25 26 K L → Z
//   27 28 F H → the every-tap dance at 16
//   13 2 on layer 3 (13 transparent there, 2 KC_8) → 9, only with layer 3 on top; layer 3: 7 KC_A, 8 KC_8 (no combo)
// Auto repeat (delay 300 ms, rate 50 ms), on layer 2 (hold 31):
//   5 MC_0 taps A, repeats   6 REP_KEY types "b", repeats   7 MC_1 taps C, doesn't repeat
// Caps Word rules (letters shifted; "." shifted only with layer 1 on top; TD at 10 keeps it on; any other key ends it):
//   layer 1 (hold 30): 18 CW_TOGG   12 KC_DOT      layer 2 (hold 31): 12 KC_DOT
// Typed text with a Shift held (21), on layer 1 (hold 30): 15 SEMI types ";" (held mods lifted), 16 SEMI_KEEP the same, "keep"   17 macro: ";" then A
#include "navi_host.hpp"

// QMK's replay trap: the mod-tap's press and release were held back behind the undecided LT
TEST_F(NaviHost, hold_preferred_mod_tap_rolled_behind_an_undecided_layer_tap_holds) {
    EXPECT_EQ(play({"+0", "+1", "+2", "-1", "-2", "wait", "-0"}), "LSFT LSFT+C C -");
}

TEST_F(NaviHost, hold_preferred_mod_tap_rolled_alone_holds) {
    EXPECT_EQ(play({"+1", "+2", "-1", "-2"}), "LSFT LSFT+C C -");
}

TEST_F(NaviHost, hold_preferred_mod_tap_tapped_alone_taps) {
    EXPECT_EQ(play({"+1", "-1"}), "P -");
}

TEST_F(NaviHost, tap_of_a_layer_and_ctrl_key_sends_ctrl_z) {
    EXPECT_EQ(play({"+3", "-3"}), "LCTL LCTL+Z LCTL -"); // QMK sends a modded key's modifier first
}

TEST_F(NaviHost, hold_of_a_layer_and_ctrl_key_holds_ctrl_on_layer_2) {
    EXPECT_EQ(play({"+3", "wait", "+2", "-2", "-3"}), "LCTL LCTL+V LCTL -");
}

TEST_F(NaviHost, tap_of_an_alt_key_sends_shift_1) {
    EXPECT_EQ(play({"+4", "-4"}), "LSFT LSFT+1 LSFT -");
}

TEST_F(NaviHost, hold_of_an_alt_key_holds_alt) {
    EXPECT_EQ(play({"+4", "wait", "+2", "-2", "-4"}), "LALT LALT+C LALT -");
}

TEST_F(NaviHost, hold_preferred_stand_in_rolled_behind_an_undecided_layer_tap_holds) {
    EXPECT_EQ(play({"+0", "+4", "+2", "-4", "-2", "wait", "-0"}), "LALT LALT+C C -");
}

TEST_F(NaviHost, key_hold_stand_in_taps_its_tap) {
    EXPECT_EQ(play({"+5", "-5"}), "A -");
}

TEST_F(NaviHost, key_hold_stand_in_holds_its_key) {
    EXPECT_EQ(play({"+5", "wait", "-5"}), "LCTL LCTL+X LCTL -");
}

TEST_F(NaviHost, hold_key_rolled_behind_an_undecided_layer_tap_holds) {
    EXPECT_EQ(play({"+0", "+6", "+2", "-6", "-2", "wait", "-0"}), "LCTL LCTL+C C -");
}

TEST_F(NaviHost, other_key_rolled_behind_an_undecided_layer_tap_still_taps) {
    EXPECT_EQ(play({"+0", "+6", "+7", "-6", "-7", "wait", "-0"}), "D D+E E -");
}

// A stand-in whose base is a real key (KC_ALTERNATE_ERASE, 0x99): the base is never sent
TEST_F(NaviHost, stand_in_on_a_real_key_taps_its_tap) {
    EXPECT_EQ(play({"+8", "-8"}), "LCTL LCTL+C LCTL -");
}

TEST_F(NaviHost, stand_in_on_a_real_key_holds_ctrl) {
    EXPECT_EQ(play({"+8", "wait", "+7", "-7", "-8"}), "LCTL LCTL+E LCTL -");
}

// ── Tap dances ──

// H1: a modded key in a slot
TEST_F(NaviHost, tap_dance_tap_slot_sends_ctrl_c) {
    EXPECT_EQ(play({"+10", "-10"}), "LCTL LCTL+C LCTL -");
}

// H2: a layer + mods key in the hold slot
TEST_F(NaviHost, tap_dance_hold_slot_holds_layer_1_with_shift) {
    EXPECT_EQ(play({"+11", "wait", "+13", "-13", "-11"}), "LSFT LSFT+A LSFT -");
}

// H3: no double tap and no tap-hold: the tap fires on release, before the tapping term ends
TEST_F(NaviHost, tap_only_dance_taps_on_release) {
    EXPECT_EQ(play({"+12", "-12"}, false), "0x2C -");
    EXPECT_EQ(play({"+12", "-12"}, false), "0x2C - 0x2C -"); // a new dance, not a double tap
    EXPECT_EQ(play({}), "0x2C - 0x2C -");
}

TEST_F(NaviHost, tap_only_dance_holds_after_the_term) {
    EXPECT_EQ(play({"+12", "wait", "+13", "-13", "-12"}), "LSFT LSFT+N LSFT -");
}

// H4: a layer toggle on double tap doesn't press the key at the dance's spot on the new layer
TEST_F(NaviHost, tap_dance_double_tap_toggles_layer_1_without_its_key) {
    EXPECT_EQ(play({"+14", "-14", "+14", "-14", "wait"}), "");
    EXPECT_EQ(play({"+13", "-13"}), "A -");
}

// H5: a layer-tap in the tap slot taps its key
TEST_F(NaviHost, tap_dance_layer_tap_in_tap_slot_taps_x) {
    EXPECT_EQ(play({"+15", "-15"}), "X -");
}

// H6: every tap plays the next step at once, adding to what the earlier taps typed, then starts again
TEST_F(NaviHost, every_tap_dance_cycles_its_steps) {
    EXPECT_EQ(play({"+16", "-16"}, false), "LSFT LSFT+1 LSFT -");
    EXPECT_EQ(play({"+16", "-16", "+16", "-16"}), "LSFT LSFT+1 LSFT - 0x2E - LSFT LSFT+1 LSFT -");
}

TEST_F(NaviHost, every_tap_dance_shift_variant_plays_without_shift) {
    EXPECT_EQ(play({"+21", "+16", "-16", "-21"}), "LSFT 0x2D - LSFT LSFT+0x37 LSFT - LSFT -");
}

// H7: a variant not set falls back to no mods; since liftHeldMods the text lets go of a held Shift; one set empty types nothing
TEST_F(NaviHost, every_tap_dance_unset_shift_variant_lifts_the_held_shift_for_its_text) {
    EXPECT_EQ(play({"+21", "+17", "-17", "-21"}), "LSFT A - LSFT -");
}

TEST_F(NaviHost, every_tap_dance_empty_shift_variant_types_nothing) {
    EXPECT_EQ(play({"+21", "+18", "-18", "-21"}), "LSFT -");
}

// H8: a custom keycode played by a step reaches the own lines
TEST_F(NaviHost, every_tap_dance_custom_keycode_runs_own_code) {
    EXPECT_EQ(play({"+19", "-19"}), "Z -");
}

// H9: an own-C dance calls the user's function
TEST_F(NaviHost, own_c_dance_calls_own_function) {
    EXPECT_EQ(play({"+20", "-20", "+20", "-20"}), "X -");
}

// Keys an every-tap step plays don't end the dance (QMK takes any other key's press for an interruption)
TEST_F(NaviHost, every_tap_dance_with_key_steps_keeps_cycling) {
    EXPECT_EQ(play({"+22", "-22", "+22", "-22", "+22", "-22"}), "A - B - A -");
}

// Interrupted by another key = a tap, typed before that key (fast typing: dance down, N down, dance up, N up)
TEST_F(NaviHost, tap_only_dance_interrupted_taps_before_the_other_key) {
    EXPECT_EQ(play({"+12", "+13", "-12", "-13"}), "0x2C - N -");
    reports.clear();
    EXPECT_EQ(play({"+12", "+13", "-13", "-12"}), "0x2C - N -");
}

// A dance with a double tap, interrupted after one tap (released or still held): the tap, then the other key
TEST_F(NaviHost, double_tap_dance_interrupted_after_one_tap_taps_first) {
    EXPECT_EQ(play({"+14", "-14", "+13", "-13"}), "T - N -");
    reports.clear();
    EXPECT_EQ(play({"+14", "+13", "-14", "-13"}), "T - N -");
}

// Interrupted on the second tap: the double tap plays first (TG(1): the other key comes from layer 1)
TEST_F(NaviHost, double_tap_dance_interrupted_on_the_second_tap_plays_the_double_tap_first) {
    EXPECT_EQ(play({"+14", "-14", "+14", "+13", "-13", "-14"}), "A -");
}

// A dance ended by another key's press turns its layer off first: that key is the lower layer's mod-tap from its
// press on (QMK ends the dance in process_record, after its tapping code judged the key by the old layer's KC_NO)
TEST_F(NaviHost, dance_turning_its_layer_off_then_a_mod_tap_below_tapped_taps) {
    EXPECT_EQ(play({"+30", "+19", "-19", "-30", "+10", "-10", "+10", "-10", "+6", "-6"}), "D -");
}

TEST_F(NaviHost, dance_turning_its_layer_off_then_a_mod_tap_below_held_holds) {
    EXPECT_EQ(play({"+30", "+19", "-19", "-30", "+10", "-10", "+10", "-10", "+6", "wait", "+7", "-7", "-6"}), "LCTL LCTL+E LCTL -");
}

// Stand-ins of tap-hold keys with actions in the slots: their tap and hold sides
TEST_F(NaviHost, tap_dance_stand_in_in_tap_slot_taps_its_tap) {
    EXPECT_EQ(play({"+23", "-23"}), "LCTL LCTL+Z LCTL -");
}

TEST_F(NaviHost, tap_dance_stand_in_in_hold_slot_holds_its_hold) {
    EXPECT_EQ(play({"+23", "wait", "+7", "-7", "-23"}), "LALT LALT+E LALT -");
}

// C1: layer 1 reads combo keys from itself (1 2), layer 0 from layer 0 (Q W)
TEST_F(NaviHost, combo_on_a_layer_reading_itself_fires_by_its_own_keys) {
    EXPECT_EQ(play({"+30", "+32", "+33", "-32", "-33", "-30"}), "0x29 -");
}

TEST_F(NaviHost, combo_fires_on_layer_0_by_layer_0_keys) {
    EXPECT_EQ(play({"+32", "+33", "-32", "-33"}), "0x29 -");
}

TEST_F(NaviHost, keys_of_a_layer_reading_itself_type_alone) {
    EXPECT_EQ(play({"+30", "+32", "-32", "-30"}), "1 -");
}

// C2: on layer 2 (reads itself) 35 is transparent: it reads layer 0's reference, so the combo still fires
TEST_F(NaviHost, combo_with_a_transparent_key_fires_on_a_layer_reading_itself) {
    EXPECT_EQ(play({"+31", "+34", "+35", "-34", "-35", "-31"}), "0x28 -");
}

// C8: on layer 3 (held from layer 1) 13 is transparent: QMK matches the key it falls through to, layer 1's KC_A
TEST_F(NaviHost, combo_with_a_transparent_key_fires_by_the_key_of_the_layer_under_it) {
    EXPECT_EQ(play({"+30", "+20", "+13", "+2", "-13", "-2", "-20", "-30"}), "9 -");
}

// The same keycodes on other spots of layer 3 (7 KC_A, 8 KC_8) are no combo: QMK matches keycodes, NAVI's combo is
// its key spots
TEST_F(NaviHost, combo_keycodes_on_other_spots_type_their_keys) {
    EXPECT_EQ(play({"+30", "+20", "+7", "+8", "-7", "-8", "-20", "-30"}), "A A+8 8 -");
}

// Layer 1's key let go while layer 3 stays held: 13 falls through to layer 0's KC_N
TEST_F(NaviHost, combo_with_a_transparent_key_fires_by_the_base_key_once_the_layer_under_it_is_off) {
    EXPECT_EQ(play({"+30", "+20", "-30", "+13", "+2", "-13", "-2", "-20"}), "9 -");
}

// C3: limited to layer 1, which must be the highest active layer
TEST_F(NaviHost, combo_limited_to_layer_1_does_not_fire_under_layer_2) {
    EXPECT_EQ(play({"+30", "+31", "+36", "+37", "-36", "-37", "-31", "-30"}), "Y Y+U U -");
}

TEST_F(NaviHost, combo_limited_to_layer_1_fires_with_layer_1_on_top) {
    EXPECT_EQ(play({"+30", "+36", "+37", "-36", "-37", "-30"}), "G -");
}

// C4: the same keys, one combo per layer
TEST_F(NaviHost, same_keys_give_x_on_layer_0) {
    EXPECT_EQ(play({"+38", "+39", "-38", "-39"}), "X -");
}

TEST_F(NaviHost, same_keys_give_y_on_layer_1) {
    EXPECT_EQ(play({"+30", "+38", "+39", "-38", "-39", "-30"}), "Y -");
}

// C5: a mod-tap that holds when KC_Z is pressed, rolled into the combo whose result is KC_Z
TEST_F(NaviHost, mod_tap_rolled_into_a_combo_holds_for_its_result) {
    EXPECT_EQ(play({"+24", "+25", "+26", "-24", "-25", "-26"}), "LSFT LSFT+Z Z -");
}

TEST_F(NaviHost, mod_tap_rolled_into_a_combo_behind_an_undecided_layer_tap_holds) {
    EXPECT_EQ(play({"+0", "+24", "+25", "+26", "-24", "-25", "-26", "wait", "-0"}), "LSFT LSFT+Z Z -");
}

TEST_F(NaviHost, mod_tap_tapped_before_a_combo_taps) {
    EXPECT_EQ(play({"+24", "-24", "+25", "+26", "-25", "-26"}), "A - Z -");
}
// C6: a combo whose result is the every-tap dance at 16 ("!", Shift: "->"); alone it types "!"
TEST_F(NaviHost, combo_result_every_tap_dance_types_its_first_step) {
    EXPECT_EQ(play({"+27", "+28", "-27", "-28"}, false), "LSFT LSFT+1 LSFT -");
}

// The combo pressed twice is the dance's second tap ("="): its own keys' presses must not end the dance before
// process_combo takes them
TEST_F(NaviHost, combo_result_every_tap_dance_tapped_twice_types_its_second_step) {
    EXPECT_EQ(play({"+27", "+28", "-27", "-28", "+27", "+28", "-27", "-28"}, false), "LSFT LSFT+1 LSFT - 0x2E -");
}

// A hold-preferred LSFT_T (1) rolled into the combo holds, and the dance plays its Shift variant
TEST_F(NaviHost, hold_preferred_mod_tap_rolled_into_a_tap_dance_combo_plays_the_shift_variant) {
    EXPECT_EQ(play({"+1", "+27", "+28", "-27", "-28", "-1"}), "LSFT 0x2D - LSFT LSFT+0x37 LSFT - LSFT -");
}

// C7: a combo whose result is a slots dance (TD 12: tap C(KC_C), hold KC_LSFT). A combo event sits at matrix 0,0,
// where the real key 0 (LT(1, KC_SPC)) is: the dance must not take its position. QMK keeps a combo whose keys are all
// down until COMBO_TERM runs out, and the dance's tapping term starts only then: a hold needs two waits.
TEST_F(NaviHost, combo_slots_dance_tapped_taps_ctrl_c) {
    EXPECT_EQ(play({"+9", "+29", "-9", "-29"}), "LCTL LCTL+C LCTL -");
}

TEST_F(NaviHost, combo_slots_dance_held_shifts_another_key) {
    EXPECT_EQ(play({"+9", "+29", "wait", "wait", "+7", "-7", "-9", "-29"}), "LSFT LSFT+E LSFT -");
}

TEST_F(NaviHost, combo_slots_dance_held_while_the_key_at_0_0_is_tapped) {
    EXPECT_EQ(play({"+9", "+29", "wait", "wait", "+0", "-0", "-9", "-29", "+32", "-32"}), "LSFT LSFT+0x2C LSFT - Q -");
}

TEST_F(NaviHost, combo_slots_dance_held_while_the_key_at_0_0_holds_its_layer) {
    EXPECT_EQ(play({"+9", "+29", "wait", "wait", "+0", "wait", "-9", "-29", "-0", "+32", "-32"}), "LSFT - Q -");
}

TEST_F(NaviHost, combo_slots_dance_tapped_on_the_layer_of_the_key_at_0_0) {
    EXPECT_EQ(play({"+0", "wait", "+9", "+29", "-9", "-29", "-0", "+32", "-32"}), "LCTL LCTL+C LCTL - Q -");
}

// The user's C (post_process_record_user in the own lines) sees the dance's C(KC_C) as the combo's: a COMBO_EVENT at
// the position QMK gave the combo, not the key at matrix 0, 0. A dance on a real key plays at that key.
extern "C" uint8_t host_probe_type, host_probe_row, host_probe_col;
TEST_F(NaviHost, combo_slots_dance_plays_its_key_as_a_combo_event) {
    host_probe_type = host_probe_row = host_probe_col = 0xFF;
    EXPECT_EQ(play({"+9", "+29", "-9", "-29"}), "LCTL LCTL+C LCTL -");
    EXPECT_EQ(host_probe_type, COMBO_EVENT);
    EXPECT_EQ(host_probe_row, 0);
    EXPECT_EQ(host_probe_col, 0);
}

TEST_F(NaviHost, dance_on_a_key_plays_its_key_as_a_key_event_at_that_key) {
    host_probe_type = host_probe_row = host_probe_col = 0xFF;
    EXPECT_EQ(play({"+10", "-10"}), "LCTL LCTL+C LCTL -");
    EXPECT_EQ(host_probe_type, KEY_EVENT);
    EXPECT_EQ(host_probe_row, 1);
    EXPECT_EQ(host_probe_col, 0);
}

TEST_F(NaviHost, key_at_0_0_taps_normally_after_a_combo_slots_dance_hold) {
    EXPECT_EQ(play({"+9", "+29", "wait", "wait", "-9", "-29", "+0", "-0"}), "LSFT - 0x2C -");
}

// Auto repeat: a ticked key runs its action on press, again after the delay (300 ms), then every 50 ms until released.
TEST_F(NaviHost, repeating_macro_held_runs_again_after_the_delay_then_at_the_rate) {
    EXPECT_EQ(play({"clock", "+31", "+5", "idle:420", "-5", "idle:200", "-31"}), "A - A - A - A -");
}

TEST_F(NaviHost, repeating_macro_tapped_runs_once) {
    EXPECT_EQ(play({"clock", "+31", "+5", "-5", "idle:400", "-31"}), "A -");
}

TEST_F(NaviHost, repeating_custom_keycode_held_repeats_its_string) {
    EXPECT_EQ(play({"clock", "+31", "+6", "idle:320", "-6", "-31"}), "B - B -");
}

// One key repeats at a time: the last pressed. The earlier one does not come back when the newer is released.
TEST_F(NaviHost, repeating_key_pressed_last_takes_over_the_repeat) {
    EXPECT_EQ(play({"clock", "+31", "+5", "idle:100", "+6", "idle:320", "-6", "idle:400", "-5", "-31"}), "A - B - B -");
}

TEST_F(NaviHost, releasing_the_older_repeating_key_does_not_stop_the_newer) {
    EXPECT_EQ(play({"clock", "+31", "+5", "idle:100", "+6", "idle:50", "-5", "idle:270", "-6", "-31"}), "A - B - B -");
}

TEST_F(NaviHost, macro_not_ticked_does_not_repeat) {
    EXPECT_EQ(play({"clock", "+31", "+7", "idle:420", "-7", "-31"}), "C -");
}

// Caps Word key rules. CW_TOGG sits on layer 1 (hold 30); the keys after it are played on layer 0 unless noted.
// Caps Word's state outlives a test (CW_TOGG would turn a leftover "on" off), so each test ends with it off.
extern "C" void caps_word_off(void);
class CapsWordHost : public NaviHost {
   protected:
    void TearDown() override {
        caps_word_off();
        NaviHost::TearDown();
    }
};
TEST_F(CapsWordHost, caps_word_shifts_a_letter_of_the_letters_rule) {
    EXPECT_EQ(play({"+30", "+18", "-18", "-30", "+2", "-2"}), "LSFT LSFT+C LSFT");
}

// The stand-in tap-hold key's tap (KC_A) is played by NAVI before QMK's Caps Word sees the event.
TEST_F(CapsWordHost, caps_word_shifts_the_tap_of_a_stand_in_tap_hold_key) {
    EXPECT_EQ(play({"+30", "+18", "-18", "-30", "+5", "-5", "+2", "-2"}), "LSFT LSFT+A LSFT LSFT+C LSFT");
}

// "." is shifted by the rule only with layer 1 on top; on layer 2 the rule does not count, so the key ends Caps Word.
TEST_F(CapsWordHost, caps_word_key_in_a_rule_for_another_layer_ends_it) {
    EXPECT_EQ(play({"+30", "+18", "-18", "-30", "+31", "+12", "-12", "-31", "+2", "-2"}), "0x37 - C -");
}

TEST_F(CapsWordHost, caps_word_layer_rule_shifts_its_key_on_that_layer_and_keeps_it_on) {
    EXPECT_EQ(play({"+30", "+18", "-18", "+12", "-12", "-30", "+2", "-2"}), "LSFT LSFT+0x37 LSFT LSFT+C LSFT");
}

TEST_F(CapsWordHost, caps_word_tap_dance_in_a_keep_rule_keeps_it_on) {
    EXPECT_EQ(play({"+30", "+18", "-18", "-30", "+11", "-11", "wait", "+2", "-2"}), "LSFT LSFT+Q LSFT LSFT+C LSFT");
}

TEST_F(CapsWordHost, caps_word_key_in_no_rule_ends_it) {
    EXPECT_EQ(play({"+30", "+18", "-18", "-30", "+0", "-0", "+2", "-2"}), "0x2C - C -");
}

// Typed text lets go of the Shift you hold and puts it back after: the host gets ";", not ":"
TEST_F(NaviHost, send_string_key_lifts_a_held_shift_while_it_types) {
    EXPECT_EQ(play({"+21", "+30", "+15", "-15", "-30", "-21"}), "LSFT - 0x33 - LSFT -");
}

TEST_F(NaviHost, send_string_key_marked_keep_types_with_the_held_shift) {
    EXPECT_EQ(play({"+21", "+30", "+16", "-16", "-30", "-21"}), "LSFT LSFT+0x33 LSFT -");
}

// A lift covers the whole macro, its key steps too (17: types ";", then taps A)
TEST_F(NaviHost, macro_lifts_a_held_shift_for_its_text_and_its_keys) {
    EXPECT_EQ(play({"+21", "+30", "+17", "-17", "-30", "-21"}), "LSFT - 0x33 - A - LSFT -");
}

TEST_F(NaviHost, send_string_key_without_a_held_mod_sends_no_extra_reports) {
    EXPECT_EQ(play({"+30", "+15", "-15", "-30"}), "0x33 -");
}
