"use client";

/**
 * The Settings tab's dialogs, over staging state (`./settings-tab.tsx`).
 *
 * ⚠ **DESTRUCTIVE ONES CONFIRM AND DO NOTHING.** Delete channel, Leave and Delete thread open the
 * product's own `ConfirmDialog` with the product's own copy (`channel-manage.tsx`,
 * `thread-manage.tsx`); Confirm only closes it. Make public confirms with the product's
 * `GoPublicDialog` and then flips the staged visibility.
 * ⚠ **ADD MEMBERS IS A STAND-IN.** The product's `invite-dialog.tsx › InviteDialog` reads two
 * rosters and writes memberships over the API, which staging must never call. This one lists the
 * channel's members plus two staged workspace people, and Add marks them on local state only.
 */

import { useState } from "react";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { StandardDialog } from "@/shared/ui/standard-dialog";
import { IdentityFace } from "@/shared/ui/identity-face";
import { PILL_BUTTON } from "@/shared/ui/small-action-button";
import { StatusPill } from "@/shared/ui/status-pill";
import { GoPublicDialog } from "@/features/channels/components/go-public-dialog";
import type { Channel, ChannelMember, ChannelThread } from "@/features/channels/types";

export type StagingSettingsDialog =
  | null
  | "invite"
  | "go-public"
  | "delete-channel"
  | "leave"
  | "delete-thread";

/** Workspace people who are not in the channel yet (staging only). */
const WORKSPACE_EXTRAS = [
  { userId: "stg-u-priya", name: "Priya Raman" },
  { userId: "stg-u-theo", name: "Theo Park" },
];

function InviteStandIn({
  open,
  onClose,
  members,
}: {
  open: boolean;
  onClose: () => void;
  members: readonly ChannelMember[];
}) {
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const people = [
    ...members.map((m) => ({ userId: m.userId, name: m.displayName ?? m.email ?? "Member", member: true })),
    ...WORKSPACE_EXTRAS.map((p) => ({ ...p, member: added.has(p.userId) })),
  ];
  return (
    <StandardDialog open={open} onClose={onClose} title="Add members">
      <ul className="flex flex-col gap-0.5" aria-label="Workspace members">
        {people.map((p) => (
          <li key={p.userId} className="flex min-h-10 items-center gap-2.5">
            <IdentityFace size={28} name={p.name} />
            <span className="min-w-0 flex-1 text-body text-text-primary">{p.name}</span>
            {p.member ? (
              <StatusPill dot={false}>Member</StatusPill>
            ) : (
              <button
                type="button"
                className={PILL_BUTTON}
                onClick={() => setAdded((s) => new Set(s).add(p.userId))}
              >
                Add
              </button>
            )}
          </li>
        ))}
      </ul>
    </StandardDialog>
  );
}

export function StagingSettingsDialogs({
  open,
  onClose,
  channel,
  members,
  thread = null,
  onGoPublic,
}: {
  open: StagingSettingsDialog;
  onClose: () => void;
  channel: Channel;
  members: readonly ChannelMember[];
  thread?: ChannelThread | null;
  onGoPublic?: () => void;
}) {
  const name = channel.name;
  const shut = (next: boolean) => {
    if (!next) onClose();
  };
  return (
    <>
      <InviteStandIn open={open === "invite"} onClose={onClose} members={members} />
      <GoPublicDialog
        open={open === "go-public"}
        onOpenChange={shut}
        displayName={name}
        onConfirm={() => onGoPublic?.()}
      />
      <ConfirmDialog
        open={open === "delete-channel"}
        onOpenChange={shut}
        title={channel.isDirect ? "Delete conversation?" : "Delete channel?"}
        description={`"${name}", its messages and all its threads will be permanently deleted for everyone in the workspace. This can't be undone.`}
        confirmLabel={channel.isDirect ? "Delete" : "Delete permanently"}
        destructive
        onConfirm={() => {}}
      />
      <ConfirmDialog
        open={open === "leave"}
        onOpenChange={shut}
        title={`Leave "${name}"?`}
        description={
          channel.visibility === "private"
            ? `You'll lose access to "${name}" and its history. It's private, so you can't rejoin on your own — another member would have to invite you back.`
            : `You'll stop following "${name}" and its messages. It's a public channel, so you can rejoin whenever you like.`
        }
        confirmLabel="Leave"
        destructive={channel.visibility === "private"}
        onConfirm={() => {}}
      />
      {thread && (
        <ConfirmDialog
          open={open === "delete-thread"}
          onOpenChange={shut}
          title="Delete thread?"
          description={`"${thread.title}" and all its messages will be permanently deleted for everyone in this channel. This can't be undone.`}
          confirmLabel="Delete permanently"
          destructive
          onConfirm={() => {}}
        />
      )}
    </>
  );
}
