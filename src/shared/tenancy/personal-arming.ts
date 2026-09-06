import "server-only";
import { isSharedCredential, type CredentialAxes } from "@/shared/auth/credential-audience";
import { HttpError } from "@/shared/lib/http-error";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * 🔒 **FLIPPING THE SWITCH `personal-reach.ts` READS** — the WRITE half of task
 * 11's security package (design #1077, approved #1080), over the table
 * `supabase/migrations/20260925120000_channel_personal_arming.sql` defines.
 *
 * ⚠ **IT IS THE SHIPPING GATE, AND THAT IS WHY IT EXISTS.** The fence landed
 * first and closed every shared room; the table and the read probe existed with
 * nothing able to write a row, so no room could be armed by anybody. Both prior
 * sessions named this as the thing that must not reach an operator's machine
 * unbuilt — a control people cannot reach is a behaviour change they cannot
 * undo.
 *
 * ⚠ **IT MIRRORS THE RLS IN CODE, DELIBERATELY, AND THE TWO MUST NOT DRIFT.**
 * These writes go through the service role (`supabaseAdmin`) exactly as
 * `personal-reach.ts`'s probe does, so the policies are not what stops a bad
 * write here — they are the second fence for anything that reaches the table by
 * another door. Each rule below names the policy it mirrors:
 *
 *   - **OWNER-ONLY, EVERY DIRECTION** (`*_select_own` / `*_insert_own` /
 *     `*_delete_own`): `owner_id` is always the CALLER. There is no argument for
 *     whose shelf — arming somebody else's shelf is not a narrower version of
 *     this operation, it is a different one, and it does not exist.
 *   - **ARMING REQUIRES AN ACTIVE MEMBERSHIP OF THE ROOM** (`*_insert_own`'s
 *     `EXISTS` over `channel_members`): a switch flipped for a room the owner is
 *     not in would open their shelf to a session they can never watch.
 *   - **DISARMING CARRIES NO MEMBERSHIP TEST** (`*_delete_own`): leaving a room
 *     must not strand an armed row its owner can no longer delete. ⚠ Closing is
 *     always allowed; a refusal on this path is a refusal that keeps reach OPEN.
 *
 * 🔒 **A HUMAN ACT — AN AGENT MAY NOT ARM ITS OWN REACH.** The migration's
 * header says "a human act, per room, revocable" and this is where that becomes
 * true: `source === "agent"` is refused. A gate whose subject can open it is not
 * a gate, and this one is the whole of the shared-room boundary.
 *
 * ⚠ **A SHARED CREDENTIAL IS REFUSED FOR THE SAME REASON THE FENCE REFUSES IT**
 * (`personal-reach.ts` clause 1): it stands for nobody in particular, so there
 * is no one shelf it could be arming.
 *
 * ⚠ **NOT AN ORACLE, AND THE 404 IS LOAD BEARING.** A channel the caller is not
 * in, one in another tenancy, and one that does not exist are ONE answer here —
 * the same rule `shared/api/channel-knowledge-lane.ts` states for its own
 * refusal. A distinct "you are not a member" would make this route an
 * enumeration of rooms.
 */

/** Who is asking. ⚠ Structural, like {@link CredentialAxes} — the route builds
 *  one from the auth context it already has. */
export interface PersonalArmingCaller extends CredentialAxes {
  /** The owner, and the only `owner_id` this module will ever write. */
  userId: string;
  /** ⚠ Only the literal `"agent"` is refused, matching the fence's reading of
   *  the same field — everything else, absent included, is a person. */
  source?: string | null;
}

/** 🔒 The human-only refusal. ⚠ Never carries the room's state: it answers who
 *  the CALLER is, which is a fact the caller already has. */
export class PersonalArmingForbiddenError extends HttpError {
  constructor(reason: string) {
    super(403, "PERSONAL_ARMING_FORBIDDEN", `You cannot change this switch — ${reason}.`);
    this.name = "PersonalArmingForbiddenError";
  }
}

/** ⚠ ONE ANSWER FOR THREE CAUSES — see "NOT AN ORACLE" above. */
export class ArmingChannelNotFoundError extends HttpError {
  constructor(channelId: string) {
    super(404, "CHANNEL_NOT_FOUND", `Channel not found: ${channelId}`);
    this.name = "ArmingChannelNotFoundError";
  }
}

