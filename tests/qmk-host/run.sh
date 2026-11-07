#!/usr/bin/env bash
# Builds the generated keymap files in folder $1 (the main suite; $1/languages for the languages suite) into QMK's
# unit test framework and runs the host tests of each suite.
# Run by scripts/qmk-host-test.mjs (npm run test:qmk); needs qmk_firmware at $QMK_HOME or ~/qmk_firmware.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
out=$(cd "$1" && pwd)
qmk_home=${QMK_HOME:-$HOME/qmk_firmware}
status=0
for suite in main languages options counts; do
    if [ "$suite" = main ]; then dir=$here; files=$out; else dir=$here/$suite; files=$out/$suite; fi
    build=$(mktemp -d /tmp/navi-qmk-host.XXXXXX)
    # The test build takes the test folder relative to qmk_firmware (absolute paths break its object paths)
    rel=$(realpath --relative-to="$qmk_home" "$dir")
    echo "── suite: $suite"
    if ! make -r -R -s -C "$qmk_home" -f builddefs/build_test.mk -j"$(nproc)" all \
        TEST=navi TEST_OUTPUT=navi TEST_PATH="$rel" FULL_TESTS=navi BUILD_DIR="$build" SILENT=false \
        NAVI_QMK_OUT="$files" >"$build/make.log" 2>&1; then
        grep -E 'error|warning|undefined' "$build/make.log" | head -40 || tail -40 "$build/make.log"
        rm -rf "$build"
        exit 1
    fi
    "$build/test/navi.elf" --gtest_color=no "${@:2}" || status=1
    rm -rf "$build"
done
# The launcher runs `bash -l`: ~/.bash_logout runs on exit, and under set -e its failing clear_console would turn
# a pass into exit 1.
set +e
exit $status
