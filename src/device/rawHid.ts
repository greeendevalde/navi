/**
 * One packet to a keyboard's Raw HID interface by its usage page / usage (QMK's RAW_USAGE_PAGE / RAW_USAGE_ID, which a
 * build may change: the owner's is 0xFF71). Used for NAVI's "restart into the bootloader" message, which gets no
 * reply: whether it worked is decided only by the bootloader appearing (src/lib/buildFlash.ts). Key counts on the
 * board are read through a session (openRawSession): a packet out, the keyboard's answer back.
 * Windows opens HID devices shared, so a program keeping its handle open (py_qmk) doesn't block this.
 */
import { REPORT_SIZE } from '../core/via/protocol';
import { hidSupported } from './webhid';

export type RawTarget = { vendorId: number; productId: number; productName: string };

const hasCollection = (d: HIDDevice, page: number, usage: number) => d.collections.some((c) => c.usagePage === page && c.usage === usage);

/** Connected devices with that interface (permission is asked once; in Electron main answers without a picker). */
async function devicesWith(page: number, usage: number): Promise<HIDDevice[]> {
  if (!hidSupported()) return [];
  let devices = (await navigator.hid.getDevices()).filter((d) => hasCollection(d, page, usage));
  if (!devices.length) {
    try {
      await navigator.hid.requestDevice({ filters: [{ usagePage: page, usage }] });
    } catch {
      // nothing connected, or the request was declined
    }
    devices = (await navigator.hid.getDevices()).filter((d) => hasCollection(d, page, usage));
  }
  return devices;
}

/**
 * Pick the keyboard to send to: the project's VID:PID when known, else the only device with the interface.
 * Several candidates and no VID:PID to tell them apart → none (sending to the wrong keyboard would restart it).
 */
export function pickRawTarget<T extends RawTarget>(devices: readonly T[], expect: { vid: number; pid: number } | null): T | 'none' | 'several' {
  const byId = expect ? devices.filter((d) => d.vendorId === expect.vid && d.productId === expect.pid) : [];
  const pool = byId.length ? byId : devices;
  if (pool.length === 0) return 'none';
  // One physical keyboard can show up as several HIDDevice objects (one per interface): same VID:PID and name.
  const keys = new Set(pool.map((d) => `${d.vendorId}:${d.productId}:${d.productName}`));
  if (keys.size > 1 && !byId.length) return 'several';
  return pool[0]!;
}

export type RawSendResult = { sent: true; device: RawTarget; error?: string } | { sent: false; why: 'none' | 'several' | 'unsupported' | 'unopened'; error?: string };

/** A Raw HID conversation with one keyboard: packets out, the keyboard's answer (an input report) back. */
export interface RawSession {
  device: RawTarget;
  /** Sends a packet and waits for the first input report `accept` takes (null on timeout). */
  exchange(packet: Uint8Array, accept: (report: Uint8Array) => boolean, timeoutMs?: number): Promise<Uint8Array | null>;
  close(): Promise<void>;
}

export type RawSessionResult = { ok: true; session: RawSession } | { ok: false; why: 'none' | 'several' | 'unsupported' | 'unopened'; error?: string };

/**
 * Opens a session with the keyboard pickRawTarget picks (NAVI's key counts packets, src/core/qmk/keyCounts.ts).
 * A device another part of NAVI has open (VIA) stays open after close().
 */
export async function openRawSession(page: number, usage: number, expect: { vid: number; pid: number } | null): Promise<RawSessionResult> {
  if (!hidSupported()) return { ok: false, why: 'unsupported' };
  const pick = pickRawTarget(await devicesWith(page, usage), expect);
  if (pick === 'none' || pick === 'several') return { ok: false, why: pick };
  const device = pick;
  const openedHere = !device.opened;
  try {
    if (openedHere) await device.open();
  } catch (err) {
    return { ok: false, why: 'unopened', error: err instanceof Error ? err.message : String(err) };
  }
  const session: RawSession = {
    device: { vendorId: device.vendorId, productId: device.productId, productName: device.productName },
    exchange(packet, accept, timeoutMs = 1000) {
      return new Promise((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const done = (r: Uint8Array | null) => {
          clearTimeout(timer);
          device.removeEventListener('inputreport', onReport);
          resolve(r);
        };
        const onReport = (e: HIDInputReportEvent) => {
          const r = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
          if (accept(r)) done(r.slice());
        };
        device.addEventListener('inputreport', onReport);
        timer = setTimeout(() => done(null), timeoutMs);
        const payload = new Uint8Array(REPORT_SIZE);
        payload.set(packet.subarray(0, REPORT_SIZE));
        device.sendReport(0, payload).catch((err: unknown) => {
          clearTimeout(timer);
          device.removeEventListener('inputreport', onReport);
          reject(err instanceof Error ? err : new Error(String(err)));
        });
      });
    },
    async close() {
      if (!openedHere) return;
      try {
        if (device.opened) await device.close();
      } catch {
        // already gone
      }
    },
  };
  return { ok: true, session };
}

export async function sendRawPacket(page: number, usage: number, packet: Uint8Array, expect: { vid: number; pid: number } | null): Promise<RawSendResult> {
  if (!hidSupported()) return { sent: false, why: 'unsupported' };
  const pick = pickRawTarget(await devicesWith(page, usage), expect);
  if (pick === 'none' || pick === 'several') return { sent: false, why: pick };
  const device = pick;
  const target = { vendorId: device.vendorId, productId: device.productId, productName: device.productName };
  const openedHere = !device.opened;
  try {
    if (openedHere) await device.open();
  } catch (err) {
    return { sent: false, why: 'unopened', error: err instanceof Error ? err.message : String(err) };
  }
  try {
    const payload = new Uint8Array(REPORT_SIZE);
    payload.set(packet.subarray(0, REPORT_SIZE));
    await device.sendReport(0, payload);
    return { sent: true, device: target };
  } catch (err) {
    // The keyboard may restart before the write is acknowledged: the bootloader appearing decides, not this error.
    return { sent: true, device: target, error: err instanceof Error ? err.message : String(err) };
  } finally {
    if (openedHere) {
      try {
        if (device.opened) await device.close();
      } catch {
        // already gone (it restarted)
      }
    }
  }
}
