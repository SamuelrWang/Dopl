/**
 * THE "NEEDS YOU" SIGNAL's transport — three free functions over
 * `DoplTransport`, `channel.ts`'s arrangement and idiom (2026-09-01).
 *
 * ⚠ THEIR OWN MODULE because `channel.ts` is at the 500-line cap, not because a
 * ping is a different KIND of thing to reach for: it is the channel surface's
 * out-of-band lane and shares `channel.ts`'s deadline constants by IMPORT.
 *
 * ⚠ **A PING IS NOT A MESSAGE AND ITS `seq` IS NOT A MESSAGE `seq`.** The two
 * cursor spaces are separate by construction, so a caller that crosses them
 * reads a plausible WRONG page rather than getting an error. Nothing here may
 * accept, or hand back, a `channel_messages` cursor.
 */

import type { DoplTransport } from "./transport.js";
// ⚠ IMPORTED, NEVER RESTATED. The ping await sits under the SAME route ceiling
// (`/api/pings/await` has `maxDuration` 60) as the message await, so it must
// hold to the same two numbers — a second copy drifts, and the copy that drifts
// low replaces a graceful "nothing arrived" result with a transport abort.
import { AWAIT_TIMEOUT_MS, DEFAULT_AWAIT_TIMEOUT_MS } from "./channel.js";
import type {
  AwaitPingsOptions,
  ChannelPing,
  CreatePingInput,
  ListPingsOptions,
  PingAwaitResult,
} from "./ping-types.js";

/**
 * SEND ONE PING.
 *
 * ⚠ There is NO sender argument and no operator argument on the two self-scoped
 * recipient forms — the server stamps the authenticated caller. That absence is
 * the authorization story; see {@link CreatePingInput}.
 * ⚠ Exactly one recipient field. Zero and two are both refused, by the route's
 * schema and — before anything crosses the wire — by the MCP op.
 */
export async function createPing(
  t: DoplTransport,
  input: CreatePingInput
): Promise<ChannelPing> {
  const data = await t.request<{ ping: ChannelPing }>("/api/pings", {
    method: "POST",
    body: input,
    toolName: "channel_ping",
  });
  return data.ping;
}

/**
 * THE INBOX CATCH-UP READ — what an agent that missed a hold reads instead of
 * replaying channels.
 *
 * ⚠ `since` IS A PING `seq`. ⚠ `since=0` means "everything from the beginning",
 * so it is sent whenever it is DEFINED rather than being treated as absent.
 */
export async function listPings(
  t: DoplTransport,
  opts: ListPingsOptions = {}
): Promise<ChannelPing[]> {
  const params = new URLSearchParams();
  if (opts.since !== undefined) params.set("since", String(opts.since));
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const data = await t.request<{ pings: ChannelPing[] }>(
    `/api/pings${qs ? `?${qs}` : ""}`,
    { toolName: "channel_read_pings" }
  );
  return data.pings;
}

/**
 * THE HELD READ — one cheap long-poll for the external session watching this
 * operator's inbox, instead of N per-channel polls.
 *
 * ⚠ SAME BOUNDS AS `channel.ts › awaitMessages`, and for the same reason: the
 * route holds ~50s under a `maxDuration` 60, so ONE call stays at ~50s and a
 * multi-minute hold is assembled ABOVE this layer by re-issuing on the same
 * cursor (`channel-await-budget.ts`).
 * ⚠ `retries: 0` — a retry opens a SECOND long-poll and can double-count
 * arrivals. The auto-retry a GET would otherwise get is the defect here.
 */
export async function awaitPings(
  t: DoplTransport,
  opts: AwaitPingsOptions
): Promise<PingAwaitResult> {
  const params = new URLSearchParams();
  params.set("since", String(opts.since));
  params.set("timeoutMs", String(opts.timeoutMs ?? DEFAULT_AWAIT_TIMEOUT_MS));
  return t.request<PingAwaitResult>(`/api/pings/await?${params.toString()}`, {
    method: "GET",
    timeoutMs: AWAIT_TIMEOUT_MS,
    // ⚠ A retry opens a second long-poll — never auto-retry this one.
    retries: 0,
    toolName: "channel_await_pings",
  });
}
