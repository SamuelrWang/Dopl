// @vitest-environment jsdom
/**
 * THE TRANSCRIPT-READ TEST HARNESS — the fixtures and the mount every
 * `useChannelMessages` suite drives.
 *
 * ⚠ **SPLIT OUT OF `use-channel-messages.test.tsx` ON 2026-09-08**, at the
 * 500-line cap (INVARIANTS §1). A module rather than a copy because a fixture
 * retyped in the second suite is a second definition of what "one page" looks
 * like. Precedent: `server/service-wake-verdict-harness.ts`.
 *
 * ⚠ **NOT A `.test.` FILE, ON PURPOSE** — `vitest.config.ts › include` matches
 * only `.test.ts` / `.test.tsx`, so this name keeps a file with no `it()` out of
 * the run.
 *
 * ⚠ **`vi.mock` IS THE IMPORTING SUITE'S JOB, NOT THIS FILE'S.** Mock hoisting is
 * per test file; the `apiRequest` imported here resolves to whatever that suite
 * mocked, which is why every helper below reaches it through `vi.mocked`.
 */

import { act, render } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { apiRequest } from "@/shared/api/api-client";
import {
  CHANNEL_TRANSCRIPT_LINE_BUDGET,
  CHANNEL_TRANSCRIPT_PAGE_MAX_ROWS,
} from "../constants";
import { channelMessagesParams, channelMessagesPath } from "../client/query-keys";
import { useChannelMessages } from "./use-channel-messages";
import type { ChannelMessage } from "../types";

/** The query half of a transcript read, as `channelMessagesParams` builds it. */
export const PAGE_PARAMS = {
  limit: CHANNEL_TRANSCRIPT_PAGE_MAX_ROWS,
  lineBudget: CHANNEL_TRANSCRIPT_LINE_BUDGET,
};

export const WORKSPACE = "ws-1";
export const CHANNEL = "c-1";
export const OTHER = "c-2";

/** ⚠ BUILT, never retyped: `[path, workspaceId, query]` is the tuple the read
 *  registers and the writes patch, and one differing element is a silent no-op. */
export const cacheKey = () =>
  [channelMessagesPath(CHANNEL), WORKSPACE, channelMessagesParams()] as const;

export function msg(seq: number, over: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    id: `m-${seq}`,
    seq,
    channelId: CHANNEL,
    authorUserId: "u-1",
    authorKind: "user",
    kind: "message",
    body: `body ${seq}`,
    metadata: {},
    clientMsgId: null,
    createdAt: "2026-08-31T00:00:00.000Z",
    authorName: null,
    authorAvatarUrl: null,
    ...over,
  };
}

/** A run of `count` messages ending at `top`, ascending — one server page. */
export function page(top: number, count: number): ChannelMessage[] {
  return Array.from({ length: count }, (_, i) => msg(top - count + 1 + i));
}

export type Hook = ReturnType<typeof useChannelMessages>;

/** The reads this mount saw, as `{limit, before?}` — the query half alone. */
export function requests(): Array<Record<string, unknown>> {
  return vi
    .mocked(apiRequest)
    .mock.calls.map(([, opts]) => (opts?.query ?? {}) as Record<string, unknown>);
}

/**
 * ONE MACROTASK. `await act(async () => {})` drains microtasks only, and
 * TanStack schedules its observer notifications on a timer — so a query whose
 * fetch has already resolved still renders its old data until a real tick has
 * passed.
 */
export const settle = () =>
  act(async () => {
    // ⚠ TWO, not one: the fetch resolving and the observer notifying are
    // separate ticks, and `useApiQuery`'s stranded-query nudge adds a third
    // timer on top of them.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

/** Publishes from an effect — a render-phase write trips `react-hooks/immutability`. */
export async function mount(
  channelId: string | null = CHANNEL,
  /**
   * A cache entry written BEFORE this mount — the §8 case. It is the RAW response
   * body, because that is what `useApiQuery` stores and what the optimistic
   * writes patch.
   */
  seed?: Record<string, unknown>
) {
  // ⚠ ONE client for the whole mount. Minting it inside a `wrapper` component
  // makes a fresh cache on every rerender, which reads as a query that never
  // resolves.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (seed) client.setQueryData(cacheKey(), seed);
  const holder: { value: Hook | null } = { value: null };
  function Probe({ id }: { id: string | null }) {
    const state = useChannelMessages(id, WORKSPACE);
    useEffect(() => {
      holder.value = state;
    });
    return null;
  }
  const tree = (id: string | null): ReactNode => (
    <QueryClientProvider client={client}>
      <Probe id={id} />
    </QueryClientProvider>
  );
  const view = render(tree(channelId));
  await settle();
  return {
    holder,
    client,
    read: () => holder.value as Hook,
    async select(next: string | null) {
      view.rerender(tree(next));
      await settle();
    },
    async loadOlder() {
      await act(async () => {
        holder.value?.loadOlder();
      });
      await settle();
    },
  };
}
