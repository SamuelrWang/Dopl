/**
 * THE HEADER WRITE — name and description, driven through TanStack's own
 * `MutationObserver` so the order onMutate → mutationFn → onSuccess → onSettled
 * is the real one. `npm test` has no DOM, which is why `headerConfig` is exported
 * apart from the hook that wires it — the same arrangement
 * `use-channel-lifecycle-writes.test.ts` documents.
 *
 * What these protect:
 *  - 🔒 **ONE FIELD PER SAVE.** The blur that commits a line names only the line
 *    it committed; a body carrying both would make an untouched name part of the
 *    description's write, and a STALE one if somebody else renamed the room while
 *    the row was on screen.
 *  - 🔒 **NO NEW ENDPOINT.** It is `PATCH /api/channels/{id}` — the route the
 *    management writes and the info card already use.
 *  - the optimistic patch lands on the DRAFT's own `channelId`, so a save cannot
 *    repaint the channel the reader switched to;
 *  - the refetch coordinator's gate is handed to `settleWith` and released on the
 *    THROWING path too.
 */

import { describe, expect, it } from "vitest";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { apiQueryKey } from "@/shared/api/query-keys";
import {
  buildApiMutationOptions,
  type ApiMutationRequestFn,
  type MutationGate,
} from "@/shared/hooks/use-api-mutation";
import { EMPTY_INFO_CARD } from "../info-card";
import type { ChannelsCache } from "../lib/optimistic-cache";
import type { Channel } from "../types";
import { headerConfig, type HeaderDraft } from "./use-channel-header-writes";

const WORKSPACE = "ws-1";
const CHANNEL = "c-1";
const OTHER = "c-2";
const LIST = "/api/channels";
const ACTIVE_KEY = apiQueryKey(LIST, { workspaceId: WORKSPACE });

function channel(over: Partial<Channel> = {}): Channel {
  return {
    id: CHANNEL,
    workspaceId: WORKSPACE,
    slug: "general",
    name: "general",
    topic: "",
    visibility: "public",
    isDirect: false,
    directPeer: null,
    createdBy: "u-me",
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    memberCount: 2,
    lastMessageAt: null,
    role: "owner",
    isMember: true,
    lastReadAt: null,
    unread: false,
    myNotifyScope: null,
    myAgentToolProfile: null,
    myFavoritedAt: null,
    onlineMemberCount: 0,
    // THE ROW EXTRAS (R-26) — one projection, so a fixture carries them too.
    container: { id: "ws-1", kind: "standard", segment: "ws-1-aaaaaa" },
    myWorkspaceRole: "owner",
    peers: [],
    mentionCount: 0,
    linkOut: null,
    infoCard: EMPTY_INFO_CARD,
    ...over,
  };
}

/** Transport settled by hand, so "before the network answers" is a real
 *  assertion rather than a timing hope. */
function deferredRequest() {
  let settle!: (value: unknown) => void;
  let fail!: (error: unknown) => void;
  const pending = new Promise<unknown>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  const calls: Array<{ path: string; opts: Record<string, unknown> }> = [];
  const request = ((path: string, opts: Record<string, unknown>) => {
    calls.push({ path, opts });
    return pending;
  }) as unknown as ApiMutationRequestFn;
  return { request, settle, fail, calls };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function harness() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(ACTIVE_KEY, {
    channels: [channel(), channel({ id: OTHER, name: "brand" })],
  } satisfies ChannelsCache);
  const gate = {
    begun: 0,
    ended: 0,
    begin() {
      gate.begun += 1;
    },
    end() {
      gate.ended += 1;
    },
  };
  return { client, gate };
}

function run(
  h: ReturnType<typeof harness>,
  draft: HeaderDraft,
  gate: MutationGate = h.gate
) {
  const { request, settle, fail, calls } = deferredRequest();
  const observer = new MutationObserver(
    h.client,
    buildApiMutationOptions<HeaderDraft, { channel: Channel }>(
      h.client,
      request,
      headerConfig({ workspaceId: WORKSPACE, gate })
    )
  );
  const inFlight = observer.mutate(draft).catch(() => "rejected");
  return { inFlight, settle, fail, calls };
}

const rows = (h: ReturnType<typeof harness>) =>
  h.client.getQueryData<ChannelsCache>(ACTIVE_KEY)?.channels ?? [];
const row = (h: ReturnType<typeof harness>, id = CHANNEL) =>
  rows(h).find((c) => c.id === id);

describe("the request", () => {
  it("🔒 PATCHes the existing channel route and sends ONE field", async () => {
    const h = harness();
    const { inFlight, settle, calls } = run(h, {
      channelId: CHANNEL,
      patch: { name: "marketing" },
    });
    await flush();
    expect(calls[0].path).toBe(`${LIST}/${CHANNEL}`);
    expect(calls[0].opts.method).toBe("PATCH");
    // ⚠ THE BODY IS THE WHOLE ASSERTION: a `topic` key here would mean the name's
    // blur had carried a value nobody typed.
    expect(calls[0].opts.body).toEqual({ name: "marketing" });
    settle({ channel: channel({ name: "marketing" }) });
    await inFlight;
    await flush();
  });

  it("🔒 a description save carries no name", async () => {
    const h = harness();
    const { inFlight, settle, calls } = run(h, {
      channelId: CHANNEL,
      patch: { topic: "The redesign" },
    });
    await flush();
    expect(calls[0].opts.body).toEqual({ topic: "The redesign" });
    settle({ channel: channel({ topic: "The redesign" }) });
    await inFlight;
    await flush();
  });
});

describe("the cache", () => {
  it("repaints the named row BEFORE the network answers, and only that row", async () => {
    const h = harness();
    const { inFlight, settle } = run(h, {
      channelId: CHANNEL,
      patch: { name: "marketing" },
    });
    await flush();
    expect(row(h)?.name).toBe("marketing");
    // ⚠ THE KEY IS BUILT FROM THE DRAFT'S OWN `channelId` (§8 rule 4), so the
    // other row is untouched even while this one is in flight.
    expect(row(h, OTHER)?.name).toBe("brand");
    settle({ channel: channel({ name: "marketing" }) });
    await inFlight;
    await flush();
    expect(row(h)?.name).toBe("marketing");
  });

  it("rolls the row back when the server refuses, and still releases the gate", async () => {
    const h = harness();
    const { inFlight, fail } = run(h, {
      channelId: CHANNEL,
      patch: { name: "" },
    });
    await flush();
    expect(row(h)?.name).toBe("");
    fail(new Error("refused"));
    await inFlight;
    await flush();
    expect(row(h)?.name).toBe("general");
    // ⚠ THE THROWING PATH RELEASES TOO — a gate left begun freezes every refetch
    // on the surface, silently (INVARIANTS §7).
    expect(h.gate.begun).toBe(1);
    expect(h.gate.ended).toBe(1);
  });
});
