"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Bot } from "lucide-react";
import type { AgentRunPresenter } from "@/shared/lib/agent-run-presenter";
import type { AvatarStackUser } from "@/shared/ui/avatar-stack";
import { EmptyState } from "@/shared/ui/empty-state";
import { OpenScaleButton } from "@/shared/ui/open-scale-button";
import { CreateButton } from "@/shared/ui/pill-button";
import { agentIdentityErrorMessage } from "../client/api";
import type { AgentIdentity } from "../client/types";
import type { UseAgentIdentitiesResult } from "../hooks/use-agent-identities";
import {
  DEFAULT_ARRANGEMENT,
  arrangeIdentities,
  endedRuns,
  joinRuns,
  liveRuns,
  usageFor,
  usageOf,
  type IdentityArrangement,
  type IdentityUse,
  type RuntimeReadiness,
  type Sessions,
} from "../lib/identity-runs";
import { SECTIONS_CONTAINER, SECTION_PRIVATE_EVERYWHERE } from "../lib/visibility";
import { IdentityActivityPanel } from "./identity-activity-panel";
import { PersonalCardFooter, type CardLaunch } from "./identity-card-actions";
import { IdentityControls, IdentityPageHead } from "./identity-page-controls";
import {
  IDENTITY_GRID_RAIL,
  IdentityGrid,
  IdentityPanel,
  type IdentityCardHost,
} from "./identity-section";
import { IdentityViewDialog } from "./identity-view-dialog";

/** Which workspace a row lives in, so Edit opens the editor that writes there. */
export type IdentityHome = "container" | "home";

/** The Personal section's body state. Failure outranks pending: a failed read never resolves (F-339). */
export type PersonalState =
  | { kind: "ready" }
  | { kind: "pending" }
  /** No home workspace yet: a sentence, not an empty list. */
  | { kind: "unavailable"; message: string }
  | { kind: "failed"; message: string; onRetry: () => void };

/** The Personal read's state, for either host. */
export function personalState(
  homeWorkspaceId: string | null,
  list: Pick<UseAgentIdentitiesResult, "error" | "resolved" | "refetch">
): PersonalState {
  if (homeWorkspaceId === null) {
    return {
      kind: "unavailable",
      message: "Finish setting up your home space to keep identities there.",
    };
  }
  if (list.error != null) {
    return {
      kind: "failed",
      message: agentIdentityErrorMessage(list.error, "Couldn't load your own identities."),
      onRetry: () => list.refetch(),
    };
  }
  return list.resolved ? { kind: "ready" } : { kind: "pending" };
}

/** When search or a filter hides every row of a section that has some. */
const NO_MATCHES = "No matches.";

export interface IdentitiesHomeProps {
  /** The selected channel's shared identities; `null` = no channel selected. */
  shared: {
    identities: ReadonlyArray<AgentIdentity>;
    markerFor: (identity: AgentIdentity) => string | null;
    /** Hidden, not disabled, below the write floor, so a guest never meets a dead control. */
    canCreate: boolean;
    /** The channel's OTHER members; with the viewer, everyone who can wear a shared row. */
    peers: ReadonlyArray<AvatarStackUser>;
  } | null;
  personal: {
    identities: ReadonlyArray<AgentIdentity>;
    state: PersonalState;
    /** `false` = nowhere to write yet (not onboarded): the button disables. */
    canCreate: boolean;
    /** The card footer; absent with no channel to launch into. */
    footer?: { launch: CardLaunch; onAddKnowledge: (identity: AgentIdentity) => void };
  };
  card: Pick<IdentityCardHost, "photoFor" | "runtimeLabel" | "catalogs">;
  /** This machine's agents; `null` = could not ask (no state lines, no rail). */
  sessions: Sessions;
  agents: AgentRunPresenter;
  readiness: ReadonlyArray<RuntimeReadiness> | null;
  /** The runtimes the filter offers. */
  runtimes: ReadonlyArray<{ id: string; label: string }>;
  currentUserId: string;
  viewerPhoto: string | null;
  ownerName: (userId: string) => string | null;
  onCreate: (where: IdentityHome) => void;
  onEdit: (where: IdentityHome, identity: AgentIdentity) => void;
}

/**
 * /home → Identities: the identities 3/4 left (head, controls, Shared, Personal), Activity 1/4
 * right. A card click opens the read-only view; its Edit hands the row to the host's editor in
 * the workspace the row lives in. Create opens the editor directly.
 */
