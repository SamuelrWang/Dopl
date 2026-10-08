// Default Supabase env vars for tests that import server-only modules.
// Real DB hits aren't expected — services take a `db` dep that tests
// inject; these vars exist solely so `supabaseAdmin()`'s module-load
// guard passes. Individual tests override per-test envs (e.g.
// `INTEGRATIONS_NOTION_AUTH_CONFIG_ID`) via `vi.stubEnv`.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

// jsdom has no ResizeObserver; `LiquidGlass` (the knowledge home hero panel)
// observes its own box on mount, so any test that renders the hero needs the
// constructor to exist. A no-op stand-in is enough — nothing asserts on resize
// behaviour. Twin of the SPA's `apps/desktop-ui/src/test-setup.ts` block; the
// guard makes it inert under the node environment, where it is never read.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// Unsent composer drafts are REMEMBERED by design (`src/shared/lib/draft-store.ts`), in module
// memory and `localStorage` — so one test's typing would otherwise reappear in the next test's
// composer. Reset both between tests.
import { afterEach as afterEachDraft } from "vitest";
import { __resetDraftStoreForTests } from "./src/shared/lib/draft-store";
afterEachDraft(() => {
  __resetDraftStoreForTests();
  if (typeof localStorage === "undefined") return;
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key?.startsWith("dopl.draft:")) localStorage.removeItem(key);
  }
});
