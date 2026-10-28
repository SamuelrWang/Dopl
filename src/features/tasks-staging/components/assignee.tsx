"use client";

import { useRef, useState } from "react";
import { Check, ChevronDown, Shuffle, Users } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { AvatarScale } from "@/shared/ui/avatar-size";
import { IdentityStack } from "@/shared/ui/avatar-stack";
import { IdentityFace } from "@/shared/ui/identity-face";
import { MenuDivider, MenuItem, Popover } from "@/shared/ui/popover-menu";
import { useRuntimeLogo } from "@/shared/ui/runtime-logo";
import { BARE_TRIGGER_FACE } from "@/shared/ui/select-menu";
import { FactChip } from "@/features/agent-identities/components/identity-section";
import { SEED_IDENTITIES } from "@/features/identities-staging/data";
import { SEED_AGENT_TEAMS } from "@/features/identities-staging/data/agent-teams";
import { photoOf } from "@/features/identities-staging/data-agents";
import { TeamStack } from "@/features/identities-staging/teams/team-faces";
import type { SavedStep, SavedTask, TaskAssignment } from "../data/saved-tasks";
import {
  UNPINNED_CHIP,
  assignedTeam,
  assignmentLabel,
  facesOf,
  identityOf,
} from "../model/assignment";

/** A menu's quiet group heading, the view popup's group-label face. */
const MENU_GROUP = "px-2.5 pb-0.5 pt-1.5 text-label font-semibold uppercase tracking-wide text-text-muted";

/** One identity's face: the owner's photo, the runtime badge, a neutral ring. */
export function useIdentityFace() {
  const logoFor = useRuntimeLogo();
  return (id: string) => {
    const identity = identityOf(id);
    return {
      photo: photoOf(identity?.createdBy ?? null),
      runtimeLogo: logoFor(identity?.runtime),
      ring: "neutral" as const,
    };
  };
}

export function IdentityMark({ id, size }: { id: string; size: AvatarScale }) {
  const faceOf = useIdentityFace();
  return <IdentityFace size={size} {...faceOf(id)} />;
}

/** The team as a chip: its roster faces and its name. A team never reads as one identity. */
export function TeamChip({ teamId }: { teamId: string }) {
  const team = SEED_AGENT_TEAMS.find((t) => t.id === teamId);
  if (!team) return <FactChip>Deleted team</FactChip>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-bg-inset py-0.5 pl-0.5 pr-2 text-label text-text-secondary">
      <TeamStack team={team} size="xs" />
      <Users size={11} strokeWidth={2} aria-hidden="true" className="flex-none text-text-muted" />
      <span className="truncate font-medium text-text-primary">{team.name}</span>
    </span>
  );
}

/** Who a task goes to, as a face row: a team chip, an identity stack, or "Nobody yet". */
export function AssignmentFaces({
  task,
  size = "s",
}: {
  task: Pick<SavedTask, "assignment" | "steps">;
  size?: AvatarScale;
}) {
  const faceOf = useIdentityFace();
  const team = assignedTeam(task);
  if (team) return <TeamChip teamId={team.id} />;
  const ids = facesOf(task);
  if (ids.length === 0) return <span className="text-label text-text-muted">Nobody yet</span>;
  return (
    <IdentityStack
      size={size}
      max={4}
      label={ids.map((id) => identityOf(id)?.name ?? "Deleted identity").join(", ")}
      faces={ids.map((id) => ({ key: id, ...faceOf(id) }))}
    />
  );
}

/** A step's owner: its pinned identity, or the muted "Agents decide" chip. */
export function StepOwner({ step }: { step: SavedStep }) {
  if (!step.pinnedIdentityId) {
    return (
      <FactChip mark={<Shuffle size={11} strokeWidth={2} aria-hidden="true" />}>{UNPINNED_CHIP}</FactChip>
    );
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-caption text-text-secondary">
      <IdentityMark id={step.pinnedIdentityId} size="s" />
      <span className="truncate">{identityOf(step.pinnedIdentityId)?.name ?? "Deleted identity"}</span>
    </span>
  );
}

/**
 * THE ONE ASSIGNEE PICKER: Nobody, then the Agent teams group, then the Identities group. A team
 * is one choice; identities toggle, so several can be picked. Nothing is required.
 */
export function AssigneePicker({
  value,
  onChange,
}: {
  value: TaskAssignment;
  onChange: (next: TaskAssignment) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number } | null>(null);
  const picked = value.kind === "identities" ? value.identityIds : [];

  const toggle = () => {
    if (anchor) return setAnchor(null);
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setAnchor({ x: r.left, y: r.bottom + 4, width: r.width });
  };
  const toggleIdentity = (id: string) => {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    onChange(next.length === 0 ? { kind: "none" } : { kind: "identities", identityIds: next });
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-label="Assign to"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        className={cn("inline-flex min-w-0 max-w-full items-center gap-1.5", BARE_TRIGGER_FACE)}
      >
        <span className="min-w-0 truncate">{assignmentLabel(value)}</span>
        <ChevronDown size={11} className="shrink-0 text-text-muted" />
      </button>
      <Popover
        open={anchor !== null}
        at={anchor ?? undefined}
        triggerWidth={anchor?.width}
        onClose={() => setAnchor(null)}
        className="w-72"
      >
        <MenuItem
          showCheck
          active={value.kind === "none"}
          description="Launch picks, or the channel's agents take it"
          onSelect={() => {
            setAnchor(null);
            onChange({ kind: "none" });
          }}
        >
          Nobody
        </MenuItem>
        <MenuDivider />
        <p className={MENU_GROUP}>Agent teams</p>
        {SEED_AGENT_TEAMS.map((team) => (
          <MenuItem
            key={team.id}
            showCheck
            active={value.kind === "team" && value.teamId === team.id}
            icon={<TeamStack team={team} size="xs" />}
            onSelect={() => {
              setAnchor(null);
              onChange({ kind: "team", teamId: team.id });
            }}
          >
            {team.name}
          </MenuItem>
        ))}
        <MenuDivider />
        <p className={MENU_GROUP}>Identities</p>
        {SEED_IDENTITIES.map((identity) => (
          <MenuItem
            key={identity.id}
            checked={picked.includes(identity.id)}
            icon={
              <span className="flex items-center gap-1.5">
                <Check
                  size={11}
                  aria-hidden="true"
                  className={cn("text-text-primary", !picked.includes(identity.id) && "opacity-0")}
                />
                <IdentityMark id={identity.id} size="xs" />
              </span>
            }
            onSelect={() => toggleIdentity(identity.id)}
          >
            {identity.name}
          </MenuItem>
        ))}
      </Popover>
    </>
  );
}
