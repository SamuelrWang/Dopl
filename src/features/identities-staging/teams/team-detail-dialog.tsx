"use client";

import { Pencil, Play, UserRound, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { ModalShell } from "@/shared/layout/settings-modal/modal-shell";
import { OPEN_SCALE_ICON, OpenScaleButton } from "@/shared/ui/open-scale-button";
import {
  EventRow,
  Group,
  Prose,
  Rows,
} from "@/features/agent-identities/components/identity-view-parts";
import styles from "@/features/agent-identities/components/identity-view.module.css";
import type { StagingAgentTeam } from "../data/agent-teams";
import { SlotFace, TeamStack } from "./team-faces";
import { identityOf, seatTotal } from "./team-model";

/**
 * THE TEAM VIEW, in the identity view's chrome: a fixed head and a body that alone scrolls. A
 * team is a roster: what it is for, its lead (or none), and its members. It holds no saved tasks;
 * Launch asks for a goal.
 */
export function TeamDetailDialog({
  team,
  marker,
  scopeLabel,
  canLaunch,
  onLaunch,
  onEdit,
  onClose,
}: {
  team: StagingAgentTeam;
  marker: string | null;
  scopeLabel: string;
  canLaunch: boolean;
  onLaunch: () => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const seats = seatTotal(team);
  const lead = team.leadIdentityId ? identityOf(team.leadIdentityId) : null;

  return (
    <ModalShell open onClose={onClose} label={team.name} size="panel">
      <div className={styles.head}>
        <TeamStack team={team} size="l" />
        <div className={styles.headText}>
          <h2 className="min-w-0 truncate text-display font-semibold text-text-primary">{team.name}</h2>
          <p className={cn(styles.headMeta, "text-caption text-text-muted")}>
            <UserRound size={12} strokeWidth={2} className="flex-none" aria-hidden="true" />
            <span className="truncate">{marker ?? "Yours"}</span>
            <span className="text-text-disabled">·</span>
            <span className="truncate">{`${seats} ${seats === 1 ? "agent" : "agents"}`}</span>
            <span className="text-text-disabled">·</span>
            <span className="truncate">{scopeLabel}</span>
          </p>
        </div>
        <OpenScaleButton onClick={onEdit} className="flex-none gap-1.5">
          <Pencil size={OPEN_SCALE_ICON} strokeWidth={2} aria-hidden="true" />
          Edit
        </OpenScaleButton>
        {canLaunch && (
          <OpenScaleButton onClick={onLaunch} className="flex-none gap-1.5">
            <Play size={OPEN_SCALE_ICON} strokeWidth={2} aria-hidden="true" />
            Launch with a goal
          </OpenScaleButton>
        )}
        <button type="button" onClick={onClose} className={styles.close} aria-label="Close agent team">
          <X size="s" />
        </button>
      </div>

      <div className={styles.body}>
        <Group label="What it is for">
          <Prose>{team.description}</Prose>
        </Group>
        <Group label="Lead" hint={lead ? "splits and manages the work" : undefined}>
          {team.leadIdentityId ? (
            <Rows>
              <EventRow
                lead={<SlotFace identityId={team.leadIdentityId} size="m" />}
                title={lead?.name ?? "Deleted identity"}
              />
            </Rows>
          ) : (
            <Prose>No lead. The members decide among themselves who does what.</Prose>
          )}
        </Group>
        <Group label="Members" hint="one agent per seat">
          <Rows>
            {team.slots.map((slot) => (
              <EventRow
                key={slot.id}
                lead={<SlotFace identityId={slot.identityId} size="m" />}
                title={slot.label}
                middle={identityOf(slot.identityId)?.name ?? "Deleted identity"}
                trail={
                  <span className="text-caption tabular-nums text-text-muted">
                    {`×${slot.seats} ${slot.seats === 1 ? "seat" : "seats"}`}
                  </span>
                }
              />
            ))}
          </Rows>
        </Group>
      </div>
    </ModalShell>
  );
}
