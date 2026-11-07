// npm run test:fw — host check of NAVI's firmware test runner (electron/firmwareTests.cjs): writes the sample keymap
// folders (tests/firmware-tests/samples.test.ts), then stages, builds and plays each one exactly as the app does and
// checks the result. On Windows it runs in WSL: NAVI_WSL_DISTRO names the distro with QMK (default QMK). QMK_HOME is
// qmk_firmware as a Linux path (default /home/<user>/qmk_firmware of that distro).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
const { stageAndRun } = require(join(root, 'electron/firmwareTests.cjs'));
const { toWslUnc, run } = require(join(root, 'electron/runner.cjs'));

const win = process.platform === 'win32';
const distro = process.env.NAVI_WSL_DISTRO || 'QMK';
const sh = (cmd) => spawnSync('wsl.exe', ['-d', distro, '--exec', 'bash', '-c', cmd], { encoding: 'utf8' }).stdout.trim();
const homeLinux = process.env.QMK_HOME || (win ? `${sh('echo $HOME')}/qmk_firmware` : `${process.env.HOME}/qmk_firmware`);
const r = win ? { kind: 'wsl', distro } : { kind: 'path', qmk: 'qmk' };
const local = (p) => (win ? toWslUnc(distro, p) : p);

// Sample folders live in Linux's /tmp (the keymap folder must be a Linux path for the test build).
const samplesLinux = win ? sh('mktemp -d /tmp/navi-fw-samples.XXXXXX') : mkdtempSync(join(tmpdir(), 'navi-fw-samples-'));
const samples = local(samplesLinux);
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n${JSON.stringify(detail, null, 2)}`}`);
  if (!ok) failed++;
};

