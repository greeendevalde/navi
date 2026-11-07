import { describe, expect, it } from 'vitest';
import { loadSpec } from '../keycodes/spec';
import { createDilemmaProject } from '../project/factory';
import { activeKeymap, setEncoder, setKeycodes } from '../project/ops';
import { parseQmk } from '../keycodes/codec';
import { ViaClient } from './client';
import { decodeMacroBuffer, encodeMacroBuffer, checkMacroSteps } from './macros';
import { detectMatrix, probeCapabilities, probeRgbMatrixEffectCount, readSnapshot } from './probe';
import { ViaDisconnectedError, ViaTimeoutError } from './protocol';
import { ViaSimulator } from './simulator';
import { applyWrite, planWrite, snapshotToKeymap } from './sync';

const spec = loadSpec('0.0.8');
const q = (s: string) => parseQmk(spec, s);
const hardware = { rgbLeds: true, monoLeds: false, encoders: 2, pointing: 'unknown' as const, audio: false, haptic: false, oled: false, bluetooth: false, split: true };

/** Simulator set up like the owner's keyboard (read on 2026-10-22). */
function dilemmaSim() {
  const sim = new ViaSimulator({ layers: 4, rows: 10, cols: 6, encoders: 2, encoderMap: true, macroCount: 16, macroBufferSize: 3544, rgbMatrix: true });
  [0x29, 0x1e, 0x1f, 0x20, 0x21, 0x22].forEach((v, c) => sim.setKey(0, 0, c, v));
  [0x2b, 0x14, 0x1a, 0x08, 0x15, 0x17].forEach((v, c) => sim.setKey(0, 1, c, v));
  [0, 0xe3, 0xe0, 0xe3, 0x5221, 0x2c].forEach((v, c) => sim.setKey(0, 4, c, v));
  [0x23, 0x24, 0x25, 0x26, 0x27, 0x2d].forEach((v, c) => sim.setKey(0, 5, c, v));
  [0x28, 0x5222, 0x2a, 0xe2, 0xe7, 0].forEach((v, c) => sim.setKey(0, 9, c, v));
  for (let l = 1; l < 4; l++) for (let r = 0; r < 10; r++) for (let c = 0; c < 6; c++) sim.setKey(l, r, c, 1);
  sim.encoders.set([0xd9, 0xda, 0xaa, 0xa9]);
  return sim;
}

describe('VIA: reading', () => {
  it('keyboard capabilities like the real one', async () => {
    const sim = dilemmaSim();
    const client = new ViaClient(sim.transport());
    const caps = await probeCapabilities(client);
    expect(caps).toMatchObject({ protocol: 12, keycodesVersion: null, layers: 4, encoderMap: true, macros: { count: 16, bufferSize: 3544 } });
    expect(caps.lighting).toEqual({ backlight: false, rgblight: false, rgbMatrix: true, ledMatrix: false, audio: false });
  });

  it('the matrix size is derived from the buffer and per-position reads', async () => {
    const sim = dilemmaSim();
    const det = await detectMatrix(new ViaClient(sim.transport()), 16, 16);
    expect([det.rows, det.cols]).toEqual([10, 6]);
  });

  it('snapshot: keymap, encoders, macros, lighting', async () => {
    const sim = dilemmaSim();
    const client = new ViaClient(sim.transport());
    const caps = await probeCapabilities(client);
    const snap = await readSnapshot(client, caps, { rows: 10, cols: 6, encoderCount: null });
    expect(snap.keymap[0].slice(0, 6)).toEqual([0x29, 0x1e, 0x1f, 0x20, 0x21, 0x22]);
    expect(snap.keymap[0][4 * 6 + 4]).toBe(q('MO(1)'));
    expect(snap.encoderCount).toBe(2);
    expect(snap.encoders[0]).toEqual([
      { cw: 0xd9, ccw: 0xda },
      { cw: 0xaa, ccw: 0xa9 },
    ]);
    expect(snap.macros).toHaveLength(16);
    expect(snap.rgbMatrix).toMatchObject({ effect: 1 });
  });

  it('number of RGB Matrix effects (the previous effect is restored)', async () => {
    const sim = dilemmaSim();
    sim.rgb.mode = 7;
    expect(await probeRgbMatrixEffectCount(new ViaClient(sim.transport()))).toBe(44);
    expect(sim.rgb.mode).toBe(7);
  });
});

