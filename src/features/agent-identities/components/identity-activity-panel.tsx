"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { AgentRunPresenter } from "@/shared/lib/agent-run-presenter";
import { SegmentedControl, segmentedIds } from "@/shared/ui/segmented-control";
import { SelectMenu } from "@/shared/ui/select-menu";
import { StatusPill } from "@/shared/ui/status-pill";
import type { AgentIdentity } from "../client/types";
import { agoLabel, type IdentityRun } from "../lib/identity-runs";
import { IdentityPanel } from "./identity-section";

type Tab = "now" | "recent";

/** `"all"` · `"mine"` · a member's user id. */
type OwnerFilter = string;

const PANEL_IDS = "identity-activity";

/**
 * WHAT YOUR ROLES ARE DOING: the page's right rail. Active now is one small white card per live
 * agent (two lines: face, name, when it started; state, thread); Recent is rows, because a logged
 * event in a card face reads as one more agent. Every agent here is the operator's own (this
 * machine's feed), so every face is theirs. Each card and row opens its identity's view.
 */
export function IdentityActivityPanel({
  active,
  recent,
  agents,
  viewerPhoto,
  currentUserId,
  ownerName,
  onOpen,
}: {
  active: ReadonlyArray<IdentityRun>;
  recent: ReadonlyArray<IdentityRun>;
  agents: AgentRunPresenter;
  viewerPhoto: string | null;
  currentUserId: string;
  /** A member's display name, or `null` when the roster cannot name them. */
  ownerName: (userId: string) => string | null;
  onOpen: (identity: AgentIdentity) => void;
}) {
  const [tab, setTab] = useState<Tab>(active.length > 0 ? "now" : "recent");
  const [owner, setOwner] = useState<OwnerFilter>("all");

  const ownerOptions = useMemo(
    () =>
      ownerFilterOptions(
        [...active, ...recent].map((run) => run.identity),
        currentUserId,
        ownerName
      ),
    [active, recent, currentUserId, ownerName]
  );
  const shown = (tab === "now" ? active : recent).filter((run) =>
    ownedBy(run.identity, owner, currentUserId)
  );
  const all = tab === "now" ? active : recent;
  const ids = segmentedIds(PANEL_IDS, tab);

  return (
    <IdentityPanel
      id="home-agents-activity"
      label="Activity"
      flat
      action={
        ownerOptions.length > 1 ? (
          <SelectMenu
            variant="bare"
            value={owner}
            options={ownerOptions}
            onChange={setOwner}
            ariaLabel="Filter activity by whose identity it is"
          />
        ) : null
      }
    >
      <SegmentedControl
        options={[
          { key: "now", label: "Active now", count: active.length || undefined },
          { key: "recent", label: "Recent" },
        ]}
        value={tab}
        onChange={setTab}
        ariaLabel="Activity view"
        panelIdPrefix={PANEL_IDS}
        className="pb-2.5"
      />
      <div role="tabpanel" id={ids.panel} aria-labelledby={ids.tab}>
        {shown.length === 0 ? (
          <Quiet>
            {all.length > 0
              ? "Nothing matches this filter."
              : tab === "now"
                ? "No agents running from your identities right now."
                : "Nothing finished yet."}
          </Quiet>
        ) : tab === "now" ? (
          <div className="flex flex-col gap-2">
            {shown.map((run) => (
              <RunCard
                key={run.session.sessionId}
                run={run}
                agents={agents}
                photo={viewerPhoto}
                onOpen={onOpen}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {shown.map((run) => (
              <RecentRow
                key={run.session.sessionId}
                run={run}
                agents={agents}
                photo={viewerPhoto}
                onOpen={onOpen}
              />
            ))}
          </div>
        )}
      </div>
    </IdentityPanel>
  );
}

interface RunProps {
  run: IdentityRun;
  agents: AgentRunPresenter;
  photo: string | null;
  onOpen: (identity: AgentIdentity) => void;
}

/** The live state rides line 2: on line 1 a pill beside the name leaves the name no room. */
function RunCard({ run, agents, photo, onOpen }: RunProps) {
  const { session } = run;
  const name = agents.name(session);
  const state = agents.state(session);
  return (
    <button
      type="button"
      onClick={() => onOpen(run.identity)}
      className="white-card select-card flex w-full min-w-0 cursor-pointer flex-col gap-1.5 px-3 py-2.5 text-left"
    >
      <span className="flex w-full min-w-0 items-center gap-2">
        {agents.face(session, photo, 28)}
        <span className="min-w-0 flex-1 truncate text-small font-semibold text-text-primary" title={name}>
          {name}
        </span>
        {session.startedAt != null && (
          <span className="flex-none text-caption tabular-nums text-text-muted">
            {agoLabel(session.startedAt)}
          </span>
        )}
      </span>
      <span className="flex w-full min-w-0 items-center gap-1.5">
        <StatusPill dot tone={state.live ? "live" : "neutral"}>
          {state.label}
        </StatusPill>
        {session.threadTitle && (
          <span className="min-w-0 flex-1 truncate text-caption text-text-muted" title={session.threadTitle}>
            {session.threadTitle}
          </span>
        )}
      </span>
    </button>
  );
}

function RecentRow({ run, agents, photo, onOpen }: RunProps) {
  const { session, identity } = run;
  const what = session.threadTitle ?? session.channelName ?? agents.name(session);
  return (
    <button
      type="button"
      onClick={() => onOpen(identity)}
      className="flex w-full min-w-0 cursor-pointer items-start gap-2.5 rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-surface-raised-1"
    >
      {agents.face(session, photo, 22)}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2 text-small font-medium text-text-primary" title={what}>
          {what}
        </span>
        <span className="flex min-w-0 items-center gap-2 text-caption text-text-muted">
          <span className="min-w-0 flex-1 truncate" title={identity.name}>
            {identity.name}
          </span>
          {session.endedAt != null && (
            <span className="flex-none tabular-nums">{agoLabel(session.endedAt)}</span>
          )}
        </span>
      </span>
    </button>
  );
}

/**
 * Whose identities to show, built from the rows on screen so no option can empty the panel. An
 * author the roster cannot name offers no option, the same refusal `authorMarker` makes.
 */
function ownerFilterOptions(
  identities: ReadonlyArray<AgentIdentity>,
  currentUserId: string,
  ownerName: (userId: string) => string | null
): ReadonlyArray<{ value: string; label: string; description?: string }> {
  const owners = [...new Set(identities.map((i) => i.createdBy).filter((id): id is string => !!id))];
  const others = owners.flatMap((id) => {
    const label = id === currentUserId ? null : ownerName(id);
    return label
      ? [{ value: id, label, description: "Only activity from this member's identities" }]
      : [];
  });
  const mine = owners.includes(currentUserId)
    ? [{ value: "mine", label: "Just mine", description: "Only your own identities" }]
    : [];
  if (mine.length + others.length < 2) return [{ value: "all", label: "Everyone" }];
  return [{ value: "all", label: "Everyone", description: "Every identity's activity" }, ...mine, ...others];
}

function ownedBy(identity: AgentIdentity, filter: OwnerFilter, currentUserId: string): boolean {
  if (filter === "all") return true;
  return identity.createdBy === (filter === "mine" ? currentUserId : filter);
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="pb-1 text-caption text-text-muted">{children}</p>;
}