try {
  const gen = spawnSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', 'tests/firmware-tests/samples.test.ts'], {
    stdio: 'inherit',
    cwd: root,
    env: { ...process.env, NAVI_FW_TESTS_OUT: samples },
  });
  if (gen.status !== 0) process.exit(gen.status ?? 1);
  const play = (name, rows, cols) => stageAndRun({ r, home: local(homeLinux), keymapDir: join(samples, name), rows, cols, run });

  const plain = await play('plain', 4, 10);
  const wrong = ['navi_tests.txt:19: r0c1', '  expected: x', '  actual: b'].join('\n');
  check('plain: every scenario but the wrong one passes', plain.status === 'fail' && plain.passed === 14 && plain.failed === 1, plain);
  check('plain: the wrong expectation is reported with its line, steps, expected and actual', plain.failures?.[0] === wrong, plain.failures);

  const pipeline = await play('pipeline', 4, 10);
  check('pipeline: the own C compiles with NAVI files and its key types "y"', pipeline.status === 'pass' && pipeline.passed === 3, pipeline);

  const broken = await play('broken', 4, 10);
  check('broken: own C calling an RGB Matrix function can\'t build, and the error names it', broken.status === 'cant-build' && broken.errors?.some((l) => l.includes('rgb_matrix_set_color')), broken);

  const split = await play('split', 10, 6);
  check('split: a split board builds as one matrix and both halves type', split.status === 'pass' && split.passed === 1, split);

  for (const name of ['switcher', 'switcher-on-top']) {
    const sw = await play(name, 4, 10);
    check(`${name}: the task switcher key opens, moves, goes back with Shift, closes and picks on the layer key's release`, sw.status === 'pass' && sw.passed === 17, sw);
  }

  for (const [name, rows, cols] of [['generated-plain', 4, 10], ['generated-split', 10, 6], ['generated-languages', 4, 10], ['generated-switcher', 4, 10], ['generated-switcher-on-top', 4, 10], ['generated-all', 10, 6]]) {
    const gen = await play(name, rows, cols);
    check(`${name}: NAVI's own navi_tests.txt passes whole on the firmware it wrote`, gen.status === 'pass' && gen.passed > 0, gen);
  }

  const secret = await play('secret', 4, 10);
  check('secret: the test build leaves the secrets header out, the macro types only its text', secret.status === 'pass' && secret.passed === 2, secret);
  const genSecret = await play('generated-secret', 4, 10);
  check('generated-secret: the secret macro is not checked, the rest passes', genSecret.status === 'pass' && genSecret.passed > 0, genSecret);

  const ko = await play('overrides', 4, 10);
  check('overrides: Shift overrides fire on a macro, a custom keycode with an action and CW_TOGG; the keys work alone', ko.status === 'pass' && ko.passed === 6, ko);
  const genKo = await play('generated-overrides', 4, 10);
  check('generated-overrides: NAVI\'s own navi_tests.txt passes whole', genKo.status === 'pass' && genKo.passed > 0, genKo);

  const koAny = await play('overrides-any', 4, 10);
  check('overrides-any: Shift overrides play MO(1) while held, a macro, CW_TOGG and a custom keycode', koAny.status === 'pass' && koAny.passed === 5, koAny);
  const genKoAny = await play('generated-overrides-any', 4, 10);
  check('generated-overrides-any: NAVI\'s own navi_tests.txt passes whole', genKoAny.status === 'pass' && genKoAny.passed > 0, genKoAny);

  const leaderCw = await play('leader-caps-word', 4, 10);
  check('leader-caps-word: CW_TOGG after Leader runs the sequence; alone it still toggles Caps Word', leaderCw.status === 'pass' && leaderCw.passed === 2, leaderCw);
  const leaderAny = await play('leader-any', 4, 10);
  check('leader-any: leader actions TG(1), a macro and CW_TOGG work', leaderAny.status === 'pass' && leaderAny.passed === 3, leaderAny);

  const leaderKeys = await play('leader-keys', 4, 10);
  check('leader-keys: a macro, a custom keycode, MO(1) + C(KC_A), a mod-tap key and a tap dance after Leader; the keys work outside it', leaderKeys.status === 'pass' && leaderKeys.passed === 7, leaderKeys);
  const genLeaderKeys = await play('generated-leader-keys', 4, 10);
  check('generated-leader-keys: NAVI\'s own navi_tests.txt passes whole', genLeaderKeys.status === 'pass' && genLeaderKeys.passed > 0, genLeaderKeys);

  const standIns = await play('standins-any', 4, 10);
  check('standins-any: a tap-hold key with actions as a combo result (tap and hold), an override trigger and replacement, a leader action, an own keycode action and a macro step', standIns.status === 'pass' && standIns.passed === 9, standIns);
  const genStandIns = await play('generated-standins-any', 4, 10);
  check('generated-standins-any: NAVI\'s own navi_tests.txt passes whole', genStandIns.status === 'pass' && genStandIns.passed > 0, genStandIns);

  const customAny = await play('custom-any', 4, 10);
  check('custom-any: own keycodes tap TG(1), a macro, CW_TOGG (also auto-repeated and per language); a macro as a language\'s OS shortcut', customAny.status === 'pass' && customAny.passed === 7, customAny);
  const genCustomAny = await play('generated-custom-any', 4, 10);
  check('generated-custom-any: NAVI\'s own navi_tests.txt passes whole', genCustomAny.status === 'pass' && genCustomAny.passed > 0, genCustomAny);

  const macrosAny = await play('macros-any', 4, 10);
  check('macros-any: macro steps C(KC_A), TG(1), MO(1) down / up, a custom keycode, TG(1) auto-repeated (no VIA)', macrosAny.status === 'pass' && macrosAny.passed === 6, macrosAny);
  const genMacrosAny = await play('generated-macros-any', 4, 10);
  check('generated-macros-any: NAVI\'s own navi_tests.txt passes whole', genMacrosAny.status === 'pass' && genMacrosAny.passed > 0, genMacrosAny);

  const hw = await play('own-hardware', 4, 10);
  check('own-hardware: own C including transactions.h unguarded, sending raw HID and keeping code in LIB_SRC builds; GUI + Space reads ⟨G- ⟩', hw.status === 'pass' && hw.passed === 3, hw);
  const genHw = await play('generated-own-hardware', 4, 10);
  check('generated-own-hardware: NAVI\'s own navi_tests.txt passes whole', genHw.status === 'pass' && genHw.passed > 0, genHw);

  const all = await play('all-pipeline', 10, 6);
  check('all-pipeline: LEDs, the task switcher, a per-language key and a secret macro build together in the own pipeline', all.status === 'pass' && all.passed === 3, all);

  const none = await stageAndRun({ r, home: local(homeLinux), keymapDir: samples, rows: 4, cols: 10, run });
  check('a folder without navi_tests.txt: no-tests', none.status === 'no-tests', none);
} finally {
  rmSync(samples, { recursive: true, force: true });
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