/**
 * Is this room armed for the CALLER'S OWN shelf? ⚠ Own row only, so it answers
 * a fact the caller owns and cannot be pointed at anybody else's.
 */
export async function isChannelArmed(
  caller: PersonalArmingCaller,
  channelId: string
): Promise<boolean> {
  assertHumanOwner(caller);
  const { data, error } = await supabaseAdmin()
    .from("channel_personal_arming")
    .select("channel_id")
    .eq("channel_id", channelId)
    .eq("owner_id", caller.userId)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

/**
 * ARM: this owner's agent sessions in this room may reach this owner's personal
 * shelf.
 *
 * ⚠ **IDEMPOTENT BY UPSERT, NOT BY A READ-THEN-INSERT.** The primary key is
 * `(channel_id, owner_id)`, so a second press is the same row; checking first
 * and inserting after is the same statement with a race in the middle.
 * ⚠ `armed_at` is NOT re-stamped on a repeat — `ignoreDuplicates` keeps the
 * original moment, which is the fact an audit of "since when" would want.
 */
export async function armChannelForPersonalShelf(
  caller: PersonalArmingCaller,
  channelId: string
): Promise<{ armed: true }> {
  assertHumanOwner(caller);
  // 🔒 THE MEMBERSHIP FENCE, mirroring `*_insert_own`. ⚠ BEFORE the write, and
  // its refusal is the 404 — a caller who is not in the room learns nothing
  // about whether it exists.
  await assertChannelMemberRow(caller.userId, channelId);
  const { error } = await supabaseAdmin()
    .from("channel_personal_arming")
    .upsert(
      { channel_id: channelId, owner_id: caller.userId },
      { onConflict: "channel_id,owner_id", ignoreDuplicates: true }
    );
  if (error) throw error;
  return { armed: true };
}

/**
 * DISARM. ⚠ **NO MEMBERSHIP READ, AND NO NOT-FOUND ON A MISSING ROW.** Both
 * omissions are the same rule: closing must always be available. A delete of a
 * row that is not there leaves the caller where they asked to be — out of reach
 * — so answering 404 would be a refusal in the direction the switch must never
 * refuse.
 */
export async function disarmChannelForPersonalShelf(
  caller: PersonalArmingCaller,
  channelId: string
): Promise<{ armed: false }> {
  assertHumanOwner(caller);
  const { error } = await supabaseAdmin()
    .from("channel_personal_arming")
    .delete()
    .eq("channel_id", channelId)
    .eq("owner_id", caller.userId);
  if (error) throw error;
  return { armed: false };
}

/** 🔒 Human, and standing for exactly one person. Both arms refuse rather than
 *  narrowing: there is no smaller version of "arm my shelf". */
function assertHumanOwner(caller: PersonalArmingCaller): void {
  if (isSharedCredential(caller)) {
    throw new PersonalArmingForbiddenError(
      "a credential that can be passed between people stands for nobody's personal shelf"
    );
  }
  if (caller.source === "agent") {
    throw new PersonalArmingForbiddenError(
      "arming a room for your personal shelf is a human-only setting, so an agent cannot open its own reach"
    );
  }
}

/**
 * **IS THERE A `channel_members` ROW FOR THIS PAIR** — membership of the room,
 * as the insert policy asks it.
 *
 * ⚠ **IT WAS CALLED `assertActiveMember` AND THE NAME PROMISED A CHECK THAT DOES
 * NOT EXIST** (renamed 2026-09-06). `channel_members` carries NO STATUS COLUMN
 * (see `20260725120000_channels.sql`), so there is no active/inactive to test:
 * the row's existence IS the membership, which is exactly what `*_insert_own`'s
 * `EXISTS` tests. A reader who took "active" at face value would look for a
 * predicate that was never here, or add a second one — and the sibling that
 * really does test aliveness, `repository.isActiveWorkspaceMember`, reads a
 * DIFFERENT table for a different fact. The name now says the row and the table.
 *
 * ⚠ If `channel_members` ever grows a status, this read and the policy both have
 * to learn it, in the same change.
 */
async function assertChannelMemberRow(
  userId: string,
  channelId: string
): Promise<void> {
  const { data, error } = await supabaseAdmin()
    .from("channel_members")
    .select("user_id")
    .eq("channel_id", channelId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (data === null) throw new ArmingChannelNotFoundError(channelId);
}
