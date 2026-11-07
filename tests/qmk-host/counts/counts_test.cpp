// Key press counts kept on the board (fixture.test.ts → countsHostProject), read over NAVI's Raw HID packets the way
// NAVI reads them. Positions (n = row * 10 + col), “layer keys bring their layer to the top” on:
//   0 KC_A   1 LSFT_T(KC_B)   2 MO(1)   3 KC_C (layer 1: KC_D, layer 2: KC_Z)   4 KC_E (layer 1: transparent)
//   5 LT(2, KC_F)   6 7 G H → combo X   8 MO(2)
#include "../navi_host.hpp"

extern "C" {
#include "eeconfig.h"
#include "raw_hid.h"
void suspend_power_down_user(void);
void keyboard_post_init_user(void);
}
#include NAVI_EXPECT // NAVI_EXPECT_COUNTERS, NAVI_EXPECT_HASH, NAVI_EXPECT_ROWS, NAVI_EXPECT_COLS

static int idx(int layer, int row, int col, int slot) {
    return ((layer * NAVI_EXPECT_ROWS + row) * NAVI_EXPECT_COLS + col) * 2 + slot;
}
static const int COMBO_X = NAVI_EXPECT_COUNTERS - 1; // the only combo, after every key

class NaviCounts : public NaviHost {
   protected:
    NaviCounts() {
        read_all(); // the counts other tests left
    }

    // One packet as NAVI sends it; the keyboard answers in the same buffer.
    std::vector<uint8_t> packet(std::vector<uint8_t> head) {
        uint8_t buf[32] = {0};
        for (size_t i = 0; i < head.size(); i++) buf[i] = head[i];
        raw_hid_receive(buf, 32);
        return std::vector<uint8_t>(buf, buf + 32);
    }

    // READ at offset: the counts it carries (and zeroes on the board).
    std::vector<uint16_t> read_chunk(uint16_t offset) {
        auto r = packet({0x4E, 'K', 'R', (uint8_t)(offset & 0xFF), (uint8_t)(offset >> 8)});
        EXPECT_EQ(r[2], 'R');
        EXPECT_EQ(r[3] | r[4] << 8, offset);
        std::vector<uint16_t> out;
        for (int i = 0; i < r[5]; i++) out.push_back(r[6 + 2 * i] | r[7 + 2 * i] << 8);
        return out;
    }

    // The whole table, chunk by chunk as NAVI reads it.
    std::vector<uint16_t> read_all() {
        std::vector<uint16_t> all;
        while (all.size() < NAVI_EXPECT_COUNTERS) {
            auto chunk = read_chunk(all.size());
            if (chunk.empty()) break;
            all.insert(all.end(), chunk.begin(), chunk.end());
        }
        return all;
    }

    static void preload(int i, uint16_t v) {
        eeconfig_update_user_datablock(&v, (uint32_t)i * 2, 2);
    }
};

TEST_F(NaviCounts, info_names_the_table_navi_expects) {
    auto r = packet({0x4E, 'K', 'I'});
    EXPECT_EQ(r[0], 0x4E);
    EXPECT_EQ(r[1], 'K');
    EXPECT_EQ(r[2], 'I');
    EXPECT_EQ(r[3], 1); // protocol
    EXPECT_EQ((uint32_t)(r[4] | r[5] << 8 | r[6] << 16 | (uint32_t)r[7] << 24), (uint32_t)NAVI_EXPECT_HASH);
    EXPECT_EQ(r[8] | r[9] << 8, NAVI_EXPECT_COUNTERS);
}

TEST_F(NaviCounts, unknown_command_is_answered_as_unknown) {
    EXPECT_EQ(packet({0x4E, 'K', 'Q'})[2], 0xFF);
}

TEST_F(NaviCounts, plain_key_counts_a_press) {
    play({"+0", "-0", "+0", "-0"});
    auto all = read_all();
    ASSERT_EQ(all.size(), (size_t)NAVI_EXPECT_COUNTERS);
    EXPECT_EQ(all[idx(0, 0, 0, 0)], 2);
    EXPECT_EQ(all[idx(0, 0, 0, 1)], 0);
}

TEST_F(NaviCounts, mod_tap_counts_tap_and_hold_apart) {
    play({"+1", "-1"});
    play({"+1", "wait", "-1"});
    play({"+1", "wait", "-1"});
    auto all = read_all();
    EXPECT_EQ(all[idx(0, 0, 1, 0)], 1); // tap
    EXPECT_EQ(all[idx(0, 0, 1, 1)], 2); // hold
}

