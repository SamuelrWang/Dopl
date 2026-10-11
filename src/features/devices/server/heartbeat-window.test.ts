/**
 * 🔒 **THE SERVER'S "ONLINE" WINDOW MUST OUTLAST THE DESKTOP'S SLOWEST HEARTBEAT.**
 *
 * Two processes, one contract, and until cleanup ST3 nothing tied them together:
 *  - server: `devices-service.ts › COMPUTER_ONLINE_WINDOW_MS` — a computer is online while its
 *    last beat is inside this window;
 *  - desktop: presence ticks every `presence-core.js › HEARTBEAT_MS` ± `JITTER_MS` and calls
 *    `device-registry-core.js › beat`, which throttles an unchanged status to one send per
 *    `MIN_INTERVAL_MS`.
 * If the desktop's real gap between sends ever reaches the window, a computer that is up and
 * signed in flickers "offline" in Settings > Devices between beats.
 *
 * ⚠ BEHAVIOURAL, not a constants comparison: the REAL registry is driven on a virtual clock at
 * presence's SLOWEST cadence (every tick at +JITTER), and the gap is measured off the sends it
 * actually made. The window must also absorb one in-flight request at the desktop's own HTTP
 * timeout, since `last_seen` is stamped when the server handles the POST.
 *
 * Measured today: worst send gap 66s (beats at 33s, the 50s throttle skips every other one) +
 * 12s request = 78s against a 150s window — a wide margin, so the mutations below are values
 * that really breach it (weaker ones, e.g. a 120s throttle, stay green, correctly).
 *
 * MUTATION-VERIFY (each alone turns the case red):
 *  - `MIN_INTERVAL_MS = 140 * 1000` in device-registry-core.js.
 *  - `COMPUTER_ONLINE_WINDOW_MS = 75_000` in devices-service.ts.
 *  - `HEARTBEAT_MS = 140 * 1000` in presence-core.js.
 */

import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { COMPUTER_ONLINE_WINDOW_MS } from "./devices-service";

const require = createRequire(import.meta.url);
const MAIN = join(process.cwd(), "dopl-desktop-app", "main");
const registryCore = require(join(MAIN, "device-registry-core.js")) as {
  createDeviceRegistry: (deps: Record<string, unknown>) => { beat: (s: string) => Promise<string> };
  HTTP_TIMEOUT_MS: number;
};
const presenceCore = require(join(MAIN, "presence-core.js")) as {
  HEARTBEAT_MS: number;
  JITTER_MS: number;
};

describe("Settings > Devices online window vs the desktop heartbeat", () => {
  it("slowest cadence: the longest real gap between sends, plus one request, fits the window", async () => {
    let clock = 0;
    const sends: number[] = [];
    const registry = registryCore.createDeviceRegistry({
      apiFetch: async () => {
        sends.push(clock);
        return { ok: true, status: 200, json: async () => ({ device: { revoked: false } }) };
      },
      descriptor: (status: string) => ({ status }),
      onRevoked: () => {},
      now: () => clock,
    });

    const tick = presenceCore.HEARTBEAT_MS + presenceCore.JITTER_MS; // every tick lands late
    for (let i = 0; i < 40; i++) {
      await registry.beat("online");
      clock += tick;
    }

    expect(sends.length, "control: the registry sent more than once").toBeGreaterThan(5);
    const gaps = sends.slice(1).map((t, i) => t - sends[i]);
    const worst = Math.max(...gaps);
    expect(worst + registryCore.HTTP_TIMEOUT_MS).toBeLessThan(COMPUTER_ONLINE_WINDOW_MS);
  });
});
