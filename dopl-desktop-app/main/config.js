// Shared configuration for the main process (window shell + background listener).
// Centralized so index.js and the listener/spawner never drift on origins.

const APP_URL = process.env.DOPL_APP_URL || 'https://www.usedopl.com/';
const APP_ORIGIN = new URL(APP_URL).origin;

// The desktop app opens straight into the product, never the marketing site.
// `/canvas` resolves server-side (signed-out -> /login, new user -> /onboarding,
// else the default workspace canvas).
const HOME_URL = new URL('/canvas', APP_URL).toString();

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
  // Idle wait between cheap catch-ups once caught up: a wake interrupts it, and
  // it also fires as a safety re-poll if a realtime INSERT were ever missed.
  LONG_IDLE_MS: 5 * 60 * 1000,
  // Circuit breaker (F-072 reconnect-storm guard): this many consecutive WS
  // subscribe failures OPEN the breaker → isHealthy() false → loops revert to
  // the held long-poll and realtime retries only on the long cooldown below.
  BREAKER_FAIL_THRESHOLD: 4,
  BREAKER_COOLDOWN_MS: 30_000,
  // Coalesce a burst of INSERTs into at most one wake per channel per window.
  WAKE_COALESCE_MS: 200,
};

module.exports = {
  APP_URL,
  APP_ORIGIN,
  HOME_URL,
  PROTOCOL,
  API_BASE,
  MCP_URL,
  MCP_DEVICE_TOKEN_PATH,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_REF,
  LISTENER,
  REALTIME,
};
