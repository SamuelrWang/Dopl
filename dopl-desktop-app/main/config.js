// Shared configuration for the main process (window shell + background listener).
// Centralized so index.js and the listener/spawner never drift on origins.

const APP_URL = process.env.DOPL_APP_URL || 'https://www.usedopl.com/';
const APP_ORIGIN = new URL(APP_URL).origin;

// Custom URL scheme used to hand the OAuth session back from the system browser
// into this app (dopl://auth#access_token=...&refresh_token=...).
const PROTOCOL = 'dopl';

// The Next.js `/api/*` routes live on the same origin as the app.
const API_BASE = APP_ORIGIN;

// Dopl MCP endpoint the responding agents (spawned Claude sessions) connect to,
// and the cookie-authed endpoint that mints a device token for it. Derived from
// the app origin so an env override stays consistent (prod resolves to
// https://www.usedopl.com/api/mcp).
const MCP_URL = `${API_BASE}/api/mcp`;
const MCP_DEVICE_TOKEN_PATH = '/api/auth/mcp-device-token';

// Supabase project the web app exposes (NEXT_PUBLIC_* — already shipped to every
// browser, so embedding the publishable anon key here leaks nothing new). Used
// only for the token-refresh endpoint. Overridable via env for other envs.
const SUPABASE_URL =
  process.env.DOPL_SUPABASE_URL || 'https://mrefkedvdehahjejreae.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.DOPL_SUPABASE_ANON_KEY ||
  'sb_publishable_HblQWxgsywspHu73EmBQXw_Mu4rBrlw';
// Project ref drives the Supabase auth cookie name: `sb-<ref>-auth-token`.
const SUPABASE_REF = new URL(SUPABASE_URL).hostname.split('.')[0];

// ── Auto-update tuning ────────────────────────────────────────────────────────
// How often the running app looks for a published build. 4h is right for a
// machine that is already current and wrong for the publish loop: an app that is
// already running will not look again for up to four hours after a release, which
// is half of why "close and reopen" does not pick up a new build.
//
// DOPL_UPDATE_CHECK_MS overrides it (minutes-scale for a fast iteration loop).
// The value is CLAMPED to [60s, 24h] and falls back to the 4h default when it is
// absent or unparseable, so a typo like `=5` becomes 60s rather than a 5ms hot
// loop against GitHub Releases. See main/update-policy.js for the resolver.
const updatePolicy = require('./update-policy');

const UPDATER = {
  DEFAULT_CHECK_INTERVAL_MS: updatePolicy.DEFAULT_CHECK_INTERVAL_MS,
  MIN_CHECK_INTERVAL_MS: updatePolicy.MIN_CHECK_INTERVAL_MS,
  MAX_CHECK_INTERVAL_MS: updatePolicy.MAX_CHECK_INTERVAL_MS,
  CHECK_INTERVAL_MS: updatePolicy.resolveCheckIntervalMs(process.env.DOPL_UPDATE_CHECK_MS),
};

// ── Minimum-version gate ─────────────────────────────────────────────────────
// The server-authoritative floor (GET /api/version) that a bundled build blocks
// itself on, so Phase 4 can retire the website without stranding anyone on a
// frozen UI. Policy lives in main/min-version.js; the shell is version-gate.js.
//
// DOPL_VERSION_GATE is the one knob, the DOPL_UI shape: `off` disables the gate
// for local dev, `force` synthesizes a floor so the blocking screen can be
// dogfooded without deploying one, and anything else (including a typo) is the
// shipping behavior — a misspelled opt-out must not silently turn the gate off.
//
// The steady-state cadence is UPDATER.CHECK_INTERVAL_MS on purpose: the floor
// and the release feed answer the same question and there is nothing to gain
// from a second interval to tune. RETRY_MS is the one exception, for the machine
// that boots offline and would otherwise not learn there is a floor for 4h.
const minVersion = require('./min-version');

const VERSION_GATE = {
  MODE: minVersion.resolveGateMode(process.env.DOPL_VERSION_GATE),
  PATH: '/api/version',
  FETCH_TIMEOUT_MS: minVersion.FLOOR_FETCH_TIMEOUT_MS,
  CHECK_INTERVAL_MS: UPDATER.CHECK_INTERVAL_MS,
  RETRY_MS: minVersion.FLOOR_RETRY_MS,
};

