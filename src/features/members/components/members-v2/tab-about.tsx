"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { InlineEditableRow } from "@/shared/ui/inline-editable-row";
import { SectionBox } from "@/shared/ui/section-box";
import { toast } from "@/shared/ui/toast";
import { useProfileWrites } from "./hooks";
import type { TeamView } from "@/features/teams/types";
import type { WorkspaceMemberView } from "../../types";
import { FieldRow, PaneHeading } from "./bits";
import { MemberFacts } from "./member-facts";
import { displayNameOf } from "./view-model";
import type { MemberVisibility } from "./visibility";

/**
 * About: identity + how the member is scoped. Self-view edits `display_name`
 * and `bio` — the only two profile fields with a column behind them.
 *
 * ⚠ The write invalidates the ROSTER as well as the profile: `display_name` is
 * what the list row and the detail header render, and they read it from the
 * members cache. Without that key the name visibly reverts on the next paint.
 */
export function AboutTab({
  workspaceSlug,
  member,
  teams,
  visibility,
  bio,
  busy,
  onJoinTeam,
  onLeaveTeam,
}: {
  workspaceSlug: string;
  member: WorkspaceMemberView;
  teams: TeamView[];
  visibility: MemberVisibility;
  bio: string | null;
  busy: boolean;
  onJoinTeam: (teamId: string) => void;
  onLeaveTeam: (teamId: string) => void;
}) {
  const editable = visibility.editableProfile;
  const profileWrites = useProfileWrites(workspaceSlug);
  const patch = async (fields: { display_name?: string | null; bio?: string | null }) => {
    await profileWrites.mutateAsync(fields);
  };

  return (
    <div className="flex flex-col gap-3.5">
      <PaneHeading
        title="About"
        subtitle={
          editable
            ? "Your profile. Everything here is visible to the rest of the workspace."
            : "Who this member is, and how they are scoped."
        }
      />

      {editable ? (
        <BioEditor value={bio ?? ""} onSave={(next) => patch({ bio: next || null })} />
      ) : bio ? (
        <p className="text-lead leading-relaxed text-text-primary">{bio}</p>
      ) : null}

      <MemberFacts
        member={member}
        teams={teams}
        visibility={visibility}
        busy={busy}
        onJoinTeam={onJoinTeam}
        onLeaveTeam={onLeaveTeam}
      />

      {editable && (
        <SectionBox label="Profile">
          <FieldRow label="Display name">
            <EditableName
              value={displayNameOf(member)}
              onCommit={(next) => patch({ display_name: next })}
            />
          </FieldRow>
        </SectionBox>
      )}
    </div>
  );
}

function EditableName({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (next: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <InlineEditableRow
        value={value}
        ariaLabel="Display name"
        maxLength={80}
        className="w-full"
        onCommit={async (next) => {
          await onCommit(next);
          setEditing(false);
        }}
        onExit={() => setEditing(false)}
        onError={(err) =>
          toast({ title: err instanceof Error ? err.message : "Couldn't save" })
        }
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="group flex min-w-0 cursor-pointer items-center gap-1.5 text-right"
    >
      <span className="min-w-0 truncate">{value}</span>
      <Pencil
        size={11}
        aria-hidden
        className="shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100"
      />
    </button>
  );
}

/** Multi-line, so not `InlineEditableRow` (Enter commits there). Saves on blur
 *  when the text actually changed. */
function BioEditor({
  value,
  onSave,
}: {
  value: string;
  onSave: (next: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-label font-semibold uppercase tracking-wide text-text-muted">
        Bio
      </span>
      <textarea
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={async () => {
          if (draft.trim() === value.trim()) return;
          setSaving(true);
          try {
            await onSave(draft.trim());
          } catch (err) {
            setDraft(value);
            toast({ title: err instanceof Error ? err.message : "Couldn't save bio" });
          } finally {
            setSaving(false);
          }
        }}
        rows={3}
        maxLength={2000}
        className="concave-field w-full resize-none rounded-[9px] px-3 py-2 text-lead leading-relaxed text-text-primary outline-none placeholder:text-text-muted disabled:opacity-60"
        placeholder="A line or two about what you work on."
      />
    </label>
  );
}
