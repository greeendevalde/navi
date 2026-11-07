// Languages (fixture.test.ts → languageHostProject): English types with plain keys, Russian through the own-program
// route (host_text gets what the program would type) and has layer 3; “layer keys on top” is on. Positions:
//   0 NAVI_TO_RU   1 NAVI_TOGGLE_RU   2 NAVI_TO_EN   3 MO(2)   4 KC_A (layer 3: KC_B, layer 2: KC_C)
//   5 LSFT_T(KC_F): holds on KC_J in English, on KC_P in Russian   6 KC_J   7 KC_P   8 KC_LSFT   9 KC_SCLN
//   20 MC_0: tap A, "hi", tap B   21 HELLO: "ok"   22 TO(0)
//   23 TD_TEXT, every tap: 1) "hi", Left, Shift+Home (Shift: "->", End)   2) tap X, "2"   24 LGUI_T(KC_S)
// Layer 2 (symbols, not a typing layer): 10 S(KC_1)   11 KC_SCLN   12 KC_1   13 C(KC_1)   14 KC_A
// Per-language: 25 tap APOS / hold layer 2   26 APOS ("'s" in English, "'" else)   27 DASH (X, in Russian nothing)
#include "../navi_host.hpp"

extern "C" {
uint8_t navi_language(void);
void    navi_set_language(uint8_t language);
extern char host_text[256];
extern char host_switches[16];
}

class Languages : public NaviHost {
   public:
    Languages() {
        navi_set_language(0);
        host_text[0]     = 0;
        host_switches[0] = 0;
    }
};

TEST_F(Languages, english_types_the_base_layer) {
    EXPECT_EQ(play({"+4", "-4"}), "A -");
    EXPECT_EQ(navi_language(), 0);
}

TEST_F(Languages, russian_key_switches_the_program_and_turns_its_layer_on) {
    EXPECT_EQ(play({"+0", "-0", "+4", "-4"}), "B -");
    EXPECT_EQ(navi_language(), 1);
    EXPECT_STREQ(host_switches, "1");
}

TEST_F(Languages, toggle_goes_back_to_english_the_second_time) {
    EXPECT_EQ(play({"+1", "-1", "+4", "-4", "+1", "-1", "+4", "-4"}), "B - A -");
    EXPECT_STREQ(host_switches, "10");
}

TEST_F(Languages, english_key_turns_the_russian_layer_off) {
    EXPECT_EQ(play({"+0", "-0", "+2", "-2", "+4", "-4"}), "A -");
}

// Layer 3 is above layer 2 by number, but the language layer sits under every layer a key turns on.
TEST_F(Languages, held_layer_shows_over_the_language_layer) {
    EXPECT_EQ(play({"+0", "-0", "+3", "+4", "-4", "-3", "+4", "-4"}), "C - B -");
}

TEST_F(Languages, switching_while_a_layer_is_held_puts_the_language_layer_under_it) {
    EXPECT_EQ(play({"+3", "+0", "-0", "+4", "-4", "-3", "+4", "-4"}), "C - B -");
}

TEST_F(Languages, to_keeps_the_language_layer_on) {
    EXPECT_EQ(play({"+0", "-0", "+22", "-22", "+4", "-4"}), "B -");
}

TEST_F(Languages, set_language_from_own_code_changes_the_layer_without_telling_the_program) {
    navi_set_language(1);
    EXPECT_EQ(play({"+4", "-4"}), "B -");
    EXPECT_STREQ(host_switches, "");
}

TEST_F(Languages, hold_key_of_english_holds_in_english) {
    EXPECT_EQ(play({"+5", "+6", "-6", "-5"}), "LSFT LSFT+J LSFT -");
}

TEST_F(Languages, hold_key_of_russian_does_not_hold_in_english) {
    EXPECT_EQ(play({"+5", "+7", "-7", "-5"}).find("LSFT"), std::string::npos);
}

TEST_F(Languages, hold_key_of_russian_holds_in_russian) {
    EXPECT_EQ(play({"+0", "-0", "+5", "+7", "-7", "-5"}), "LSFT LSFT+P LSFT -");
}

TEST_F(Languages, hold_key_of_english_does_not_hold_in_russian) {
    EXPECT_EQ(play({"+0", "-0", "+5", "+6", "-6", "-5"}).find("LSFT"), std::string::npos);
}

TEST_F(Languages, symbol_keys_in_english_are_plain_keys) {
    EXPECT_EQ(play({"+3", "+10", "-10", "+11", "-11", "-3"}), "LSFT LSFT+1 LSFT - 0x33 -");
    EXPECT_STREQ(host_text, "");
}

TEST_F(Languages, symbol_keys_in_russian_type_their_us_character_through_the_program) {
    EXPECT_EQ(play({"+0", "-0", "+3", "+10", "-10", "+11", "-11", "+12", "-12", "-3"}), "");
    EXPECT_STREQ(host_text, "!;1");
}

TEST_F(Languages, held_shift_picks_the_shifted_character) {
    EXPECT_EQ(play({"+0", "-0", "+8", "+3", "+12", "-12", "+11", "-11", "-3", "-8"}), "LSFT -");
    EXPECT_STREQ(host_text, "!:");
}

TEST_F(Languages, ctrl_with_a_symbol_key_stays_a_shortcut) {
    EXPECT_EQ(play({"+0", "-0", "+3", "+13", "-13", "-3"}), "LCTL LCTL+1 LCTL -");
    EXPECT_STREQ(host_text, "");
}

