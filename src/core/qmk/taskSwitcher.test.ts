/**
 * The task switcher key (step 16d): NAVI_TASK_SWITCH opens Windows' Ctrl+Alt+Tab switcher, moves in it, and picks the
 * window when the layer key its layer came from is let go. The C is checked as text here; `npm run test:fw` plays it
 * in QMK's test framework (tests/firmware-tests/samples.test.ts, the switcher samples).
 */
import { describe, expect, it } from 'vitest';
import { buildCatalog } from '../keycodes/catalog';
import { parseQmk } from '../keycodes/codec';
import { friendlyName } from '../keycodes/friendly';
import { keyLabel } from '../keycodes/labels';
import { needsCode } from '../keycodes/requirements';
import { loadSpec } from '../keycodes/spec';
import { TASK_SWITCHER_NAME, taskSwitcherKeycode } from '../keycodes/taskSwitcher';
import { createBlankProject } from '../project/factory';
import { languageKeyRange } from '../project/languages';
import { activeKeymap, setKeycodes } from '../project/ops';
import type { Project } from '../project/types';
import { catalogContext, labelContext, parseContext } from '../../lib/projectContext';
import { generateKeymap } from './generate';

const spec = loadSpec('latest');
const q = (s: string) => parseQmk(spec, s);
const SW = taskSwitcherKeycode(spec);

/** Layer 0: A, LT(1, SPC); layer 1: the task switcher key at [0, 0]. */
function project(over: (p: Project) => Project = (p) => p): Project {
  let p = createBlankProject('switcher', 4, 6, false);
  const id = activeKeymap(p).id;
  p = setKeycodes(p, id, 0, [[0, 0]], q('KC_A'));
  p = setKeycodes(p, id, 0, [[0, 1]], q('LT(1, KC_SPC)'));
  p = setKeycodes(p, id, 1, [[0, 0]], SW);
  return over(p);
}
const gen = (p: Project) => generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: false, encoderCount: 0 });
const file = (res: ReturnType<typeof gen>, name: string) => res.files.find((f) => f.name === name)?.text ?? '';
const pipe = (p: Project): Project => ({ ...p, firmware: { ...p.firmware, pipeline: { enabled: true, headers: [] } } });

describe('task switcher key: the keycode', () => {
  it('sits in QK_USER below every language key, far above the own keycodes', () => {
    expect(SW).toBeLessThan(languageKeyRange(spec).start);
    expect(SW).toBeGreaterThan(spec.rangeByDefine.get('QK_USER')!.start + 32);
  });

  it('is in the catalog under Navigation, named, labeled and described; typed by its name', () => {
    const p = project();
    const label = labelContext(p, spec, { os: 'windows', hostLayout: 'none' });
    const item = buildCatalog(spec, catalogContext(p, spec, label)).find((i) => i.value === SW);
    expect(item).toMatchObject({ name: TASK_SWITCHER_NAME, category: 'navigation' });
    expect(item!.description).toContain('Ctrl+Alt+Tab');
    expect(item!.search).toContain('alt tab');
    expect(keyLabel(spec, SW, label).qmk).toBe(TASK_SWITCHER_NAME);
    expect(friendlyName(spec, SW, label).text).toBe('Task switcher');
    expect(parseQmk(spec, 'navi_task_switch', parseContext(p, spec))).toBe(SW);
    expect(needsCode(spec, SW)).toBe('navi');
  });
});

describe('task switcher key: the C', () => {
  it('nothing when no key uses it', () => {
    const res = gen(createBlankProject('x', 4, 6, false));
    expect(file(res, 'keymap.c')).not.toContain('navi_switcher');
    expect(file(res, 'keymap.c')).not.toContain('housekeeping_task');
    expect(res.symbols.has('housekeeping_task_user')).toBe(false);
  });

  it('a key on a layer: the define, the handler in process_record_user, Enter from housekeeping_task_user', () => {
    const res = gen(project());
    const c = file(res, 'keymap.c');
    expect(c).toContain(`#define NAVI_TASK_SWITCH 0x${SW.toString(16).toUpperCase()}`);
    expect(c.slice(c.indexOf('keymaps['))).toContain('NAVI_TASK_SWITCH');
    // held down while the key is (key repeat moves on), let go on its release or before the Enter pick
    expect(c).toContain('register_code16(LCTL(LALT(KC_TAB)));');
    expect(c).toContain('if (navi_switcher_held) unregister_code16(LCTL(LALT(KC_TAB)));');
    expect(c).not.toContain('tap_code16(LCTL(LALT(KC_TAB)));');
    expect(c).toMatch(/bool process_record_user\(uint16_t keycode, keyrecord_t \*record\) \{\n    if \(!navi_switcher_key\(keycode, record\)\) return false;/);
    expect(c).toContain('void housekeeping_task_user(void) {');
    expect(c).toContain('    layer_state_t on = layer_state | default_layer_state;');
    for (const s of ['housekeeping_task_user', 'process_record_user', 'navi_switcher_key', TASK_SWITCHER_NAME]) expect(res.symbols.has(s), s).toBe(true);
    expect(res.issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('only as a combo result still counts as used', () => {
    const p = { ...createBlankProject('x', 4, 6, false), combos: [{ id: 'c', name: 'CM_SW', keys: [[0, 0], [0, 1]] as [number, number][], result: SW }] };
    expect(file(gen(p), 'keymap.c')).toContain('void housekeeping_task_user(void) {');
  });

  it('with layer keys on top, a hidden layer still counts as on', () => {
    const c = file(gen(project((p) => ({ ...p, firmware: { ...p.firmware, layerKeysOnTop: true } }))), 'keymap.c');
    expect(c).toContain('    layer_state_t on = navi_wanted | layer_state | default_layer_state;');
    expect(c.indexOf('static layer_state_t navi_wanted')).toBeLessThan(c.indexOf('navi_switcher_on(void)'));
  });

  it('own pipeline: housekeeping_task_navi (a stub when unused), the define in navi.h, a forwarding warning', () => {
    const res = gen(pipe(project()));
    const c = file(res, 'keymap.c');
    expect(c).toContain('void housekeeping_task_navi(void) {\n    // The key');
    expect(c).not.toContain('void housekeeping_task_user');
    expect(file(res, 'navi.h')).toContain('#define NAVI_TASK_SWITCH');
    expect(file(res, 'navi.h')).toContain('void housekeeping_task_navi(void);');
    expect(res.issues.some((i) => i.where === 'own pipeline: housekeeping_task_user()' && i.message.en.includes('housekeeping_task_navi();'))).toBe(true);
    const empty = gen(pipe(createBlankProject('x', 4, 6, false)));
    expect(file(empty, 'keymap.c')).toContain('void housekeeping_task_navi(void) {}');
    expect(empty.issues.some((i) => i.where === 'own pipeline: housekeeping_task_user()')).toBe(false);
  });

  it('own lines defining housekeeping_task_user are reported', () => {
    const p = project((p) => ({ ...p, firmware: { ...p.firmware, custom: { 'keymap.c': 'void housekeeping_task_user(void) {}' } } }));
    expect(gen(p).issues.some((i) => i.where.startsWith('keymap.c') && i.level === 'error')).toBe(true);
  });
});
