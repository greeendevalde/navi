# Firmware tests (`navi_tests.txt`)

With Firmware → Keymap files → "write firmware tests" on (`firmware.tests`), NAVI writes `navi_tests.txt` beside
`keymap.c`, with its other generated files (same write, same diff, same backup). It holds key-press scenarios
and the output the project says each one must give. NAVI rewrites it on every write, so a change made in NAVI
updates the tests along with the firmware; never edit it by hand.

The expected output is worked out from the project's keycodes alone, never from the generated C, so a generator
bug, the user's own C stepping on a NAVI key, or a QMK update shows as a mismatch.

A test harness plays the file in QMK's unit test framework: NAVI's own runner (Firmware → Flash → "Run the
firmware tests before flashing") or the user's own.

## File layout

Plain UTF-8, LF. A line starting with `#` is a comment; blank lines are ignored. Three sections, in this order,
each starting with its header line:

```
# navi_tests.txt: written by NAVI from "<project name>". Don't edit: NAVI rewrites it.
# Format: docs/firmware-tests.md in NAVI.
[keys]
key 0 r0c1 KC_Q
key 0 r1c1 LGUI_T(KC_A) tap=KC_A alias=NV_HOME_A
combo CM_ESC 0,1 r0c1+r0c2
dance TD_X r2c4
[not checked]
r3c5 on layer 2 (Nav): MY_KEY, a custom keycode your code handles
[tests]
# Layer 0 (BASE): every key tapped
r0c1 => q
r1c1:300 => ∅
+r3c2 r0c1 -r3c2 => 1
```

### `[keys]`: what each spot is, per layer

For a harness that finds keys by meaning instead of by position. One line per spot per layer (transparent
spots included, as `KC_TRNS`), then one per combo and per tap dance.

- `key <layer> r<row>c<col> <keycode> [tap=<keycode>] [alias=<C name>]`: the layer's index, the matrix
  position, the stored keycode as a QMK expression (the codec's text), the keycode a tap sends when it isn't
  the stored one (an `MT` / `LT`'s tap, a tap-hold action's tap slot), and the key alias's C name when the
  keycode has one.
- `combo <C name> <layers> <spot>+<spot>...`: layers as a comma-separated list of indexes.
- `dance <C name> <spot>...`: every spot (any layer) holding that tap dance's `TD()` keycode.

### `[not checked]`: what the tests leave out

One line per left-out key, combo or slot, saying why: a custom keycode with no NAVI action (the user's C
decides it), an own-C tap dance, `QK_BOOT` / `EE_CLR` / `QK_RBT` (they'd end the test), a key typed through a
language's text route (the tests type in the first language, so a per-language custom keycode is tested
with the first language's action). Also: a key whose alias C name the user's own C
names (that code may change what it does), a VIA macro, a macro or every-tap dance step typing secret text (its
value is in the user's secrets header, which NAVI never reads; the test build leaves that header out), a layer no
key can turn on from power-on, a combo whose
result is a tap dance, and a scenario whose text holds a word NAVI's file check refuses (`#include`, `incbin`).
The task switcher key (`NAVI_TASK_SWITCH`) is tested on every layer it shows on, tapped once (`⟨C-A-TAB⟩`) and
twice (`⟨C-A-TAB⟩⟨C-A-TAB⟩`), with `⟨ENT⟩` after the release of the layer key holding that layer; as a combo result, a
tap dance or tap-hold slot, a key override's trigger or on a language's layer it's left out.
The lines are for people to read; a harness skips the section.

### `[tests]`: scenarios and their expected output

One scenario per line: `<steps> => <output>`. Every scenario starts from a fresh keyboard (power-on state, a
child process each) and ends with 2000 ms of idle time.

Steps, separated by spaces:

| Step | Meaning |
|---|---|
| `r0c1` | tap the key at matrix row 0, column 1 |
| `r0c1:300` | hold it 300 ms |
| `r0c1+r0c2` | press the keys 1 scan apart, hold, release them in the same order (a combo) |
| `r0c1+r0c2:300` | the same, held 300 ms |
| `r0c1*3` | the step 3 times (any step but `wait`) |
| `+r0c1` / `-r0c1` | press a key and keep it held / release it |
| `wait:500` | do nothing for 500 ms |

Timing: 50 ms of idle before the first step; a tap holds its keys 20 ms; 20 ms of idle after every step
(after each repeat too). Keys still held after the last step are released, in the order they were pressed.

### Output notation

What the computer would get, decoded as a US QWERTY layout types it:

- A printable key with no modifier but Shift: its character (`a`, `A`, `!`); a space is `␣`.
- Any other key, or one with Ctrl / Alt / GUI held: `⟨<mods><name>⟩`, mods in the order `C-` `S-` `A-` `G-`
  `RC-` `RS-` `RA-` `RG-`, then the unshifted character or the key's name: `⟨C-a⟩`, `⟨C-S-j⟩`, `⟨S-TAB⟩`,
  `⟨ENT⟩`, `⟨F5⟩`, `⟨P1⟩`, `⟨P/⟩`. Names: `ENT ESC BSPC TAB CAPS PSCR SCRL PAUS INS HOME PGUP DEL END PGDN RGHT
  LEFT DOWN UP APP NUM P/ P* P- P+ PENT P. P0`-`P9 F1`-`F24`, else the HID code as `0x2A`.
- A modifier pressed and released with no key while it was held: `⟨LCTL⟩` (`LCTL LSFT LALT LGUI RCTL RSFT
  RALT RGUI`).
- A consumer key: `⟨MUTE⟩ ⟨VOLU⟩ ⟨VOLD⟩ ⟨MPLY⟩ ⟨MNXT⟩ ⟨MPRV⟩ ⟨MSTP⟩ ⟨BRIU⟩ ⟨BRID⟩`, else `⟨0x00E2⟩` (usage); a system key
  (power, sleep, wake) the same way, by its usage: `⟨0x0082⟩`.
- The mouse, written only when what it does changes: `⟨BTN:1⟩` (button bits), `⟨MS:1,0⟩` (x, y direction),
  `⟨WH:1,0⟩` (vertical, horizontal direction).
- Nothing typed at all: `∅`.

A key held while another is pressed shows once, when it's first pressed (an auto-repeating OS isn't modeled).

## NAVI's runner

Firmware → Flash has the tick "Run the firmware tests before flashing" (`firmware.runTests`) and a "Run firmware
tests" button. With the tick on, "Build + flash" runs the tests after writing the files and before building; anything
but a pass stops it before the keyboard is touched, with the mismatches (or the compiler errors) behind the error
toast's details.

**What it needs**: `navi_tests.txt` in the keymap folder ("write firmware tests" on), and QMK in WSL or on Linux:
the test build is QMK's own `builddefs/build_test.mk` (GoogleTest, the host compiler, `fork()`), which QMK MSYS can't
build.

**Security**: the tests compile the keymap's C, your own code included, into a program that runs on this PC (firmware
runs on the keyboard; this doesn't). So a run is refused wherever a build would be: while an imported project's own
code waits for "allow" (`firmware.customReview`), when the keymap folder or `users/<keymap>` has files the allowlist
can't pass and the folder isn't trusted, and when QMK's dry run (`qmk compile -n`) would build another folder than
the one NAVI shows (`runFirmwareTests` in `electron/qmk.cjs`).

**What it builds** (`electron/firmwareTests.cjs`): a temp folder (`/tmp/navi-tests-*` inside the WSL distro, removed
after the run) with the player (`electron/firmwareTests/navi_tests_player.cpp`), the run script and a board stand-in:

- `config.h`: the project's matrix size in place of the test framework's 4 x 10, `QMK_KEYBOARD_H` as `quantum.h`,
  then the keymap folder's own `config.h`.
- `test.mk`: the keymap folder's `rules.mk` (own pipeline: yours, with `navi_rules.mk` and your `SRC` files), the
  keymap folder on `VPATH`, then these turned off, since the test platform has no stand-in for them and none changes
  what a key types: RGB Matrix, RGB Light, LED Matrix, backlight, OLED, ST7565, Quantum Painter, haptic, audio,
  encoders, split, raw HID, VIA / Vial / dynamic keymap (it would replace the test fixture's key lookup), pointing
  devices, PS/2, joystick, digitizer, MIDI, Bluetooth, DIP switches, NKRO (the player reads 6-key reports), console,
  LTO, steno, virtual serial, sleep LED, WPM.
- Not read: keyboard-level files (`keyboards/<kb>/config.h`, `rules.mk`, `keyboard.json`), so a keyboard's own
  `TAPPING_TERM` or features are missing from the test build; `users/<keymap>` isn't on `VPATH`. A split board is
  built as its whole matrix on one board; `is_keyboard_left()` and `is_keyboard_master()` are QMK's defaults for a
  board that isn't split. Code that needs any of the features above (an RGB call outside `#ifdef RGB_MATRIX_ENABLE`)
  can't build, and the run says so with the first compiler errors.

Nothing is written into `qmk_firmware` or the keymap folder. The player registers every spot of every layer from the
built keymap (`keycode_at_keymap_location_raw`), plays each scenario in a forked child (30 s at most), and prints one
block per mismatch (`navi_tests.txt:<line>: <steps>`, `  expected: ...`, `  actual: ...`) and a last line
`navi tests: <passed> passed, <failed> failed`. The result comes only from that line and the exit code: pass, fail
(with the blocks), can't build (with the first error lines), or an error (a line of `navi_tests.txt` it can't read, a
crash, no summary).

`npm run test:fw` checks the runner end to end: sample keymaps NAVI generates (`tests/firmware-tests/samples.test.ts`)
with hand-written `navi_tests.txt` files, built and played exactly as the app does.
