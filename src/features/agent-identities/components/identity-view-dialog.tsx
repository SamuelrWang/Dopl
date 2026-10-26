"use client";

import { useState } from "react";
import { BookOpen, Pencil, UserRound, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { agentModelShortLabel } from "@/features/channels/lib/agent-models";
import type { ModelCatalogs } from "@/features/channels/lib/model-catalog";
import { ModalShell } from "@/shared/layout/settings-modal/modal-shell";
import type { AgentRunPresenter } from "@/shared/lib/agent-run-presenter";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { IdentityFace } from "@/shared/ui/identity-face";
import { OPEN_SCALE_ICON, OpenScaleButton } from "@/shared/ui/open-scale-button";
import { useRuntimeLogo } from "@/shared/ui/runtime-logo";
import { SegmentedControl, segmentedIds } from "@/shared/ui/segmented-control";
import { StatusPill } from "@/shared/ui/status-pill";
import type { AgentIdentity } from "../client/types";
import { agoLabel } from "../lib/identity-runs";
import { EMPTY_KNOWLEDGE, refKey, scopeChipLabel } from "../lib/knowledge-scopes";
import { FactChip, RuntimeMark } from "./identity-section";
import {
  Chips,
  Empty,
  EventRow,
  Fact,
  Facts,
  Group,
  GroupPair,
  Prose,
  Rows,
} from "./identity-view-parts";
import styles from "./identity-view.module.css";

type TabKey = "identity" | "activity" | "running";

const PANEL_IDS = "identity-view";

/**
 * THE IDENTITY VIEW: read-only, a fixed box whose body alone scrolls, one tab per question (what
 * it is, what it has done, where it is working now), and Edit one button away. Nothing here is a
 * control. The two agent tabs need this machine's session feed; with none they are not offered.
 */
export function IdentityViewDialog({
  identity,
  photo,
  runtimeLabel,
  marker,
  scopeLabel,
  wearers,
  catalogs,
  runs,
  agents,
  onClose,
  onEdit,
}: {
  identity: AgentIdentity;
  /** The owner's photo. */
  photo: string | null;
  runtimeLabel: string | null;
  /** The card's own authorship marker (INVARIANTS §5A), carried in unchanged. */
  marker: string | null;
  scopeLabel?: string | null;
  /** How many members can wear it, the viewer included (a shared row). */
  wearers: number;
  catalogs?: ModelCatalogs | null;
  /** The sessions credited to this identity (`lib/identity-runs.ts › joinRuns`); `null` = could not ask. */
  runs: ReadonlyArray<DesktopSessionSummary> | null;
  agents: AgentRunPresenter;
  onClose: () => void;
  onEdit: () => void;
}) {
  const [tab, setTab] = useState<TabKey>("identity");
  const logo = useRuntimeLogo()(identity.runtime);
  const live = (runs ?? []).filter((s) => s.state !== "ended");
  const ended = (runs ?? []).filter((s) => s.state === "ended");
  const ids = segmentedIds(PANEL_IDS, tab);

  return (
    <ModalShell open onClose={onClose} label={identity.name} size="panel">
      <div className={styles.head}>
        <IdentityFace size={44} photo={photo} runtimeLogo={logo} ring="neutral" />
        <div className={styles.headText}>
          <h2 className="min-w-0 truncate text-display font-semibold text-text-primary">
            {identity.name}
          </h2>
          <p className={cn(styles.headMeta, "text-caption text-text-muted")}>
            <UserRound size={12} strokeWidth={2} className="flex-none" aria-hidden="true" />
            <span className="truncate">{marker ?? "Yours"}</span>
            {wearers > 1 && <MetaPart>{`${wearers} people can wear this`}</MetaPart>}
            {scopeLabel && <MetaPart>{scopeLabel}</MetaPart>}
          </p>
        </div>
        <OpenScaleButton onClick={onEdit} className="flex-none gap-1.5">
          <Pencil size={OPEN_SCALE_ICON} strokeWidth={2} aria-hidden="true" />
          Edit
        </OpenScaleButton>
        <button type="button" onClick={onClose} className={styles.close} aria-label="Close identity">
          <X size={18} />
        </button>
      </div>

      {runs !== null && (
        <SegmentedControl
          variant="underline"
          options={[
            { key: "identity", label: "Identity" },
            { key: "activity", label: "Activity" },
            { key: "running", label: "Running", count: live.length || undefined },
          ]}
          value={tab}
          onChange={setTab}
          ariaLabel="Identity sections"
          panelIdPrefix={PANEL_IDS}
          className="flex-none border-b border-border-default px-5"
        />
      )}

      <div
        className={styles.body}
        {...(runs !== null ? { role: "tabpanel", id: ids.panel, "aria-labelledby": ids.tab } : {})}
      >
        {tab === "identity" && (
          <IdentityTab
            identity={identity}
            logo={logo}
            runtimeLabel={runtimeLabel}
            catalogs={catalogs}
          />
        )}
        {tab === "activity" && <ActivityTab ended={ended} agents={agents} />}
        {tab === "running" && <RunningTab live={live} agents={agents} />}
      </div>
    </ModalShell>
  );
}

function MetaPart({ children }: { children: string }) {
  return (
    <>
      <span className="text-text-disabled">·</span>
      <span className="truncate">{children}</span>
    </>
  );
}

function IdentityTab({
  identity,
  logo,
  runtimeLabel,
  catalogs,
}: {
  identity: AgentIdentity;
  logo: string | null;
  runtimeLabel: string | null;
  catalogs?: ModelCatalogs | null;
}) {
  const model = agentModelShortLabel(identity.model, catalogs);
  const description = identity.description?.trim();
  const instructions = identity.instructions?.trim();
  const knowledge = identity.knowledge ?? EMPTY_KNOWLEDGE;
  const unreachable = identity.unreachableKnowledgeBaseCount ?? 0;

  return (
    <>
      <Group label="What it is for">
        {description ? <Prose>{description}</Prose> : <Empty>No description yet.</Empty>}
      </Group>

      <Group label="How it works" hint="instructions">
        {instructions ? (
          <Prose quoted>{instructions}</Prose>
        ) : (
          <Empty>No instructions yet, so an agent launched from this runs on its own judgment.</Empty>
        )}
      </Group>

      <GroupPair>
        <Group label="Runs on">
          <Chips>
            <FactChip mark={<RuntimeMark logo={logo} />}>
              {runtimeLabel ?? "The channel's runtime"}
            </FactChip>
            {model && <FactChip>{model}</FactChip>}
          </Chips>
        </Group>
        <Group label="Knowledge" hint={unreachable > 0 ? `${unreachable} not reachable` : undefined}>
          {knowledge.length === 0 ? (
            <Empty>Nothing attached, so it starts every run with no context of yours.</Empty>
          ) : (
            <Chips>
              {knowledge.map((ref) => (
                <FactChip
                  key={refKey(ref)}
                  mark={<BookOpen size={12} strokeWidth={2} aria-hidden="true" />}
                >
                  {scopeChipLabel(ref)}
                </FactChip>
              ))}
            </Chips>
          )}
        </Group>
      </GroupPair>

      {identity.fields.length > 0 && (
        <Group label="Fields">
          <Facts>
            {identity.fields.map((field) => (
              <Fact key={field.key} label={field.key} value={field.value} />
            ))}
          </Facts>
        </Group>
      )}
    </>
  );
}

/** Where an agent was: its channel and thread, as one muted fact. */
function placeOf(session: DesktopSessionSummary): string | undefined {
  const parts = [session.channelName, session.threadTitle].filter(Boolean);
  return parts.length > 0 ? parts.join(" › ") : undefined;
}

interface AgentTabProps {
  agents: AgentRunPresenter;
}

function ActivityTab({ ended, agents }: AgentTabProps & { ended: ReadonlyArray<DesktopSessionSummary> }) {
  if (ended.length === 0) {
    return <Empty>Nothing finished yet. An agent shows up here once it ends.</Empty>;
  }
  return (
    <Group label="Recent" hint={`${ended.length} finished`}>
      <Rows>
        {ended.map((session) => (
          <EventRow
            key={session.sessionId}
            title={agents.name(session)}
            middle={placeOf(session)}
            trail={
              session.endedAt != null && (
                <span className="text-caption tabular-nums text-text-muted">
                  {agoLabel(session.endedAt)}
                </span>
              )
            }
          />
        ))}
      </Rows>
    </Group>
  );
}

function RunningTab({ live, agents }: AgentTabProps & { live: ReadonlyArray<DesktopSessionSummary> }) {
  if (live.length === 0) return <Empty>Not running anywhere right now.</Empty>;
  return (
    <Group label="Running now">
      <Rows>
        {live.map((session) => {
          const state = agents.state(session);
          return (
            <EventRow
              key={session.sessionId}
              title={agents.name(session)}
              middle={placeOf(session)}
              trail={
                <>
                  <StatusPill dot tone={state.live ? "live" : "neutral"}>
                    {state.label}
                  </StatusPill>
                  {session.startedAt != null && (
                    <span className="text-caption tabular-nums text-text-muted">
                      {agoLabel(session.startedAt)}
                    </span>
                  )}
                </>
              }
            />
          );
        })}
      </Rows>
    </Group>
  );
}

