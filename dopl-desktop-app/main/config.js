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

module.exports = {
  APP_URL,
  APP_ORIGIN,
  HOME_URL,
  PROTOCOL,
  API_BASE,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_REF,
  LISTENER,
};
