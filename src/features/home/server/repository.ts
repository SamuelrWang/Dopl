import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { CHANNEL_LINK_COLS, type ChannelLinkRow } from "./dto";

/**
 * Data access for the LINK half of home channels: `channel_links` and
 * `channel_link_claims`. Every read selects COLUMNS and carries a limit (§9);
 * nothing here authorizes anything.
 *
 * ⚠ THE CONTAINER HALF LIVES IN `repository-containers.ts` and is RE-EXPORTED
 * from the bottom of this file (2026-08-24). The split is one file per reason to
 * change (INVARIANTS §1); the re-export is why `import * as repo from
 * "./repository"` and the suites' `vi.mock("./repository")` did not have to move.
 *
 * ⚠ `workspace_id` IS THE INVERSION, in one column: NULL = a legacy UNBOUND
 * link whose claim mints its own container, non-NULL = a BOUND link whose claim
 * joins the container it names (migration 20260824120000).
 */

/* ------------------------------- links -------------------------------- */

export async function insertLink(args: {
  creatorUserId: string;
  token: string;
  label: string | null;
  expiresAt: string | null;
  maxUses: number | null;
  /** null = legacy UNBOUND link. Non-null binds the claim to that container. */
  workspaceId: string | null;
}): Promise<ChannelLinkRow> {
  const { data, error } = await supabaseAdmin()
    .from("channel_links")
    .insert({
      creator_user_id: args.creatorUserId,
      token: args.token,
      label: args.label,
      expires_at: args.expiresAt,
      max_uses: args.maxUses,
      workspace_id: args.workspaceId,
    })
    .select(CHANNEL_LINK_COLS)
    .single();
  if (error || !data) throw error || new Error("Failed to create link");
  return data as ChannelLinkRow;
}

/**
 * The caller's un-revoked UNBOUND links, newest first. Expiry/exhaustion are
 * judged in the service, by the same predicate the claim path uses.
 *
 * ⚠ `workspace_id IS NULL` IS IN THE QUERY, NOT ABOVE IT. Bound links are
 * rendered as a chip ON their channel's row, never as a list row of their own —
 * and this read carries a ceiling, so filtering after it would drop unbound
 * links that sit past the cap behind bound ones (the shape F-298 already names).
 */
export async function listLinksByCreator(
  creatorUserId: string,
  limit: number
): Promise<ChannelLinkRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("channel_links")
    .select(CHANNEL_LINK_COLS)
    .eq("creator_user_id", creatorUserId)
    .is("workspace_id", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ChannelLinkRow[];
}

/**
 * The container's one open link, if it has one.
 *
 * ⚠ THE PREDICATE MATCHES `channel_links_one_open_per_workspace` EXACTLY —
 * `workspace_id = $1 AND revoked_at IS NULL`, and nothing else. The service
 * reads this first and, on a 23505 from a concurrent mint, reads it AGAIN to
 * find the winner; a narrower predicate here would make that second read come
 * back empty and turn a converged race into a 500.
 */
export async function findOpenLinkForWorkspace(
  workspaceId: string
): Promise<ChannelLinkRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("channel_links")
    .select(CHANNEL_LINK_COLS)
    .eq("workspace_id", workspaceId)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data as ChannelLinkRow | null) ?? null;
}

/**
 * `workspaceId` → its open bound link. THE CHIP READ: one bounded query for a
 * whole page of channels, folded into the existing peers+channels tier so the
 * home payload does not grow a round trip.
 *
 * Backed by `channel_links_workspace_idx` (20260824120000). At most one row per
 * workspace exists by unique index, so `limit` is a safety ceiling rather than a
 * page — the first row per workspace wins, like every other map read here.
 */
export async function listLinksByWorkspaces(
  workspaceIds: string[],
  limit: number
): Promise<Map<string, ChannelLinkRow>> {
  const out = new Map<string, ChannelLinkRow>();
  if (workspaceIds.length === 0) return out;
  const { data, error } = await supabaseAdmin()
    .from("channel_links")
    .select(CHANNEL_LINK_COLS)
    .in("workspace_id", workspaceIds)
    .is("revoked_at", null)
    .limit(limit);
  if (error) throw error;
  for (const row of (data ?? []) as ChannelLinkRow[]) {
    if (row.workspace_id && !out.has(row.workspace_id)) {
      out.set(row.workspace_id, row);
    }
  }
  return out;
}

export async function findLinkByToken(
  token: string
): Promise<ChannelLinkRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("channel_links")
    .select(CHANNEL_LINK_COLS)
    .eq("token", token)
    .maybeSingle();
  if (error) throw error;
  return (data as ChannelLinkRow | null) ?? null;
}

/** Creator-scoped by id — a link that is not the caller's reads as absent. */
export async function findLinkById(
  linkId: string,
  creatorUserId: string
): Promise<ChannelLinkRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("channel_links")
    .select(CHANNEL_LINK_COLS)
    .eq("id", linkId)
    .eq("creator_user_id", creatorUserId)
    .maybeSingle();
  if (error) throw error;
  return (data as ChannelLinkRow | null) ?? null;
}

/** Revoke, scoped to the creator. `false` = no such link, or not theirs. */
export async function markLinkRevoked(
  linkId: string,
  creatorUserId: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("channel_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", linkId)
    .eq("creator_user_id", creatorUserId)
    .is("revoked_at", null)
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * Spend one use, atomically. ⚠ `false` means the link was revoked, expired or
 * exhausted — do NOT re-read the row to find out which, and do not retry: the
 * guard and the increment are one statement precisely so nothing between them
 * can observe a half-state (`consume_channel_link`, migration 20260823150000).
 */
export async function consumeLinkUse(linkId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin().rpc("consume_channel_link", {
    p_link_id: linkId,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data.length : data ? 1 : 0) > 0;
}

/** `false` = this account already claimed this link (the unique constraint). */
export async function insertClaim(args: {
  linkId: string;
  claimedBy: string;
  workspaceId: string;
}): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("channel_link_claims")
    .upsert(
      {
        link_id: args.linkId,
        claimed_by: args.claimedBy,
        workspace_id: args.workspaceId,
      },
      { onConflict: "link_id,claimed_by", ignoreDuplicates: true }
    )
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

/* ----------------------------- containers ----------------------------- */

/**
 * ⚠ RE-EXPORT, NOT A RE-IMPLEMENTATION. `repository-containers.ts` owns these;
 * this line is what keeps `repo.listLinkContainers(...)` resolving for every
 * existing caller and every `vi.mock("./repository")` factory after the split.
 * Import from either module — they are the same bindings.
 */
export * from "./repository-containers";
