// Axis A's native half: the session mode Dopl sends on `session/new` / `session/load` (`_meta` flags — Grok
// has no ACP session modes on 1.0.52: the result carries no `modes`, LIVE), the PreToolUse hook registration
// riding the same `_meta`, and the readbacks that prove what took: the model (`configOptions` echo) and,
// throughout the session, that Grok never reports it running in yolo mode.

const tools = require('./tools');

// ⚠ `yoloMode` IS NEVER SENT, for any pick: it skips every permission request — the Dopl ask rule included —
// and `requirements.toml [ui] disable_bypass_permissions_mode` does NOT stop it (LIVE, `smoke-s2`,
// `yolo-under-lock`). `approve-all` runs on Grok's `default` mode; Dopl's own gate allows what it lists.
const NATIVE_MODE = Object.freeze({
  default: Object.freeze({}),
  autoMode: Object.freeze({ autoMode: true }),
  'approve-all': Object.freeze({}),
});
const FORBIDDEN_META = Object.freeze(['yoloMode', 'alwaysApprove', 'bypassPermissions']);

// The hook id Dopl registers; `timeout` is Grok's per-group maximum (600 s). Grok FAILS OPEN at it (LIVE,
// S11), so the hook holds a parked Dopl verdict for the operator only up to HOOK_HOLD_MS — 30 s under the
// timeout — then lets the permission request (no timeout) carry the wait (`approval.js`, F-777).
const HOOK_ID = 'dopl_gate';
const HOOK_TIMEOUT_S = 600;
const HOOK_HOLD_MS = (HOOK_TIMEOUT_S - 30) * 1000;
const HOOKS_META = Object.freeze({
  'x.ai/hooks': { PreToolUse: [{ matcher: '*', hookCallbackIds: [HOOK_ID], timeout: HOOK_TIMEOUT_S }] },
});

/** The `session/new` / `session/load` `_meta` for an operator pick (normalised, fail-closed). */
function sessionMeta(toolMode) {
  const meta = Object.assign({}, NATIVE_MODE[tools.normalizeToolMode(toolMode)], JSON.parse(JSON.stringify(HOOKS_META)));
  for (const k of FORBIDDEN_META) if (k in meta) throw new Error(`Dopl refuses to send Grok \`${k}\``);
  return meta;
}

function refuse(what) {
  return new Error(`Grok reported ${what} — refusing a session that would not run under the restrictions `
    + 'the operator chose.');
}

/** `_x.ai/sessions/changed` → the refusal sentence when THIS session is reported in yolo mode, else null. */
function yoloReported(params, sessionId) {
  const rows = params && Array.isArray(params.upserted) ? params.upserted : [];
  const hit = rows.find((r) => r && r.sessionId === sessionId && r.yolo === true);
  return hit ? refuse('this session running with every approval skipped (yolo)').message : null;
}

const optionValue = (configOptions, id) => {
  const row = (Array.isArray(configOptions) ? configOptions : []).find((c) => c && c.id === id);
  return row && typeof row.currentValue === 'string' ? row.currentValue : null;
};

/** Throws unless a `configOptions` echo shows `id` at `asked` (fail CLOSED on an unreadable echo). */
function assertOptionTook(configOptions, id, asked, what) {
  const now = optionValue(configOptions, id);
  if (now === null) throw refuse(`no ${what} Dopl could read`);
  if (now !== asked) {
    throw new Error(`Grok kept ${what} \`${now}\` after Dopl asked for \`${asked}\` — refusing a session that would `
      + `run a ${what} the operator did not choose.`);
  }
}

// ⚠ Grok's slash commands ARE reachable through prompt text over ACP (LIVE 1.0.52, S10): a `session/prompt`
// of `/always-approve on` ran as a command (no model call, 8 ms turn) and the next edit ran with NO
// permission request — while `_x.ai/sessions/changed` kept reporting `yolo: false` (that readback is blind to
// it; the hook's `permissionMode: "bypassPermissions"` is not — `approval.js` stops the session on it). So no
// text Dopl sends may START with `/`: a channel peer's message would otherwise be a mode switch. A WORD JOINER
// (U+2060, not Unicode White_Space, so no trim removes it) is put in front — LIVE: the same text with it went
// to the model as chat and the mode stayed `default`. Leading zero-width/format characters count as
// "nothing before the slash" here, so a pasted `\u200B/always-approve on` is guarded too.
const SLASH_GUARD = '\u2060';
const LEADING_SLASH = /^[\s\u200B-\u200D\u2060\uFEFF]*\//;
function promptText(text) {
  const t = String(text == null ? '' : text);
  return LEADING_SLASH.test(t) ? `${SLASH_GUARD}${t}` : t;
}

module.exports = {
  promptText, SLASH_GUARD, HOOK_HOLD_MS, HOOK_TIMEOUT_S,
  sessionMeta, yoloReported, optionValue, assertOptionTook, NATIVE_MODE, HOOKS_META, HOOK_ID, FORBIDDEN_META,
};
