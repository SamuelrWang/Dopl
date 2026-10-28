"use client";

import { useState } from "react";
import { Pencil, Play, UserRound, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { ModalShell } from "@/shared/layout/settings-modal/modal-shell";
import { OPEN_SCALE_ICON, OpenScaleButton } from "@/shared/ui/open-scale-button";
import { SegmentedControl, segmentedIds } from "@/shared/ui/segmented-control";
import {
  EventRow,
  Group,
  Prose,
  Rows,
} from "@/features/agent-identities/components/identity-view-parts";
import styles from "@/features/agent-identities/components/identity-view.module.css";
import type { StagingAgentTeam, StagingTeamTemplate } from "../data/agent-teams";
import { SlotFace, TeamStack } from "./team-faces";
import { identityOf, seatTotal } from "./team-model";

type TabKey = "members" | "templates";

const PANEL_IDS = "team-view";

/**
 * THE TEAM VIEW, in the identity view's chrome: a fixed head, underline tabs, a body that alone
 * scrolls. Members are the slots; each task template lists its steps in order, each bound to the
 * slot that runs it, with that role's instructions.
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
  onLaunch: (templateId: string) => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<TabKey>("members");
  const ids = segmentedIds(PANEL_IDS, tab);
  const seats = seatTotal(team);

  return (
    <ModalShell open onClose={onClose} label={team.name} size="panel">
      <div className={styles.head}>
        <TeamStack team={team} size={40} />
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
        {canLaunch && team.templates[0] && (
          <OpenScaleButton onClick={() => onLaunch(team.templates[0].id)} className="flex-none gap-1.5">
            <Play size={OPEN_SCALE_ICON} strokeWidth={2} aria-hidden="true" />
            Launch
          </OpenScaleButton>
        )}
        <button type="button" onClick={onClose} className={styles.close} aria-label="Close agent team">
          <X size={18} />
        </button>
      </div>

      <SegmentedControl
        variant="underline"
        options={[
          { key: "members", label: "Members", count: team.slots.length },
          { key: "templates", label: "Task templates", count: team.templates.length },
        ]}
        value={tab}
        onChange={setTab}
        ariaLabel="Agent team sections"
        panelIdPrefix={PANEL_IDS}
        className="flex-none border-b border-border-default px-5"
      />

      <div className={styles.body} role="tabpanel" id={ids.panel} aria-labelledby={ids.tab}>
        {tab === "members" ? (
          <>
            <Group label="What it is for">
              <Prose>{team.description}</Prose>
            </Group>
            <Group label="Members" hint="one agent per seat">
              <Rows>
                {team.slots.map((slot) => (
                  <EventRow
                    key={slot.id}
                    lead={<SlotFace identityId={slot.identityId} size={28} />}
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
          </>
        ) : (
          team.templates.map((template) => (
            <TemplateGroup
              key={template.id}
              team={team}
              template={template}
              onLaunch={canLaunch ? () => onLaunch(template.id) : undefined}
            />
          ))
        )}
      </div>
    </ModalShell>
  );
}

function TemplateGroup({
  team,
  template,
  onLaunch,
}: {
  team: StagingAgentTeam;
  template: StagingTeamTemplate;
  onLaunch?: () => void;
}) {
  return (
    <section className="flex flex-col gap-2.5 rounded-xl border border-border-default p-3.5">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="text-small font-semibold text-text-primary">{template.title}</h3>
          <p className="text-caption text-text-muted">{template.description}</p>
        </div>
        {onLaunch && (
          <OpenScaleButton onClick={onLaunch} className="flex-none gap-1.5">
            <Play size={OPEN_SCALE_ICON} strokeWidth={2} aria-hidden="true" />
            Launch
          </OpenScaleButton>
        )}
      </div>
      <ol className="flex flex-col gap-3">
        {template.steps.map((step, i) => {
          const slot = team.slots.find((s) => s.id === step.slotId);
          return (
            <li key={step.slotId} className="flex gap-2.5">
              <span className="flex size-5 flex-none items-center justify-center rounded-full bg-bg-inset text-micro font-semibold tabular-nums text-text-secondary">
                {i + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate text-small font-medium text-text-primary">
                    {step.title}
                  </span>
                  {slot && (
                    <span className="flex flex-none items-center gap-1 text-caption text-text-muted">
                      <SlotFace identityId={slot.identityId} size={18} />
                      {slot.label}
                    </span>
                  )}
                </div>
                <Prose quoted>{step.instructions}</Prose>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
