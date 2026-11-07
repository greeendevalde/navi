// Key press counts, the “my own program” route (fixture.test.ts → hostProject turns it on): NAVI's C calls
// navi_key_count_user for each real key press and combo; this file is the user's C that records the calls.
// Positions as in qmk_host_test.cpp.
#include <cstring>

#include "navi_host.hpp"

struct CountCall {
    uint8_t layer, row, col, kind;
    bool    operator==(const CountCall &o) const {
        return layer == o.layer && row == o.row && col == o.col && kind == o.kind;
    }
};
static std::vector<CountCall> count_calls;

enum { PRESS, TAP, HOLD, COMBO }; // NAVI_COUNT_PRESS, _TAP, _HOLD, _COMBO

extern "C" {
void        navi_key_count_user(uint8_t layer, uint8_t row, uint8_t col, uint8_t kind) {
    count_calls.push_back({layer, row, col, kind});
}
const char *navi_layer_name(uint8_t layer);
const char *navi_combo_name(uint16_t combo_index);
}

std::ostream &operator<<(std::ostream &os, const CountCall &c) {
    return os << "{layer " << (int)c.layer << ", " << (int)c.row << "," << (int)c.col << ", kind " << (int)c.kind << "}";
}

class NaviCountsProgram : public NaviHost {
   protected:
    NaviCountsProgram() {
        count_calls.clear();
    }
};

TEST_F(NaviCountsProgram, plain_key_counts_one_press) {
    play({"+2", "-2"});
    EXPECT_EQ(count_calls, (std::vector<CountCall>{{0, 0, 2, PRESS}}));
}

TEST_F(NaviCountsProgram, mod_tap_counts_its_tap_or_its_hold) {
    play({"+1", "-1"});
    play({"+1", "wait", "-1"});
    EXPECT_EQ(count_calls, (std::vector<CountCall>{{0, 0, 1, TAP}, {0, 0, 1, HOLD}}));
}

// The tap NAVI plays for a tap-hold key with actions (S(KC_1) at 4) is no second press
TEST_F(NaviCountsProgram, tap_hold_key_with_actions_counts_once) {
    EXPECT_EQ(play({"+4", "-4"}), "LSFT LSFT+1 LSFT -");
    EXPECT_EQ(count_calls, (std::vector<CountCall>{{0, 0, 4, TAP}}));
}

// The replay trap: QMK makes the mod-tap a tap, NAVI turns it into a hold: counted as the hold
TEST_F(NaviCountsProgram, tap_turned_into_a_hold_counts_as_a_hold) {
    EXPECT_EQ(play({"+0", "+1", "+2", "-1", "-2", "wait", "-0"}), "LSFT LSFT+C C -");
    ASSERT_GE(count_calls.size(), 2u);
    EXPECT_EQ(count_calls[1], (CountCall{0, 0, 1, HOLD}));
}

// A key on layer 1 (hold 30) counts on layer 1; a transparent one on the layer it falls through to
TEST_F(NaviCountsProgram, key_counts_on_the_layer_its_action_came_from) {
    play({"+30", "+13", "-13", "+2", "-2", "-30"});
    EXPECT_EQ(count_calls, (std::vector<CountCall>{{0, 3, 0, PRESS}, {1, 1, 3, PRESS}, {0, 0, 2, PRESS}}));
}

// A combo counts as a combo (row: its QMK index), not as its keys; each QMK combo of a project combo has its name
TEST_F(NaviCountsProgram, combo_counts_as_a_combo_by_name) {
    EXPECT_EQ(play({"+32", "+33", "-32", "-33"}), "0x29 -");
    ASSERT_EQ(count_calls.size(), 1u);
    EXPECT_EQ(count_calls[0].kind, COMBO);
    EXPECT_STREQ(navi_combo_name(count_calls[0].row), "c1_self");
    count_calls.clear();
    reports.clear();
    EXPECT_EQ(play({"+30", "+32", "+33", "-32", "-33", "-30"}), "0x29 -");
    ASSERT_EQ(count_calls.size(), 2u); // MO(1), then the combo
    EXPECT_EQ(count_calls[1].kind, COMBO);
    EXPECT_EQ(count_calls[1].layer, 1);
    EXPECT_STREQ(navi_combo_name(count_calls[1].row), "c1_self");
}

TEST_F(NaviCountsProgram, layer_names_are_the_c_names) {
    EXPECT_STREQ(navi_layer_name(0), "L_BASE");
    EXPECT_EQ(navi_layer_name(200), nullptr);
    EXPECT_EQ(navi_combo_name(500), nullptr);
}
