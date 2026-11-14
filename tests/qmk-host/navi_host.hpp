// Shared by the host test suites (qmk_host_test.cpp, languages/): a fixture that plays key sequences and records the
// HID reports the computer would get, as text.
#pragma once

#include <string>
#include <vector>

#include "keyboard_report_util.hpp"
#include "keycode.h"
extern "C" {
#include "keymap_introspection.h"
}
#include "test_common.hpp"
#include "test_fixture.hpp"
#include "test_keymap_key.hpp"

using testing::_;
using testing::Invoke;

#ifdef DEFERRED_EXEC_ENABLE
// QMK's main loop runs the deferred executors (quantum/main.c); the test fixture's keyboard task doesn't.
extern "C" void deferred_exec_task(void);
#endif
extern "C" void set_time(uint32_t t);
// The latest time any test reached: each test restarts the clock at 0, but the deferred executors remember the time
// of their last check (a static in deferred_exec.c) and run only once the clock passes it.
static uint32_t latest_time = 0;

// A report as text: modifiers and keys joined by +, "-" when nothing is down. Letters and digits by name.
static std::string report_text(const report_keyboard_t &r) {
    static const char *mod_names[] = {"LCTL", "LSFT", "LALT", "LGUI", "RCTL", "RSFT", "RALT", "RGUI"};
    std::vector<std::string> parts;
    for (int i = 0; i < 8; i++)
        if (r.mods & (1 << i)) parts.push_back(mod_names[i]);
    for (int i = 0; i < KEYBOARD_REPORT_KEYS; i++) {
        uint8_t k = r.keys[i];
        if (!k) continue;
        if (k >= KC_A && k <= KC_Z)
            parts.push_back(std::string(1, (char)('A' + k - KC_A)));
        else if (k >= KC_1 && k <= KC_9)
            parts.push_back(std::string(1, (char)('1' + k - KC_1)));
        else {
            char hex[8];
            snprintf(hex, sizeof hex, "0x%02X", k);
            parts.push_back(hex);
        }
    }
    if (parts.empty()) return "-";
    std::string s;
    for (auto &p : parts) s += (s.empty() ? "" : "+") + p;
    return s;
}

class NaviHost : public TestFixture {
   public:
    NaviHost() {
        for (uint8_t layer = 0; layer < keymap_layer_count_raw(); layer++)
            for (uint8_t row = 0; row < MATRIX_ROWS; row++)
                for (uint8_t col = 0; col < MATRIX_COLS; col++) add_key(KeymapKey(layer, col, row, keycode_at_keymap_location_raw(layer, row, col)));
        ON_CALL(driver, send_keyboard_mock(_)).WillByDefault(Invoke([this](report_keyboard_t &r) {
            std::string t = report_text(r);
            if (reports.empty() || reports.back() != t) {
                reports.push_back(t);
                report_times.push_back(timer_read32());
            }
        }));
    }

   protected:
    // idle_for, plus the deferred executors each ms as QMK's main loop runs them (auto repeat).
    void idle(unsigned ms) {
        for (unsigned i = 0; i < ms; i++) {
            idle_for(1);
#ifdef DEFERRED_EXEC_ENABLE
            deferred_exec_task();
#endif
            if (timer_read32() > latest_time) latest_time = timer_read32();
        }
    }

    // Presses (+n) and releases (-n) one scan apart, n = row * 10 + col; "wait" waits out the tapping term,
    // "idle:N" waits N ms, "clock" moves the clock past earlier tests' (needed for deferred execution).
    // settle: wait out the tapping term at the end too (false: the reports as they are right after the last step).
    std::string play(const std::vector<std::string> &steps, bool settle = true) {
        for (auto &s : steps) {
            if (s == "wait") {
                idle(TAPPING_TERM + 1);
                continue;
            }
            if (s == "clock") { // move the clock past every earlier test's, so deferred executors run (see latest_time)
                set_time(latest_time + 1);
                continue;
            }
            if (s.rfind("idle:", 0) == 0) {
                idle(std::stoi(s.substr(5)));
                continue;
            }
            int n = std::stoi(s.substr(1));
            if (s[0] == '+')
                press_key(n % 10, n / 10);
            else
                release_key(n % 10, n / 10);
            idle(1);
        }
        if (settle) idle(TAPPING_TERM + 1);
        std::string joined;
        for (auto &r : reports) joined += (joined.empty() ? "" : " ") + r;
        return joined;
    }

    testing::NiceMock<TestDriver> driver;
    std::vector<std::string>      reports;
    std::vector<uint32_t>         report_times; // the clock at each of reports
};