export function IdentitiesHome(props: IdentitiesHomeProps) {
  const { shared, personal, card, sessions, agents, currentUserId } = props;
  const [arrangement, setArrangement] = useState<IdentityArrangement>(DEFAULT_ARRANGEMENT);
  const [viewing, setViewing] = useState<{ where: IdentityHome; id: string } | null>(null);

  const sharedRows = useMemo(() => shared?.identities ?? [], [shared]);
  const everything = useMemo(
    () => [...sharedRows, ...personal.identities],
    [sharedRows, personal.identities]
  );
  const runs = useMemo(() => joinRuns(everything, sessions), [everything, sessions]);
  const use = useMemo(() => usageOf(runs), [runs]);
  const order = useStableOrder(everything, arrangement, sessions === null, use);

  const sharedShown = arrangeIdentities(sharedRows, arrangement, order);
  const personalShown = arrangeIdentities(personal.identities, arrangement, order);
  const wornBy = shared?.peers ?? [];
  const whereOf = (identity: AgentIdentity): IdentityHome =>
    sharedRows.some((i) => i.id === identity.id) ? "container" : "home";

  const statsFor = (peers: ReadonlyArray<AvatarStackUser>) =>
    sessions === null && peers.length === 0
      ? undefined
      : (identity: AgentIdentity) => ({ ...usageFor(use, identity), wornBy: peers });
  const emptyLine = (rows: ReadonlyArray<AgentIdentity>, line: string | undefined) =>
    rows.length > 0 ? NO_MATCHES : line;
  const open = (identity: AgentIdentity) => setViewing({ where: whereOf(identity), id: identity.id });
  // Read through the live list, so the view follows a save and closes on a delete.
  const viewed = viewing ? everything.find((i) => i.id === viewing.id) : undefined;
  const footer = personal.footer;

  return (
    <div className="rail-layout">
      <div className="rail-layout-cols">
        <div className="rail-layout-main">
          <div className="flex flex-col gap-3">
            <IdentityPageHead
              sharedCount={shared ? sharedShown.length : null}
              personalCount={personalShown.length}
              readiness={props.readiness}
            />
            <IdentityControls
              arrangement={arrangement}
              onArrangement={setArrangement}
              runtimes={props.runtimes}
              showing={sharedShown.length + personalShown.length}
              total={everything.length}
            />
          </div>

          {shared === null ? (
            <EmptyState icon={Bot} title="No channel selected" />
          ) : (
            <IdentityPanel
              id="home-agents-shared"
              label={SECTIONS_CONTAINER[0].label}
              flat
              action={
                shared.canCreate ? (
                  <CreateButton onClick={() => props.onCreate("container")}>
                    Agent Identity
                  </CreateButton>
                ) : null
              }
            >
              <IdentityGrid
                identities={sharedShown}
                emptyLine={emptyLine(sharedRows, SECTIONS_CONTAINER[0].emptyLine)}
                grid={IDENTITY_GRID_RAIL}
                onOpen={open}
                markerFor={shared.markerFor}
                scopeFor={sharedScope}
                statsFor={statsFor(wornBy)}
                {...card}
              />
            </IdentityPanel>
          )}

          <IdentityPanel
            id="home-agents-private"
            label={SECTION_PRIVATE_EVERYWHERE.label}
            flat
            action={
              <CreateButton disabled={!personal.canCreate} onClick={() => props.onCreate("home")}>
                Agent Identity
              </CreateButton>
            }
          >
            <PersonalBody state={personal.state}>
              <IdentityGrid
                identities={personalShown}
                emptyLine={emptyLine(personal.identities, SECTION_PRIVATE_EVERYWHERE.emptyLine)}
                grid={IDENTITY_GRID_RAIL}
                onOpen={open}
                actionFor={
                  footer &&
                  ((identity) => (
                    <PersonalCardFooter
                      identity={identity}
                      launch={footer.launch}
                      onAddKnowledge={() => footer.onAddKnowledge(identity)}
                    />
                  ))
                }
                statsFor={statsFor([])}
                {...card}
              />
            </PersonalBody>
          </IdentityPanel>
        </div>

        {sessions !== null && (
          <aside className="rail-layout-aside" aria-label="Activity">
            <IdentityActivityPanel
              active={liveRuns(runs)}
              recent={endedRuns(runs)}
              agents={agents}
              viewerPhoto={props.viewerPhoto}
              currentUserId={currentUserId}
              ownerName={props.ownerName}
              onOpen={open}
            />
          </aside>
        )}
      </div>

      {viewing && viewed && (
        <IdentityViewDialog
          identity={viewed}
          photo={card.photoFor?.(viewed) ?? null}
          runtimeLabel={viewed.runtime ? (card.runtimeLabel?.(viewed.runtime) ?? viewed.runtime) : null}
          marker={viewing.where === "container" ? (shared?.markerFor(viewed) ?? null) : null}
          scopeLabel={viewing.where === "container" ? SECTIONS_CONTAINER[0].label : null}
          // The peers plus the viewer.
          wearers={viewing.where === "container" ? wornBy.length + 1 : 0}
          catalogs={card.catalogs}
          runs={
            sessions === null
              ? null
              : runs.filter((r) => r.identity.id === viewed.id).map((r) => r.session)
          }
          agents={agents}
          onClose={() => setViewing(null)}
          onEdit={() => {
            setViewing(null);
            props.onEdit(viewing.where, viewed);
          }}
        />
      )}
    </div>
  );
}

const sharedScope = () => SECTIONS_CONTAINER[0].label;

/**
 * The usage the SORT reads, frozen until the rows, the arrangement or the feed's availability
 * change, so cards do not reshuffle each time a session push lands; the cards' own state lines
 * read the live usage.
 */
function useStableOrder(
  identities: ReadonlyArray<AgentIdentity>,
  arrangement: IdentityArrangement,
  unknown: boolean,
  use: ReadonlyMap<string, IdentityUse>
): ReadonlyMap<string, IdentityUse> {
  const key = [
    arrangement.sort,
    arrangement.query,
    arrangement.runtime,
    unknown,
    identities.map((i) => i.id).join(","),
  ].join("|");
  const [frozen, setFrozen] = useState({ key, use });
  if (frozen.key !== key) setFrozen({ key, use });
  return frozen.key === key ? frozen.use : use;
}

function PersonalBody({ state, children }: { state: PersonalState; children: ReactNode }) {
  if (state.kind === "unavailable") {
    return <p className="pb-1 text-caption text-text-muted">{state.message}</p>;
  }
  if (state.kind === "failed") {
    // Not a page error: the shared section loaded fine.
    return (
      <div className="flex flex-wrap items-center gap-2 pb-1">
        <p className="text-caption text-text-muted">{state.message}</p>
        <OpenScaleButton onClick={state.onRetry}>Try again</OpenScaleButton>
      </div>
    );
  }
  if (state.kind === "pending") return <div className="h-10" />;
  return <>{children}</>;
}
