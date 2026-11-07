# QMK host tests

`npm run test:qmk` builds a keymap NAVI generated into QMK's own unit test framework and plays key sequences on it,
checking the HID reports the computer would get. It covers the C that `npm test` can only read as text: tap-hold
keys with actions (stand-in MT / LT keycodes), the replay fix for keys that hold when another key is pressed, tap
dances, combos, auto repeat (a held macro or custom keycode running again at a rate) and languages (language keys,
the language's layer, text through the own-program route, symbol keys, hold keys by language).

Four suites, each its own test build, since QMK's test build compiles every `.cpp` in its folder into one keymap:
- **main** (this folder): `hostProject()`, scenarios in `qmk_host_test.cpp`; key press counts of the “my own program”
  route in `counts_program_test.cpp` (it defines `navi_key_count_user`).
- **languages** (`languages/`): `languageHostProject()`, scenarios in `languages/languages_test.cpp`.
- **options** (`options/`): `optionsHostProject()`, scenarios in `options/options_test.cpp` (hold spots, the one-shot cancel).
- **counts** (`counts/`): `countsHostProject()`, key press counts kept on the board, read over Raw HID in
  `counts/counts_test.cpp`; QMK's transient (RAM) EEPROM driver, since the test platform's own EEPROM is 32 bytes;
  `counts_expect.h` carries the table size and hash NAVI computed.

- `fixture.test.ts` builds the test projects (4x10 matrices like the test framework's) and writes their
  `keymap.c`, `rules.mk` and `config.h` to `NAVI_QMK_OUT` and `NAVI_QMK_OUT/languages` and `NAVI_QMK_OUT/options`. Without that variable it
  is skipped, so `npm test` doesn't run it.
- `test.mk` and `config.h` (one pair per suite) make QMK's test build take those files; `navi_host.hpp` is the
  shared fixture (`play()` and the report text).
- `run.sh <folder>` builds and runs the suites (in temp build folders; nothing is written into `qmk_firmware`).
- `scripts/qmk-host-test.mjs` does both steps. On Windows the build runs in WSL: set `NAVI_WSL_DISTRO` to the
  distro with QMK (e.g. `QMK`). `QMK_HOME` points at `qmk_firmware` when it isn't `~/qmk_firmware`.

Arguments after `--` go to the test binary: `npm run test:qmk -- --gtest_filter=*replay*`.
