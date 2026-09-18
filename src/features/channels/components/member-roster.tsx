"use client";

/**
 * THE CHANNEL ROSTER — one member row, and the online/offline list they sit in.
 *
 * ⚠ §1 SPLIT OUT OF `info-tab.tsx` (2026-08-25, Samuel: *"I don't know why
 * you're making it different"*). /home's Info tab had grown a home-local roster
 * because the row was module-private here and copying looked cheaper than
 * exporting; two rosters drift on exactly the axes a reviewer notices first.
 * **Both surfaces now render THIS file.** It did not go into `bits.tsx`, which
 * stood at 480 lines.
 *
 * ⚠ NOTHING ABOUT THE ROW CHANGED IN THE MOVE — a "tidy" while moving is how a
 * move becomes a redesign nobody reviewed.
 */

import type { ReactNode } from "react";
import { AvatarWithPresence } from "@/shared/ui/avatar-with-presence";
import { cn } from "@/shared/lib/utils";
import { RolePill } from "./bits";
import { isPresentForViewer, memberPerson } from "./view-model";
import type { ChannelMember } from "../types";

/**
 * One roster row. Presence is `AvatarWithPresence`'s ring — the kit's recipe,
 * never a standalone dot — and the boolean is **the SERVER's `agentOnline`** since
 * 2026-09-08 (INVARIANTS §7). ⚠ IT WAS CLIENT-SIDE arithmetic over `lastSeenAt`,
 * and reading OFFLINE on a stale roster was the BUG, not a safety property. The
 * row is handed a decided boolean and draws it.
 *
 * The subline is the member's email, not a job title: the model has no such
 * field, and the chip states the one role a channel roster carries (INVARIANTS §5).
 */
export function MemberRow({
  member,
  online,
  action,
}: {
  member: ChannelMember;
  online: boolean;
  /**
   * THE ROW'S TRAILING CONTROL, INJECTED — Remove / Leave (R-09, Samuel
   * 2026-09-17). ⚠ NOT BUILT HERE, on `info-tab.tsx › membersAction`'s reason
   * exactly: it is write-bearing and this file fetches nothing (INVARIANTS §7).
   * ⚠ ABSENT IS THE DEFAULT AND MEANS "no control", never a disabled one.
   */
  action?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex h-[46px] items-center gap-2.5 rounded-[8px] px-2",
        !online && "opacity-60"
      )}
    >
      <AvatarWithPresence
        person={memberPerson(member)}
        online={online}
        size="sm"
        title={online ? "Agent listening" : "Agent offline"}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-semibold text-text-primary">
          {member.displayName ?? member.email ?? "Member"}
        </span>
        {member.email && (
          <span className="truncate text-caption text-text-muted">{member.email}</span>
        )}
      </span>
      <RolePill
        owner={member.role === "owner"}
        guest={member.workspaceRole === "guest"}
      />
      {action}
    </div>
  );
}

/**
 * THE WHOLE LIST: present members, then an `Offline` rule and the rest.
 *
 * ⚠ THE PARTITION TRAVELS WITH THE ROW, which is why the LIST is exported and not
 * only the row: sharing the row alone would leave the two surfaces free to
 * disagree about ORDER, the half a reader actually reads.
 *
 * ⚠ `emptyLine` IS OPT-IN. A workspace channel really can have no members; a home
 * channel cannot, so over there the sentence could only appear during the roster
 * read's first frame — flashing a claim that is false.
 */
export function MemberRoster({
  members,
  emptyLine,
  viewerUserId,
  rowAction,
}: {
  members: ChannelMember[];
  /** Render "No members in this channel." for an empty roster. Default off. */
  emptyLine?: boolean;
  /**
   * THE VIEWER, so their own row can render online whenever this desktop app is
   * running (`view-model.ts › isPresentForViewer`).
   *
   * ⚠ **IT COMES FROM `AuthorIndex.currentUserId`** — the id the host already
   * holds (`indexMembers`), never a second resolution and never a `useSession`
   * mounted here. ⚠ OPTIONAL: absent means "no override", not "nobody is online".
   */
  viewerUserId?: string | null;
  /**
   * WHAT SITS AT THE END OF EACH ROW — asked per member, because the answer is
   * per member (R-09: Remove on somebody else's row, Leave on your own).
   * ⚠ A HOST'S, reached through `channel-surface-contract.ts ›
   * ChannelInfoExtras.rosterRowAction`. Returning `null` draws nothing, which
   * is what every row gets on a host that passes no function at all.
   */
  rowAction?: (member: ChannelMember) => ReactNode;
}) {
  // ⚠ ONE PASS, ONE PREDICATE, ONE `now` — the partition used to call `isPresent`
  // twice per member with two different `Date.now()` defaults, so a member could
  // land in NEITHER list (or both).
  const presence = new Map(
    members.map((m) => [m.userId, isPresentForViewer(m, viewerUserId)] as const)
  );
  const online = members.filter((m) => presence.get(m.userId));
  const offline = members.filter((m) => !presence.get(m.userId));

  return (
    <div className="flex flex-col gap-px px-2">
      {online.map((member) => (
        <MemberRow
          key={member.userId}
          member={member}
          online
          action={rowAction?.(member)}
        />
      ))}
      {/* ⚠ The condition is `offline.length > 0` and NOTHING ELSE — the same test
          `info-tab.tsx` shipped. An all-offline roster leads with the rule, which
          looks odd on a two-person container and is what the channels page does. */}
      {offline.length > 0 && (
        <p className="px-2 pb-1 pt-3 text-label font-semibold uppercase tracking-wide text-text-muted">
          Offline
        </p>
      )}
      {offline.map((member) => (
        <MemberRow
          key={member.userId}
          member={member}
          online={false}
          action={rowAction?.(member)}
        />
      ))}
      {emptyLine && members.length === 0 && (
        <p className="px-2 py-2 text-caption text-text-muted">
          No members in this channel.
        </p>
      )}
    </div>
  );
}
