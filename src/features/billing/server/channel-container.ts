import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { WorkspaceKind } from "@/features/workspaces/types";

/**
 * WHICH CONTAINER A CHANNEL LIVES IN — the ONE read rule B needs that the credit
 * path did not already make (Samuel, 2026-09-13: *"charge the calling channel's
 * container; with no calling channel, charge the resource's container"*).
 *
 * ⚠ **REPOSITORY ONLY (INVARIANTS §2), AND IN `billing/server/` RATHER THAN IN
 * THE CHANNELS FEATURE, DELIBERATELY.** It answers a BILLING question — where
 * does this burn land — and every suite on the credit path mocks this directory
 * wholesale. Reaching into `channels/server/` for it would put the hottest write
 * path in the product behind a module whose other reads carry channel fences,
 * roles and visibility rules that have nothing to do with a wallet.
 *
 * ⚠ **ONE ROUND TRIP: the channel row with its container's `kind` EMBEDDED**,
 * the same many-to-one embed shape `workspace-billing.ts › getPersonalBilling`
 * uses. The kind is what picks the wallet, so fetching it separately would cost
 * a second statement on every channel-attributed tool call.
 */

/** A channel, and the container whose wallet its burns land on. */
export interface ChannelContainer {
  /** The channel's own id — what the ledger's `channel_id` stores. */
  channelId: string;
  /** The container the channel lives in: `link` for a home channel, `standard`
   *  for a workspace channel. */
  workspaceId: string;
  /** ⚠ WIDE ON PURPOSE: a value the enum does not carry must reach
   *  `isStandardWorkspace`'s NEGATIVE arm, not a crash. */
  kind: WorkspaceKind | string;
}

/**
 * The container behind `channelId`, or `null` when there is no such channel.
 *
 * ⚠ **`null` IS "NO CALLING CHANNEL", WHICH IS RULE B's OWN FALLBACK** — the
 * caller charges the resource's container instead, exactly as a Claude Desktop
 * connection does. That is the fail-SAFE direction: a channel id that resolves to
 * nothing must never become a refusal (fail-open is this path's whole posture)
 * and must never become a guess.
 *
 * ⚠ **A SOFT-DELETED CHANNEL STILL ANSWERS.** `channels.deleted_at` is not
 * filtered: the burn really was made by a session in that channel, the FK still
 * resolves, and filing it under the channel it happened in is more honest than
 * filing it as Desktop agent. A HARD delete takes the row, and then the ledger's
 * `ON DELETE SET NULL` moves the row to Desktop agent on its own.
 *
 * 🔒 **THE CALLER MUST STILL FENCE IT.** The channel id reaching this function
 * comes from `X-Dopl-Session-Id`, a documented NON-authorization signal any
 * device-token holder can forge (`shared/auth/session-header.ts`), and the answer
 * here decides WHOSE WALLET MOVES. `credits-service.ts › resolveBillingTarget` is
 * where that is checked — this function looks nothing up about the caller and may
 * never be read as having cleared them.
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
