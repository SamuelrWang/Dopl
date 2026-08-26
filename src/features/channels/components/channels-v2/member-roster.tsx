"use client";

/**
 * THE CHANNEL ROSTER — one member row, and the online/offline list they sit in.
 *
 * ⚠ §1 SPLIT OUT OF `info-tab.tsx` (2026-08-25, Samuel: *"I don't know why
 * you're making it different"*). /home's Info tab had grown a home-local roster
 * — smaller avatar, no email, its own row height — because the row was
 * module-private over there and copying looked cheaper than exporting. It is
 * not: a roster is one object, and two of them drift on exactly the axes a
 * reviewer notices first. **Both surfaces now render THIS file.** It did not go
 * into `bits.tsx`, which stood at 480 lines with the `MetaRow` × just added.
 *
 * ⚠ NOTHING ABOUT THE ROW CHANGED IN THE MOVE — same `AvatarWithPresence`,
 * same `size="sm"`, same `h-[46px]`, same name-over-email stack, same
 * `RolePill`, same `opacity-60` when offline. A "tidy" while moving is how a
 * move becomes a redesign nobody reviewed.
 */

import { AvatarWithPresence } from "@/shared/ui/avatar-with-presence";
import { cn } from "@/shared/lib/utils";
import { RolePill } from "./bits";
import { isPresent, memberPerson } from "./view-model";
import type { ChannelMember } from "../../types";

/**
 * One roster row. Presence is `AvatarWithPresence`'s ring — the kit's recipe,
 * never a standalone dot — and the boolean is CLIENT-SIDE arithmetic over
 * `lastSeenAt` (INVARIANTS §7), so a stale roster reads OFFLINE rather than
 * falsely online.
 *
 * The subline is the member's email, not a job title: the model has no such
 * field, and the chip beside it states the one role a channel roster actually
 * carries (INVARIANTS §5).
 */
export function MemberRow({
  member,
  online,
}: {
  member: ChannelMember;
  online: boolean;
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
    </div>
  );
}

/**
 * THE WHOLE LIST: present members, then an `Offline` rule and the rest.
 *
 * ⚠ THE PARTITION TRAVELS WITH THE ROW, and that is the point of exporting the
 * list rather than only the row. /home's first attempt reused neither and
 * arrived at a different object; reusing only the ROW would have left the two
 * surfaces free to disagree about ORDER, which is the half a reader actually
 * reads.
 *
 * ⚠ `emptyLine` IS OPT-IN. The channels page states "No members in this
 * channel." because a workspace channel really can have none. A home channel
 * cannot — the caller is a member of their own container — so over there the
 * only way to see that sentence is during the roster read's first frame
 * (`keepPreviousData` starts empty), which would flash a claim that is false.
 */
export function MemberRoster({
  members,
  emptyLine,
}: {
  members: ChannelMember[];
  /** Render "No members in this channel." for an empty roster. Default off. */
  emptyLine?: boolean;
}) {
  const online = members.filter((m) => isPresent(m));
  const offline = members.filter((m) => !isPresent(m));

  return (
    <div className="flex flex-col gap-px px-2">
      {online.map((member) => (
        <MemberRow key={member.userId} member={member} online />
      ))}
      {/* ⚠ The condition is `offline.length > 0` and NOTHING ELSE — the same
          test `info-tab.tsx` shipped. An all-offline roster therefore leads
          with the rule, which looks odd on a two-person container and is
          nonetheless what the channels page does. Changing it here would make
          this a redesign wearing a move's clothes. */}
      {offline.length > 0 && (
        <p className="px-2 pb-1 pt-3 text-label font-semibold uppercase tracking-wide text-text-muted">
          Offline
        </p>
      )}
      {offline.map((member) => (
        <MemberRow key={member.userId} member={member} online={false} />
      ))}
      {emptyLine && members.length === 0 && (
        <p className="px-2 py-2 text-caption text-text-muted">
          No members in this channel.
        </p>
      )}
    </div>
  );
}
