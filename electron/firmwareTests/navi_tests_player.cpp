// NAVI's firmware test player (docs/firmware-tests.md): plays every scenario of navi_tests.txt's [tests] section on
// the keymap built into QMK's unit test framework and compares what the computer would get with the expected output.
// NAVI copies this file into a temp test folder with a board stand-in (test.mk, config.h); NAVI_TESTS_FILE (a define,
// or the environment variable of that name) is the path to navi_tests.txt.
//
// Each scenario runs in a forked child, so no state leaks from one to the next. A mismatch prints
//   navi_tests.txt:<line>: <steps>
//     expected: <output>
//     actual: <output>
// and the last line is "navi tests: <passed> passed, <failed> failed". Exit code 0 only when every scenario passed.
#include <fcntl.h>
#include <signal.h>
#include <sys/wait.h>
#include <unistd.h>

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "keyboard_report_util.hpp"
#include "keycode.h"
extern "C" {
#include "debug.h"
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

namespace {

// ── The file ────────────────────────────────────────────────────────────────────────────────────

struct Pos {
    int row, col;
};

// One step: keys pressed together (a tap or chord), a press (+), a release (-) or a wait.
struct Step {
    enum Kind { Tap, Press, Release, Wait } kind;
    std::vector<Pos> keys;
    int              hold   = 20; // ms a tap holds its keys
    int              repeat = 1;
    int              ms     = 0; // Wait
};

struct Scenario {
    int               line;
    std::string       steps_text;
    std::vector<Step> steps;
    std::string       expected;
};

std::string trim(const std::string &s) {
    size_t a = s.find_first_not_of(" \t\r");
    if (a == std::string::npos) return "";
    size_t b = s.find_last_not_of(" \t\r");
    return s.substr(a, b - a + 1);
}

bool parse_int(const std::string &s, int &out) {
    if (s.empty() || s.size() > 6) return false;
    for (char c : s)
        if (c < '0' || c > '9') return false;
    out = std::stoi(s);
    return true;
}

// r<row>c<col>, inside the matrix.
bool parse_pos(const std::string &s, Pos &p) {
    if (s.size() < 4 || s[0] != 'r') return false;
    size_t c = s.find('c');
    if (c == std::string::npos) return false;
    if (!parse_int(s.substr(1, c - 1), p.row) || !parse_int(s.substr(c + 1), p.col)) return false;
    return p.row < MATRIX_ROWS && p.col < MATRIX_COLS;
}

bool parse_step(std::string s, Step &st) {
    if (s.rfind("wait:", 0) == 0) {
        st.kind = Step::Wait;
        return parse_int(s.substr(5), st.ms);
    }
    size_t star = s.find('*');
    if (star != std::string::npos) {
        if (!parse_int(s.substr(star + 1), st.repeat) || st.repeat < 1) return false;
        s = s.substr(0, star);
    }
    if (s[0] == '+' || s[0] == '-') {
        st.kind = s[0] == '+' ? Step::Press : Step::Release;
        Pos p;
        if (!parse_pos(s.substr(1), p)) return false;
        st.keys.push_back(p);
        return true;
    }
    st.kind     = Step::Tap;
    size_t colon = s.find(':');
    if (colon != std::string::npos) {
        if (!parse_int(s.substr(colon + 1), st.hold)) return false;
        s = s.substr(0, colon);
    }
    std::stringstream keys(s);
    std::string       k;
    while (std::getline(keys, k, '+')) {
        Pos p;
        if (!parse_pos(k, p)) return false;
        st.keys.push_back(p);
    }
    return !st.keys.empty();
}

// Reads [tests] (and checks the spots of [keys]); a line it can't read is an error, never skipped.
bool read_file(const std::string &path, std::vector<Scenario> &out, std::string &error) {
    std::ifstream in(path);
    if (!in) {
        error = "cannot open " + path;
        return false;
    }
    std::string section, raw;
    int         n = 0;
    while (std::getline(in, raw)) {
        n++;
        std::string line = trim(raw);
        if (line.empty() || line[0] == '#') continue;
        if (line[0] == '[') {
            section = line;
            continue;
        }
        auto bad = [&](const std::string &why) {
            error = "navi_tests.txt:" + std::to_string(n) + ": " + why + ": " + line;
            return false;
        };
        if (section == "[keys]") {
            // key <layer> r<row>c<col> ...: the spot must be on this board's matrix.
            std::stringstream ss(line);
            std::string       kind, a, b;
            ss >> kind >> a >> b;
            Pos p;
            if (kind == "key" && !parse_pos(b, p)) return bad("a spot outside the matrix");
            continue;
        }
        if (section != "[tests]") continue;
        size_t arrow = line.find("=>");
        if (arrow == std::string::npos) return bad("no =>");
        Scenario sc;
        sc.line       = n;
        sc.steps_text = trim(line.substr(0, arrow));
        sc.expected   = trim(line.substr(arrow + 2));
        std::stringstream ss(sc.steps_text);
        std::string       tok;
        while (ss >> tok) {
            Step st;
            if (!parse_step(tok, st)) return bad("cannot read the step \"" + tok + "\"");
            sc.steps.push_back(st);
        }
        if (sc.steps.empty()) return bad("no steps");
        out.push_back(sc);
    }
    return true;
}

// ── What the computer gets, as text ─────────────────────────────────────────────────────────────

const char *MOD_PREFIX[] = {"C-", "S-", "A-", "G-", "RC-", "RS-", "RA-", "RG-"};
const char *MOD_NAME[]   = {"LCTL", "LSFT", "LALT", "LGUI", "RCTL", "RSFT", "RALT", "RGUI"};

// US QWERTY characters of the printable keys, unshifted and shifted (0 = not printable).
char us_char(uint8_t k, bool shift) {
    if (k >= KC_A && k <= KC_Z) return (char)((shift ? 'A' : 'a') + k - KC_A);
    static const char digits[] = "1234567890", shifted_digits[] = "!@#$%^&*()";
    if (k >= KC_1 && k <= KC_0) return (shift ? shifted_digits : digits)[k - KC_1];
    switch (k) {
        case KC_SPACE: return ' ';
        case KC_MINUS: return shift ? '_' : '-';
        case KC_EQUAL: return shift ? '+' : '=';
        case KC_LEFT_BRACKET: return shift ? '{' : '[';
        case KC_RIGHT_BRACKET: return shift ? '}' : ']';
        case KC_BACKSLASH: return shift ? '|' : '\\';
        case KC_SEMICOLON: return shift ? ':' : ';';
        case KC_QUOTE: return shift ? '"' : '\'';
        case KC_GRAVE: return shift ? '~' : '`';
        case KC_COMMA: return shift ? '<' : ',';
        case KC_DOT: return shift ? '>' : '.';
        case KC_SLASH: return shift ? '?' : '/';
    }
    return 0;
}

std::string key_name(uint8_t k) {
    switch (k) {
        case KC_ENTER: return "ENT";
        case KC_ESCAPE: return "ESC";
        case KC_BACKSPACE: return "BSPC";
        case KC_TAB: return "TAB";
        case KC_CAPS_LOCK: return "CAPS";
        case KC_PRINT_SCREEN: return "PSCR";
        case KC_SCROLL_LOCK: return "SCRL";
        case KC_PAUSE: return "PAUS";
        case KC_INSERT: return "INS";
        case KC_HOME: return "HOME";
        case KC_PAGE_UP: return "PGUP";
        case KC_DELETE: return "DEL";
        case KC_END: return "END";
        case KC_PAGE_DOWN: return "PGDN";
        case KC_RIGHT: return "RGHT";
        case KC_LEFT: return "LEFT";
        case KC_DOWN: return "DOWN";
        case KC_UP: return "UP";
        case KC_APPLICATION: return "APP";
        case KC_NUM_LOCK: return "NUM";
        case KC_KP_SLASH: return "P/";
        case KC_KP_ASTERISK: return "P*";
        case KC_KP_MINUS: return "P-";
        case KC_KP_PLUS: return "P+";
        case KC_KP_ENTER: return "PENT";
        case KC_KP_DOT: return "P.";
        case KC_KP_0: return "P0";
    }
    if (k >= KC_KP_1 && k <= KC_KP_9) return "P" + std::to_string(k - KC_KP_1 + 1);
    if (k >= KC_F1 && k <= KC_F12) return "F" + std::to_string(k - KC_F1 + 1);
    if (k >= KC_F13 && k <= KC_F24) return "F" + std::to_string(k - KC_F13 + 13);
    char hex[8];
    snprintf(hex, sizeof hex, "0x%02X", k);
    return hex;
}

std::string consumer_name(uint16_t u) {
    switch (u) {
        case 0x00E2: return "MUTE";
        case 0x00E9: return "VOLU";
        case 0x00EA: return "VOLD";
        case 0x00CD: return "MPLY";
        case 0x00B5: return "MNXT";
        case 0x00B6: return "MPRV";
        case 0x00B7: return "MSTP";
        case 0x006F: return "BRIU";
        case 0x0070: return "BRID";
    }
    char hex[8];
    snprintf(hex, sizeof hex, "0x%04X", u);
    return hex;
}

int sign(int v) {
    return v > 0 ? 1 : v < 0 ? -1 : 0;
}

// Turns the HID reports into the notation of docs/firmware-tests.md.
class Typist {
   public:
    std::string out;

    void keyboard(const report_keyboard_t &r) {
        uint8_t mods = r.mods;
        unused_ |= mods & ~prev_mods_; // newly held modifiers: no key typed with them yet
        uint8_t released = prev_mods_ & ~mods;
        for (int i = 0; i < 8; i++)
            if (released & unused_ & (1 << i)) out += std::string("⟨") + MOD_NAME[i] + "⟩";
        unused_ &= mods;
        for (int i = 0; i < KEYBOARD_REPORT_KEYS; i++) {
            uint8_t k = r.keys[i];
            if (!k || was_down(k)) continue;
            emit(k, mods);
            unused_ = 0; // every modifier held now was used
        }
        prev_mods_ = mods;
        for (int i = 0; i < KEYBOARD_REPORT_KEYS; i++) prev_keys_[i] = r.keys[i];
    }

    void extra(const report_extra_t &r) {
        if (r.usage && r.usage != prev_usage_) out += "⟨" + consumer_name(r.usage) + "⟩";
        prev_usage_ = r.usage;
    }

    void mouse(const report_mouse_t &r) {
        std::string s;
        if (r.buttons) s += "⟨BTN:" + std::to_string(r.buttons) + "⟩";
        if (r.x || r.y) s += "⟨MS:" + std::to_string(sign(r.x)) + "," + std::to_string(sign(r.y)) + "⟩";
        if (r.v || r.h) s += "⟨WH:" + std::to_string(sign(r.v)) + "," + std::to_string(sign(r.h)) + "⟩";
        if (s != prev_mouse_) out += s;
        prev_mouse_ = s;
    }

   private:
    uint8_t     prev_mods_ = 0, unused_ = 0;
    uint8_t     prev_keys_[KEYBOARD_REPORT_KEYS] = {};
    uint16_t    prev_usage_ = 0;
    std::string prev_mouse_;

    bool was_down(uint8_t k) const {
        for (int i = 0; i < KEYBOARD_REPORT_KEYS; i++)
            if (prev_keys_[i] == k) return true;
        return false;
    }

    void emit(uint8_t k, uint8_t mods) {
        bool shift  = mods & (MOD_BIT(KC_LEFT_SHIFT) | MOD_BIT(KC_RIGHT_SHIFT));
        bool others = mods & ~(MOD_BIT(KC_LEFT_SHIFT) | MOD_BIT(KC_RIGHT_SHIFT));
        char c      = us_char(k, shift);
        if (c && !others) {
            out += c == ' ' ? std::string("␣") : std::string(1, c);
            return;
        }
        std::string s = "⟨";
        for (int i = 0; i < 8; i++)
            if (mods & (1 << i)) s += MOD_PREFIX[i];
        char base = us_char(k, false);
        // A space inside a token stays a space (⟨G- ⟩), as NAVI's model writes it (firmwareTests.ts Typist.emit).
        s += base ? std::string(1, base) : key_name(k);
        out += s + "⟩";
    }
};

std::string tests_file() {
    if (const char *env = getenv("NAVI_TESTS_FILE")) return env;
#ifdef NAVI_TESTS_FILE
    return NAVI_TESTS_FILE;
#else
    return "navi_tests.txt";
#endif
}

} // namespace

// ── Playing ─────────────────────────────────────────────────────────────────────────────────────

class NaviTests : public TestFixture {
   public:
    NaviTests() {
        // Every spot of every layer, as the keymap has it (the fixture looks keys up here, not in keymaps[]).
        for (uint8_t layer = 0; layer < keymap_layer_count_raw(); layer++)
            for (uint8_t row = 0; row < MATRIX_ROWS; row++)
                for (uint8_t col = 0; col < MATRIX_COLS; col++) add_key(KeymapKey(layer, col, row, keycode_at_keymap_location_raw(layer, row, col)));
        ON_CALL(driver, send_keyboard_mock(_)).WillByDefault(Invoke([this](report_keyboard_t &r) { typist.keyboard(r); }));
        ON_CALL(driver, send_extra_mock(_)).WillByDefault(Invoke([this](report_extra_t &r) { typist.extra(r); }));
        ON_CALL(driver, send_mouse_mock(_)).WillByDefault(Invoke([this](report_mouse_t &r) { typist.mouse(r); }));
    }

    // Runs in the child: plays the scenario and returns what was typed.
    std::string play(const Scenario &sc) {
        std::vector<Pos> held;
        idle(50);
        for (const Step &st : sc.steps) {
            for (int n = 0; n < (st.kind == Step::Wait ? 1 : st.repeat); n++) {
                switch (st.kind) {
                    case Step::Wait:
                        idle(st.ms);
                        continue;
                    case Step::Press:
                        press_key(st.keys[0].col, st.keys[0].row);
                        held.push_back(st.keys[0]);
                        break;
                    case Step::Release:
                        release_key(st.keys[0].col, st.keys[0].row);
                        for (size_t i = 0; i < held.size(); i++)
                            if (held[i].row == st.keys[0].row && held[i].col == st.keys[0].col) {
                                held.erase(held.begin() + i);
                                break;
                            }
                        break;
                    case Step::Tap:
                        for (const Pos &p : st.keys) {
                            press_key(p.col, p.row);
                            idle(1);
                        }
                        idle(st.hold > (int)st.keys.size() ? st.hold - (int)st.keys.size() : 0);
                        for (const Pos &p : st.keys) {
                            release_key(p.col, p.row);
                            idle(1);
                        }
                        break;
                }
                idle(20);
            }
        }
        for (const Pos &p : held) {
            release_key(p.col, p.row);
            idle(1);
        }
        idle(2000);
        return typist.out.empty() ? "∅" : typist.out;
    }

   protected:
    void idle(unsigned ms) {
        for (unsigned i = 0; i < ms; i++) {
            idle_for(1);
#ifdef DEFERRED_EXEC_ENABLE
            deferred_exec_task();
#endif
        }
    }

    testing::NiceMock<TestDriver> driver;
    Typist                        typist;
};

// What a child sent back: the output, or why it has none.
static std::string run_child(NaviTests &fixture, const Scenario &sc) {
    int fds[2];
    if (pipe(fds) != 0) return "(no pipe)";
    fflush(stdout);
    fflush(stderr);
    pid_t pid = fork();
    if (pid < 0) return "(fork failed)";
    if (pid == 0) {
        close(fds[0]);
        int devnull = open("/dev/null", O_WRONLY);
        if (devnull >= 0) dup2(devnull, 1); // QMK's debug prints and the keymap's own prints go nowhere
        alarm(30);
        std::string s = fixture.play(sc);
        size_t      off = 0;
        while (off < s.size()) {
            ssize_t w = write(fds[1], s.data() + off, s.size() - off);
            if (w <= 0) break;
            off += (size_t)w;
        }
        _exit(0);
    }
    close(fds[1]);
    std::string s;
    char        buf[4096];
    ssize_t     r;
    while ((r = read(fds[0], buf, sizeof buf)) > 0) s.append(buf, (size_t)r);
    close(fds[0]);
    int status = 0;
    waitpid(pid, &status, 0);
    if (WIFSIGNALED(status)) return WTERMSIG(status) == SIGALRM ? "(stopped: ran over 30 s)" : "(crashed: signal " + std::to_string(WTERMSIG(status)) + ")";
    if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) return "(the scenario's process failed)";
    return s;
}

TEST_F(NaviTests, scenarios) {
    debug_config.raw = 0;
    std::vector<Scenario> scenarios;
    std::string           error;
    if (!read_file(tests_file(), scenarios, error)) {
        printf("navi tests: %s\n", error.c_str());
        FAIL() << error;
    }
    int passed = 0, failed = 0;
    for (const Scenario &sc : scenarios) {
        std::string actual = run_child(*this, sc);
        if (actual == sc.expected) {
            passed++;
            continue;
        }
        failed++;
        printf("navi_tests.txt:%d: %s\n  expected: %s\n  actual: %s\n", sc.line, sc.steps_text.c_str(), sc.expected.c_str(), actual.c_str());
    }
    printf("navi tests: %d passed, %d failed\n", passed, failed);
    fflush(stdout);
    EXPECT_EQ(failed, 0);
}
