// SHARED FIXTURES for the `main/channel-prefs.js` suites. channel-prefs.js pulls in electron-store,
// so these suites read its source and drive the pure halves it delegates to: the pre-U5 legacy
// pair's validator (`launch-selection.js › legacyPreset`, the migration read) over the REAL
// registry, and a two-function map fake for the IPC harnesses.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);

/** The whole module's source — for assertions that pin a literal (a store key) or a spelling. */
export const SRC = readFileSync(join(HERE, "..", "main", "channel-prefs.js"), "utf8");

/** The versioned, runtime-keyed record's pure module. */
export const SELECTION_SRC = readFileSync(join(HERE, "..", "main", "launch-selection.js"), "utf8");

const sel = req(join(HERE, "..", "main", "launch-selection.js"));
const ctx = req(join(HERE, "..", "main", "runtime", "index.js")).selectionContext();

/** A whole valid legacy `{tools, messages}` pair, or null — the migration read's own rule. */
export const legacyPreset = (raw) => sel.legacyPreset(ctx, raw);

/** The restrictive pair an unset channel reads as on the default runtime. */
export const RESTRICTIVE = Object.freeze({ tools: ctx.narrowestToolFor(""), messages: "ask" });

/** A map-backed stand-in for the store: validated writes, restrictive reads. */
export const mapPrefs = {
  write(map, channelId, raw) {
    const preset = legacyPreset(raw);
    if (!map || !channelId || !preset) return { ok: false };
    map[channelId] = preset;
    return { ok: true, preset };
  },
  read(map, channelId) {
    const p = map && channelId ? legacyPreset(map[channelId]) : null;
    return p ? { ...p } : { ...RESTRICTIVE };
  },
};

/** Two real UUIDs, so the per-channel isolation cases use ids the IPC gate would accept. */
export const CH_A = "44444444-4444-4444-8444-444444444444";
export const CH_B = "55555555-5555-4555-8555-555555555555";