// MO(2), then MO(1): with layer keys on top layer 1 shows, though layer 2 is higher
TEST_F(NaviCounts, key_counts_on_the_layer_that_showed) {
    EXPECT_EQ(play({"+8", "+2", "+3", "-3", "-2", "-8"}), "D -");
    auto all = read_all();
    EXPECT_EQ(all[idx(1, 0, 3, 0)], 1);
    EXPECT_EQ(all[idx(2, 0, 3, 0)], 0);
    EXPECT_EQ(all[idx(0, 0, 8, 0)], 1); // the layer keys themselves
    EXPECT_EQ(all[idx(0, 0, 2, 0)], 1);
}

TEST_F(NaviCounts, transparent_key_counts_on_the_layer_under_it) {
    EXPECT_EQ(play({"+2", "+4", "-4", "-2"}), "E -");
    auto all = read_all();
    EXPECT_EQ(all[idx(0, 0, 4, 0)], 1);
    EXPECT_EQ(all[idx(1, 0, 4, 0)], 0);
}

TEST_F(NaviCounts, layer_tap_hold_counts_its_hold_and_the_key_on_its_layer) {
    EXPECT_EQ(play({"+5", "wait", "+3", "-3", "-5"}), "Z -");
    auto all = read_all();
    EXPECT_EQ(all[idx(0, 0, 5, 1)], 1);
    EXPECT_EQ(all[idx(2, 0, 3, 0)], 1);
}

TEST_F(NaviCounts, combo_counts_once_and_its_keys_not) {
    EXPECT_EQ(play({"+6", "+7", "-6", "-7"}), "X -");
    auto all = read_all();
    EXPECT_EQ(all[COMBO_X], 1);
    EXPECT_EQ(all[idx(0, 0, 6, 0)], 0);
    EXPECT_EQ(all[idx(0, 0, 7, 0)], 0);
}

TEST_F(NaviCounts, keys_of_a_combo_pressed_alone_count_as_presses) {
    EXPECT_EQ(play({"+6", "-6", "wait"}), "G -");
    auto all = read_all();
    EXPECT_EQ(all[idx(0, 0, 6, 0)], 1);
    EXPECT_EQ(all[COMBO_X], 0);
}

// A count reaching its maximum halves every count
TEST_F(NaviCounts, full_count_halves_every_count) {
    preload(idx(0, 0, 0, 0), 0xFFFE);
    preload(idx(0, 0, 3, 0), 11);
    keyboard_post_init_user(); // power-on: the counts from the EEPROM
    play({"+0", "-0"});
    auto all = read_all();
    EXPECT_EQ(all[idx(0, 0, 0, 0)], 0x7FFF);
    EXPECT_EQ(all[idx(0, 0, 3, 0)], 5);
}

// Saved when the computer suspends USB: a power-on finds them; counts after the save are lost with the power
TEST_F(NaviCounts, counts_saved_on_suspend_survive_a_power_on) {
    play({"+0", "-0", "+0", "-0", "+0", "-0"});
    suspend_power_down_user();
    play({"+0", "-0"});
    keyboard_post_init_user();
    EXPECT_EQ(read_all()[idx(0, 0, 0, 0)], 3);
}

// The counts NAVI read are zeroed and, read to the end, saved: a power-on doesn't bring them back
TEST_F(NaviCounts, read_counts_are_zeroed_and_saved) {
    play({"+0", "-0"});
    suspend_power_down_user();
    EXPECT_EQ(read_all()[idx(0, 0, 0, 0)], 1);
    EXPECT_EQ(read_all()[idx(0, 0, 0, 0)], 0);
    keyboard_post_init_user();
    EXPECT_EQ(read_all()[idx(0, 0, 0, 0)], 0);
}

TEST_F(NaviCounts, table_is_read_in_chunks_of_13) {
    play({"+0", "-0"});
    EXPECT_EQ(read_chunk(0).size(), 13u);
    EXPECT_EQ(read_chunk(13).size(), 13u);
    EXPECT_EQ(read_chunk(NAVI_EXPECT_COUNTERS - 2).size(), 2u);
    EXPECT_EQ(read_chunk(NAVI_EXPECT_COUNTERS).size(), 0u);
}

TEST_F(NaviCounts, chunk_carries_the_counts_at_its_offset) {
    play({"+1", "wait", "-1"});
    int at    = idx(0, 0, 1, 1);
    auto chunk = read_chunk(at);
    ASSERT_FALSE(chunk.empty());
    EXPECT_EQ(chunk[0], 1);
}
