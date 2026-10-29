import { HOME_PATH } from "#/components/app-shell/account-rail";

/**
 * "OPEN /home ON THIS CHANNEL" AS A URL — `/home?channel=<workspaceId>&thread=…&seq=…`
 * (2026-10-29, Samuel: "Yes, fix it").
 *
 * A home channel has no route (`use-activity-jump.ts`), so anything OUTSIDE /home
 * that means one — the shell's redirect off a `kind='link'` container's workspace
 * URL, an OS notification that landed there — hands /home an INTENT in the query.
 * `index.tsx` consumes it ONCE through the same `jump.open` the search popup uses,
 * then clears it, so a reload or Back does not re-raise a thread the operator left.
 *
 * ⚠ `channel` IS THE CONTAINER ID, never the channel id: /home addresses a
 * relationship by its workspace (`home-rows.ts › channelRowId`). A container that is
 * not among the rows falls back to the page's own first row — the empty and failed
 * reads land on /home like every other arrival.
 */
export interface HomeIntent {
  workspaceId: string;
  threadId: string | null;
  seq: number | null;
}

export function homeChannelPath(
  workspaceId: string,
  threadId: string | null = null,
  seq: number | null = null
): string {
  const params = new URLSearchParams({ channel: workspaceId });
  if (threadId) params.set("thread", threadId);
  if (seq !== null) params.set("seq", String(seq));
  return `${HOME_PATH}?${params.toString()}`;
}

/** `?thread=` / `?seq=` off a workspace channel URL — the selection the channels page
 *  reads (`pages/channels/index.tsx`), carried across. ⚠ PARSED, NEVER TRUSTED: a
 *  non-positive or non-numeric seq is `null`, and an empty thread is no thread. */
export function readThreadSelection(params: URLSearchParams): {
  threadId: string | null;
  seq: number | null;
} {
  const seq = Number(params.get("seq"));
  return {
    threadId: params.get("thread") || null,
    seq: Number.isSafeInteger(seq) && seq > 0 ? seq : null,
  };
}

export function readHomeIntent(params: URLSearchParams): HomeIntent | null {
  const workspaceId = params.get("channel");
  if (!workspaceId) return null;
  return { workspaceId, ...readThreadSelection(params) };
}
