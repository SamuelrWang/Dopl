import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { WorkspaceKind } from "@/features/workspaces/types";

/**
 * Which container a channel lives in — the one read rule B needs (2026-09-13:
 * charge the calling channel's container; with no calling channel, the resource's).
 *
 * Repository only (INVARIANTS §2), and in `billing/server/` rather than the
 * channels feature: it answers a billing question, and every suite on the credit
 * path mocks this directory wholesale.
 *
 * One round trip — the channel row with its container's `kind` embedded, the same
 * many-to-one shape `workspace-billing.ts › getPersonalBilling` uses. The kind
 * picks the wallet, so fetching it separately would cost a second statement on
 * every channel-attributed tool call.
 */

/** A channel, and the container whose wallet its burns land on. */
export interface ChannelContainer {
  /** The channel's own id — what the ledger's `channel_id` stores. */
  channelId: string;
  /** The container the channel lives in: `link` for a home channel, `standard`
   *  for a workspace channel. */
  workspaceId: string;
  /** Wide on purpose: a value the enum does not carry must reach
   *  `isStandardWorkspace`'s negative arm, not a crash. */
  kind: WorkspaceKind | string;
}

/**
 * The container behind `channelId`, or `null` when there is no such channel.
 *
 * `null` is "no calling channel", which is rule B's own fallback: the caller
 * charges the resource's container instead. A channel id that resolves to nothing
 * must never become a refusal and never a guess.
 *
 * A soft-deleted channel still answers — `channels.deleted_at` is not filtered,
 * because the burn really was made by a session in that channel. A hard delete
 * takes the row, and the ledger's `ON DELETE SET NULL` moves it to Desktop agent.
 *
 * The caller must still fence it: the channel id comes from `X-Dopl-Session-Id`, a
 * non-authorization signal any device-token holder can forge, and the answer here
 * decides whose wallet moves. `credits-service.ts › resolveBillingTarget` is where
 * that is checked; this function clears nobody.
 */
export async function findChannelContainer(
  channelId: string
): Promise<ChannelContainer | null> {
  const { data, error } = await supabaseAdmin()
    .from("channels")
    .select("id, workspace_id, workspaces!inner(kind)")
    .eq("id", channelId)
    .maybeSingle();
  if (error) throw error;
  const row = data as {
    id: string;
    workspace_id: string;
    workspaces: { kind: string } | null;
  } | null;
  if (!row?.workspaces) return null;
  return {
    channelId: row.id,
    workspaceId: row.workspace_id,
    kind: row.workspaces.kind,
  };
}