TEST_F(Languages, letters_on_a_symbols_layer_stay_keys) {
    EXPECT_EQ(play({"+0", "-0", "+3", "+14", "-14", "-3"}), "A -");
}

TEST_F(Languages, symbol_keys_on_a_typing_layer_go_to_the_layout) {
    EXPECT_EQ(play({"+0", "-0", "+9", "-9"}), "0x33 -");
    EXPECT_STREQ(host_text, "");
}

TEST_F(Languages, held_symbol_key_repeats_through_the_program) {
    EXPECT_EQ(play({"clock", "+0", "-0", "+3", "+10", "idle:420", "-10", "idle:200", "-3"}), "");
    EXPECT_STREQ(host_text, "!!!!");
}

TEST_F(Languages, macro_in_english_types_its_keys) {
    EXPECT_EQ(play({"+20", "-20"}), "A - H - I - B -");
}

// A held Shift is let go once for the whole macro, its keys before the text included, and put back after
TEST_F(Languages, macro_in_english_with_a_held_shift_lifts_it_once) {
    EXPECT_EQ(play({"+8", "+20", "-20", "-8"}), "LSFT - A - H - I - B - LSFT -");
}

// The keys before the first text are the keyboard's; from the text on, everything goes to the program in order.
TEST_F(Languages, macro_in_russian_sends_its_text_and_later_keys_to_the_program) {
    EXPECT_EQ(play({"+0", "-0", "+20", "-20"}), "A -");
    EXPECT_STREQ(host_text, "hi\x01\x01\x05");
}

TEST_F(Languages, custom_keycode_text_goes_through_the_program_in_russian) {
    EXPECT_EQ(play({"+0", "-0", "+21", "-21"}), "");
    EXPECT_STREQ(host_text, "ok");
    host_text[0] = 0;
    reports.clear();
    EXPECT_EQ(play({"+2", "-2", "+21", "-21"}), "O - K -");
}

// Step 14: an every-tap dance's text types in the language like a macro's
TEST_F(Languages, every_tap_text_in_english_is_plain_keys) {
    EXPECT_EQ(play({"+23", "-23"}), "H - I - 0x50 - LSFT LSFT+0x4A LSFT -");
    EXPECT_STREQ(host_text, "");
}

// From the text on, keys (a key with Shift as Shift's down / up around it) go to the program after the text
TEST_F(Languages, every_tap_text_and_later_keys_go_to_the_program_in_russian) {
    EXPECT_EQ(play({"+0", "-0", "+23", "-23"}), "");
    EXPECT_STREQ(host_text, "hi\x01\x01\x50\x01\x02\xE1\x01\x01\x4A\x01\x03\xE1");
}

// The Shift version is picked; no report is sent while the program is called, so the computer sees Shift held
// throughout (the program lifts it around its typing, docs/languages.md)
TEST_F(Languages, every_tap_shift_version_goes_to_the_program_without_shift) {
    EXPECT_EQ(play({"+0", "-0", "+8", "+23", "-23", "-8"}), "LSFT -");
    EXPECT_STREQ(host_text, "->\x01\x01\x4D");
}

// A key before the text is the keyboard's; the dance cycles on
TEST_F(Languages, every_tap_second_tap_presses_its_key_then_sends_text) {
    EXPECT_EQ(play({"+0", "-0", "+23", "-23", "+23", "-23"}), "X -");
    EXPECT_STREQ(host_text, "hi\x01\x01\x50\x01\x02\xE1\x01\x01\x4A\x01\x03\xE1" "2");
}

// A home row GUI held (misfired) while a step with text plays: the text is typed without it, GUI comes back after
TEST_F(Languages, every_tap_text_plays_without_a_held_gui) {
    EXPECT_EQ(play({"+24", "wait", "+23", "-23", "-24"}), "LGUI H - I - 0x50 - LSFT LSFT+0x4A LSFT - LGUI -");
}

// Per-language actions: APOS ("'s" in English, "'" in the other languages) as a tap-hold key's tap (hold: layer 2)
// at 25 and a plain key at 26; DASH at 27 taps X, in Russian nothing.
TEST_F(Languages, per_language_tap_hold_types_its_english_text_in_english) {
    EXPECT_EQ(play({"+25", "-25"}), "0x34 - S -");
    EXPECT_STREQ(host_text, "");
}

TEST_F(Languages, per_language_tap_hold_types_the_other_languages_text_in_russian) {
    EXPECT_EQ(play({"+0", "-0", "+25", "-25"}), "");
    EXPECT_STREQ(host_text, "'");
}

TEST_F(Languages, per_language_tap_hold_held_is_its_layer) {
    EXPECT_EQ(play({"+25", "wait", "+14", "-14", "-25"}), "A -");
    EXPECT_STREQ(host_text, "");
}

TEST_F(Languages, per_language_plain_key_follows_the_language) {
    EXPECT_EQ(play({"+26", "-26", "+0", "-0", "+26", "-26", "+2", "-2", "+26", "-26"}), "0x34 - S - 0x34 - S -");
    EXPECT_STREQ(host_text, "'");
}

TEST_F(Languages, per_language_entry_of_nothing_does_nothing) {
    EXPECT_EQ(play({"+27", "-27", "+0", "-0", "+27", "-27"}), "X -");
}
