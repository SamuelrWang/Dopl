import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts } from "#/lib/dopl-bridge";
import { USER_ID, installBridge, ok } from "#/test-utils/bridge";
import { BILLING_STATUS, renderHome, routes } from "./home-test-harness";

/**
 * /home → OVERVIEW → **THE CAPACITY BAR'S FAIL-OPEN CAPTION**.
 *
 * ⚠ **ITS OWN FILE BECAUSE `overview-credit-bar.test.tsx` HAD 21 LINES OF
 * HEADROOM UNDER THE HARD 500** (§1, `eslint.config.mjs › max-lines`, which
 * covers `apps/*​/src/**` with no exemptions) — the same cap that split that
 * suite out of `overview-panels.test.tsx` on 2026-09-06. The seam is real:
 * that file owns the bar's ARITHMETIC and its SOURCES, and these cases own one
 * caption driven by a field that is not a measurement at all.
 *
 * ⚠ THE CHANNEL SURFACE IS STUBBED, like every other suite on this page.
 */

const apiRequest = vi.hoisted(() => vi.fn());

vi.mock(
  "@/features/channels/components/channel-surface-standalone",
  () => ({
    StandaloneChannelSurface: () => <div data-testid="channel-surface" />,
  })
);

const panel = (name: string) => screen.findByRole("region", { name });

beforeEach(() => {
  vi.clearAllMocks();
  apiRequest.mockImplementation(
    (path: string, opts: BridgeRequestOpts = {}) =>
      routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`))
  );
  installBridge({
    apiRequest: (path: string, opts: BridgeRequestOpts = {}) =>
      apiRequest(path, opts),
    getAuthState: () => Promise.resolve({ signedIn: true, userId: USER_ID }),
    onAuthState: () => () => {},
    openExternal: () => Promise.resolve({ ok: true }),
  });
});

/**
 * 🔒 **THE FAIL-OPEN CAPTION (2026-09-14).** `POST /api/mcp/credits/consume`
 * fails OPEN by decision, so a dead RPC — the `PGRST202` a web deploy gets
 * before its migration applies — runs every agent's tool calls UNMETERED, and
 * this bar reads the same `0` a quiet month reads. `credits.unmeteredSince` is
 * the only thing that tells them apart, and until it shipped **nothing
 * web-side showed a fail-open at all**.
 *
 * ⚠ **THE TWO CAPTIONS ARE INDEPENDENT AND BOTH MAY SHOW.** `Unreconciled` is
 * about the LEDGER disagreeing with the counter; `Unmetered` is about the
 * CHARGE PATH having failed. A build that treated them as one state would hide
 * whichever it decided was second.
 */
describe("the fail-open caption", () => {
  const withCredits = (credits: Record<string, unknown>) =>
    apiRequest.mockImplementation((path: string, opts: BridgeRequestOpts = {}) =>
      path.split("?")[0] === "/api/billing/status"
        ? Promise.resolve(
            ok({
              ...BILLING_STATUS,
              credits: { ...BILLING_STATUS.credits, ...credits },
            })
          )
        : (routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`)))
    );

  it("says NOTHING while the server is metering", async () => {
    withCredits({ unmeteredSince: null });
    renderHome();
    const credits = await panel("Usage");
    await within(credits).findByText(/ left$/);
    expect(within(credits).queryByText("Unmetered")).toBeNull();
  });

  it("🔒 prints one muted word once a charge has failed open", async () => {
    withCredits({ unmeteredSince: "2026-09-14T10:00:00.000Z" });
    renderHome();
    const credits = await panel("Usage");
    expect(await within(credits).findByText("Unmetered")).toBeInTheDocument();
  });

  /** ⚠ **MINIMAL COPY (INVARIANTS §5): THE WORD, NOT THE TIMESTAMP.** The ISO
   *  instant is on the payload and in the log, for the operator who goes
   *  looking; a date here is a third number on a card built around two. */
  it("🔒 never prints the instant itself", async () => {
    withCredits({ unmeteredSince: "2026-09-14T10:00:00.000Z" });
    renderHome();
    const credits = await panel("Usage");
    await within(credits).findByText("Unmetered");
    expect(within(credits).queryByText(/2026-09-14/)).toBeNull();
    expect(within(credits).queryByText(/since/i)).toBeNull();
  });

  it("🔒 BOTH captions show together — neither state hides the other", async () => {
    withCredits({ ledgerDrift: 3, unmeteredSince: "2026-09-14T10:00:00.000Z" });
    renderHome();
    const credits = await panel("Usage");
    expect(await within(credits).findByText("Unreconciled")).toBeInTheDocument();
    expect(await within(credits).findByText("Unmetered")).toBeInTheDocument();
  });

  /**
   * 🔒 **THE STALE-CACHE CASE (INVARIANTS §8).** Same rule as `ledgerDrift`: the
   * query cache is IndexedDB-persisted with a 24h gcTime, so a row stored before
   * this field shipped replays after it with the key ABSENT inside an otherwise
   * complete `credits` object. `undefined` is falsy, so the word would not print
   * — but the FIELD-WISE `?? null` is what makes that a decision rather than an
   * accident, and this pins it before somebody "simplifies" the fallback.
   */
  it("🔒 treats a cached row with NO unmeteredSince as metering", async () => {
    const preFieldCredits: Record<string, unknown> = { ...BILLING_STATUS.credits };
    delete preFieldCredits.unmeteredSince;
    apiRequest.mockImplementation((path: string, opts: BridgeRequestOpts = {}) =>
      path.split("?")[0] === "/api/billing/status"
        ? Promise.resolve(ok({ ...BILLING_STATUS, credits: preFieldCredits }))
        : (routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`)))
    );
    renderHome();
    const credits = await panel("Usage");
    await within(credits).findByText(/ left$/);
    expect(within(credits).queryByText("Unmetered")).toBeNull();
  });
});