// ── Listener tuning (judgment calls, documented in the build report) ──────────
const LISTENER = {
  // Re-list channels this often so newly-joined channels start being watched.
  CHANNEL_REFRESH_MS: 5 * 60 * 1000,
  // Long-poll timeout we ask the server for. Contract caps await at <=50s.
  AWAIT_TIMEOUT_MS: 50_000,
  // Client-side fetch timeout — a little longer than the server timeout so a
  // clean `timedOut:true` beats our AbortController.
  AWAIT_FETCH_TIMEOUT_MS: 58_000,
  // Brief pause between successful await cycles to avoid a hot loop.
  IDLE_GAP_MS: 400,
  // Reconnect backoff (capped exponential) after transient failures.
  BACKOFF_BASE_MS: 2_000,
  BACKOFF_MAX_MS: 60_000,
  // C-3 — HOW MANY TIMES ONE MESSAGE MAY REFUSE TO DISPATCH BEFORE THE LOOP STEPS OVER IT.
  //
  // The cursor now advances only PAST a message whose dispatch landed (listener-messages
  // .drainPage), so a message that keeps failing holds the head of its channel's queue.
  // That is the correct trade for a TRANSIENT failure and the wrong one forever, so the
  // hold is bounded and the escape is loud.
  //
  // EIGHT, over the SAME capped-exponential ladder the reconnect path uses (2s → 60s):
  // 2+4+8+16+32+60+60+60 ≈ 4 minutes of held cursor. The motivating incident is "wifi
  // drops for 15s during the consent POST", so this is ~16x the case it exists for and
  // comfortably spans a lid-close, a router reboot or a Wi-Fi handoff; and it bounds the
  // head-of-line block on ONE channel to minutes rather than to the life of the process.
  // Every deferral is a diag line and the escape says, in as many words, that a message
  // was dropped — which is the property the old advance-always ordering did not have.
  DISPATCH_MAX_ATTEMPTS: 8,
  // When the Channels feature isn't deployed yet (routes 404) back off long so
  // we don't spin against a not-yet-shipped endpoint.
  FEATURE_UNAVAILABLE_MS: 5 * 60 * 1000,
};

// ── Push transport tuning (poll→push, v2.1) ───────────────────────────────────
// The desktop subscribes to Supabase Realtime INSERTs on channel_messages (one
// more authenticated consumer alongside the web) and, while that WS is HEALTHY,
// replaces the held ~50s `/await` long-poll with a cheap immediate catch-up plus
// a long interruptible idle that a realtime wake resolves early. When the WS is
// unhealthy (breaker OPEN) or push is disabled, every value collapses to the
// LISTENER long-poll above so the fallback is byte-for-byte today's behavior.
const REALTIME = {
  // Master switch: set DOPL_PUSH=0 to force the pure long-poll instantly.
  ENABLED: process.env.DOPL_PUSH !== '0',
  // The `/await` timeout we ask for on the cheap catch-up. The server schema
  // requires a POSITIVE timeoutMs (0 → 400), so 1ms is the smallest value that
  // returns after a single DB read with no held serverless function.
  CHEAP_AWAIT_TIMEOUT_MS: 1,
  // Our own fetch-abort for that cheap call (short — it returns immediately).
  CHEAP_FETCH_TIMEOUT_MS: 15_000,
  // Idle wait between cheap catch-ups once caught up: a wake interrupts it
  // instantly, and it also fires as a safety re-poll if a realtime INSERT were
  // ever missed. This is the belt-and-suspenders BACKSTOP that bounds worst-case
  // latency when push connects but silently fails to deliver a wake: at 45s a
  // missed INSERT surfaces in <=45s via this caught-up re-poll, not ~5min.
  // (Kept short deliberately — a wake still resolves it the instant push works.)
  LONG_IDLE_MS: 45 * 1000,
  // Circuit breaker (F-072 reconnect-storm guard): this many consecutive WS
  // subscribe failures OPEN the breaker → isHealthy() false → loops revert to
  // the held long-poll and realtime retries only on the long cooldown below.
  BREAKER_FAIL_THRESHOLD: 4,
  BREAKER_COOLDOWN_MS: 30_000,
  // Bounded re-subscribe delay: after a ws sub CHANNEL_ERRORs/CLOSES we re-apply
  // the JWT and rejoin that one channel this soon (single pending retry per ws,
  // and only while the breaker is CLOSED, so an errored sub is never left
  // silently dead while another ws keeps global health green — no storm, F-072).
  RESUBSCRIBE_MS: 5_000,
  // Coalesce a burst of INSERTs into at most one wake per channel per window.
  WAKE_COALESCE_MS: 200,
};

module.exports = {
  APP_URL,
  APP_ORIGIN,
  PROTOCOL,
  API_BASE,
  MCP_URL,
  MCP_DEVICE_TOKEN_PATH,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_REF,
  LISTENER,
  REALTIME,
  UPDATER,
  VERSION_GATE,
};