describe('VIA: write with verification', () => {
  async function setup() {
    const sim = dilemmaSim();
    const client = new ViaClient(sim.transport());
    const caps = await probeCapabilities(client);
    const snap = await readSnapshot(client, caps, { rows: 10, cols: 6, encoderCount: 2 });
    let project = createDilemmaProject();
    project = { ...project, keymaps: [snapshotToKeymap(activeKeymap(project), snap)] };
    return { sim, client, snap, project };
  }

  it('the plan refuses a macro key step above 0xFF (keyboard memory holds one byte), whatever the build allows', async () => {
    const { snap } = await setup();
    let { project } = await setup();
    project = { ...project, macros: [{ id: 'm', index: 0, name: 'hi', steps: [{ type: 'tap', keycode: q('MO(1)') }] }] };
    expect(checkMacroSteps(0, project.macros[0].steps, { via: false })).toEqual([]);
    const plan = planWrite({ project, keymap: activeKeymap(project), snapshot: snap, spec, hardware, includeMacros: true });
    expect(plan.ok).toBe(false);
    expect(plan.macros.buffer).toBeNull();
    expect(plan.warnings.some((w) => w.level === 'error' && /Macros:/.test(w.message.en))).toBe(true);
  });

  it('the plan shows only differences, the write is verified by reading', async () => {
    const { sim, client, snap } = await setup();
    let { project } = await setup();
    const km = activeKeymap(project);
    project = setKeycodes(project, km.id, 0, [[1, 1]], q('LCTL_T(KC_Q)'));
    project = setEncoder(project, km.id, 2, 1, 'cw', q('KC_MNXT'));
    project = { ...project, macros: [{ id: 'm', index: 0, name: 'hi', steps: [{ type: 'text', text: 'hi' }, { type: 'tap', keycode: 0x28 }] }] };

    const plan = planWrite({ project, keymap: activeKeymap(project), snapshot: snap, spec, hardware, includeMacros: true });
    expect(plan.ok).toBe(true);
    expect(plan.keys).toEqual([{ layer: 0, row: 1, col: 1, before: 0x14, after: q('LCTL_T(KC_Q)') }]);
    expect(plan.encoders).toEqual([{ layer: 2, encoder: 1, clockwise: true, before: 0, after: q('KC_MNXT') }]);
    expect(plan.macros.changed).toBe(true);

    const res = await applyWrite(client, plan, snap);
    expect(res.verified).toBe(true);
    expect(sim.getKey(0, 1, 1)).toBe(q('LCTL_T(KC_Q)'));
    expect(sim.getEncoder(2, 1, true)).toBe(q('KC_MNXT'));
    expect(decodeMacroBuffer(sim.macros, 16).macros[0]).toEqual([{ type: 'text', text: 'hi' }, { type: 'tap', keycode: 0x28 }]);
    expect(sim.macros[sim.macros.length - 1]).toBe(0);
  });

  it('a different matrix size — writing is forbidden', async () => {
    const { snap, project } = await setup();
    project.hardware.matrix = { rows: 5, cols: 6 };
    const plan = planWrite({ project, keymap: activeKeymap(project), snapshot: snap, spec, hardware, includeMacros: false });
    expect(plan.ok).toBe(false);
  });

  it('unplugging mid-write is an error, not a “success”', async () => {
    const { sim, client, snap, project } = await setup();
    const km = activeKeymap(project);
    const changed = setKeycodes(project, km.id, 0, [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], q('KC_A'));
    const plan = planWrite({ project: changed, keymap: activeKeymap(changed), snapshot: snap, spec, hardware, includeMacros: false });
    sim.disconnectAfter = client.commands + 2;
    await expect(applyWrite(client, plan, snap)).rejects.toBeInstanceOf(ViaDisconnectedError);
  });

  it('a read timeout is retried, a write timeout is not', async () => {
    const sim = dilemmaSim();
    const client = new ViaClient(sim.transport(), { readRetries: 1 });
    sim.silentOnce = 0x11;
    expect(await client.layerCount()).toBe(4);
    sim.silentOnce = 0x05;
    await expect(client.setKeycode(0, 0, 0, 4)).rejects.toBeInstanceOf(ViaTimeoutError);
  });
});

describe('VIA macros', () => {
  it('encoding and parsing match, pauses and keys', () => {
    const macros = [
      { index: 0, steps: [{ type: 'down' as const, keycode: 0xe0 }, { type: 'tap' as const, keycode: 0x06 }, { type: 'up' as const, keycode: 0xe0 }] },
      { index: 2, steps: [{ type: 'text' as const, text: 'git status\n' }, { type: 'delay' as const, ms: 250 }] },
    ];
    const buf = encodeMacroBuffer(macros, 4, 64);
    const { macros: back, issues } = decodeMacroBuffer(buf, 4);
    expect(issues).toEqual([]);
    expect(back[0]).toEqual(macros[0].steps);
    expect(back[1]).toEqual([]);
    expect(back[2]).toEqual(macros[1].steps);
  });

  it('firmware format limits are explained', () => {
    expect(checkMacroSteps(0, [{ type: 'text', text: 'привет' }])).toHaveLength(1);
    expect(checkMacroSteps(0, [{ type: 'tap', keycode: 0x5221 }])).toHaveLength(1);
    expect(checkMacroSteps(0, [{ type: 'delay', ms: 10000 }])).toHaveLength(1);
    expect(() => encodeMacroBuffer([{ index: 0, steps: [{ type: 'text', text: 'x'.repeat(100) }] }], 1, 50)).toThrow(/bytes/);
  });

  it('an unfinished buffer is recognised', () => {
    const buf = new Uint8Array(8);
    buf[7] = 0xff;
    expect(decodeMacroBuffer(buf, 2).issues.join()).toMatch(/interrupted/);
  });
});
