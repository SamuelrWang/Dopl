/**
 * The drift guard between the channels READS and the channels WRITES.
 *
 * `client/query-keys.ts` is where an optimistic write learns which cache entry
 * to patch. Some of the read hooks it has to agree with are not built from it
 * (`use-channels` and `use-consent-inbox` each hold their path as a literal —
 * `use-trust-rules` was a third until 2026-08-22, when it was DELETED with the
 * inbound consent lane), and a path that drifts by one character makes every
 * write against it a silent no-op: the
 * patch lands in an entry nobody observes, the screen does not move, and no
 * test fails. So the literals are read off those files here, and this is the
 * test that fails when one of them moves.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { QueryClient } from "@tanstack/react-query";
import { apiQueryKey } from "@/shared/api/query-keys";
import { CHANNEL_TRANSCRIPT_PAGE_SIZE } from "../constants";
import {
  CHANNEL_CONSENT_PATH,
  channelKeys,
  channelListParams,
  channelMessagesParams,
  channelMessagesPath,
  channelThreadsPath,
  channelsPath,
} from "./query-keys";

const CHANNEL = "11111111-1111-4111-8111-111111111111";

function source(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

describe("channel paths", () => {
  it("encodes the channel id into every per-channel path", () => {
    expect(channelMessagesPath("a/b")).toBe("/api/channels/a%2Fb/messages");
    expect(channelThreadsPath(CHANNEL)).toBe(`/api/channels/${CHANNEL}/tasks`);
  });

  it("agrees with the read hooks that hold their path as a literal", () => {
    expect(source("../hooks/use-channels.ts")).toContain(`"${channelsPath()}"`);
    expect(source("../hooks/use-consent-inbox.ts")).toContain(
      `"${CHANNEL_CONSENT_PATH}"`
    );
  });

  /**
   * TWO OF THE SIX STOPPED BEING LITERALS (2026-08-08). `use-channel-threads`
   * and `use-channel-members` each retyped their path by hand — byte-identical
   * to the builder, and pinned above by a string match, which is a guard
   * against drift rather than against the retyping that makes drift possible.
   * They now call the builder, so there is nothing left to drift; what is
   * asserted is that they still do. (`use-channel-members` was never in the
   * list above at all — its literal was unguarded.)
   */
  it("builds the threads and members paths from the factory, not by hand", () => {
    for (const hook of [
      "../hooks/use-channel-threads.ts",
      "../hooks/use-channel-members.ts",
    ]) {
      expect(source(hook)).toContain('from "../client/query-keys"');
      expect(source(hook)).not.toContain("`/api/channels/${");
    }
    expect(source("../hooks/use-channel-threads.ts")).toContain(
      "channelThreadsPath(channelId)"
    );
    expect(source("../hooks/use-channel-members.ts")).toContain(
      "channelMembersPath(channelId)"
    );
  });

  it("agrees with the archived / limit params those reads carry", () => {
    expect(channelListParams(true)).toEqual({ include: "archived" });
    expect(channelListParams(false)).toBeUndefined();
    expect(source("../hooks/use-channels.ts")).toContain(
      'includeArchived ? { include: "archived" } : undefined'
    );
    // ⚠ THE TRANSCRIPT'S PAGE SIZE, NOT `MAX_MESSAGE_LIMIT` (2026-09-01). The
    // read pages backward with a `before` cursor now, so the newest page is one
    // page and the ceiling is only the schema's cap. The key CARRIES the limit,
    // so this number is part of the cache entry the writes patch.
    expect(channelMessagesParams()).toEqual({
      limit: CHANNEL_TRANSCRIPT_PAGE_SIZE,
    });
  });
});

describe("channelKeys", () => {
  it("patches the channel list in BOTH its archived variants at once", () => {
    const client = new QueryClient();
    const active = apiQueryKey(channelsPath(), { workspaceId: "ws" });
    const archived = apiQueryKey(channelsPath(), {
      workspaceId: "ws",
      query: channelListParams(true),
    });
    client.setQueryData(active, { channels: [] });
    client.setQueryData(archived, { channels: [] });
    client.setQueriesData({ queryKey: channelKeys.list().all }, () => ({
      channels: ["patched"],
    }));
    expect(client.getQueryData(active)).toEqual({ channels: ["patched"] });
    expect(client.getQueryData(archived)).toEqual({ channels: ["patched"] });
  });

  it("SCOPES a per-channel patch to that channel and no other", () => {
    // The open race: a channel switch keeps the previous channel's data on
    // screen (`keepPreviousData`, nobody reads `isPlaceholderData`). A write
    // that captured its channel id at submit must not reach the one the user
    // switched to.
    const client = new QueryClient();
    const mine = apiQueryKey(channelMessagesPath(CHANNEL), {
      workspaceId: "ws",
      query: channelMessagesParams(),
    });
    const other = apiQueryKey(channelMessagesPath("other-channel"), {
      workspaceId: "ws",
      query: channelMessagesParams(),
    });
    client.setQueryData(mine, { messages: [] });
    client.setQueryData(other, { messages: [] });
    client.setQueriesData(
      { queryKey: channelKeys.messages(CHANNEL).all },
      () => ({ messages: ["mine"] })
    );
    expect(client.getQueryData(mine)).toEqual({ messages: ["mine"] });
    expect(client.getQueryData(other)).toEqual({ messages: [] });
  });

  it("is the key the messages read registers", () => {
    expect(
      channelKeys
        .messages(CHANNEL)
        .entry({ workspaceId: "ws", query: channelMessagesParams() })
    ).toEqual([
      `/api/channels/${CHANNEL}/messages`,
      "ws",
      { limit: CHANNEL_TRANSCRIPT_PAGE_SIZE },
    ]);
  });
});
