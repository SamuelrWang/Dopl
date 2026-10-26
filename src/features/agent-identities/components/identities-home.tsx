"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Bot } from "lucide-react";
import type { AvatarStackUser } from "@/shared/ui/avatar-stack";
import { EmptyState } from "@/shared/ui/empty-state";
import { OpenScaleButton } from "@/shared/ui/open-scale-button";
import { CreateButton } from "@/shared/ui/page-action-button";
import type { AgentIdentity } from "../client/types";
import {
  DEFAULT_ARRANGEMENT,
  arrangeIdentities,
  endedRuns,
  lastUsedAt,
  liveRuns,
  runningCount,
  type IdentityArrangement,
  type RuntimeReadiness,
  type Sessions,
} from "../lib/identity-runs";
import { SECTIONS_CONTAINER, SECTION_PRIVATE_EVERYWHERE } from "../lib/visibility";
import { IdentityActivityPanel } from "./identity-activity-panel";
import { IdentityControls, IdentityPageHead } from "./identity-page-controls";
import { IdentityGrid, IdentityPanel, type IdentityCardHost } from "./identity-section";
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

export interface IdentitiesHomeProps {
  /** The selected channel's shared identities; `null` = no channel selected. */
  shared: {
    identities: ReadonlyArray<AgentIdentity>;
    markerFor: (identity: AgentIdentity) => string | null;
    /** Hidden, not disabled, below the write floor, so a guest never meets a dead control. */
    canCreate: boolean;
    /** Members of the channel, who can wear a shared identity. */
    wornBy: ReadonlyArray<AvatarStackUser>;
  } | null;
  personal: {
    identities: ReadonlyArray<AgentIdentity>;
    state: PersonalState;
    /** `false` = nowhere to write yet (not onboarded): the button disables. */
    canCreate: boolean;
    /** The card footer (knowledge, launch); absent with no channel to launch into. */
    cardActionFor?: (identity: AgentIdentity) => ReactNode;
  };
  card: Pick<IdentityCardHost, "photoFor" | "runtimeLabel" | "catalogs">;
  /** This machine's agents; `null` = could not ask (no state lines, no rail). */
  sessions: Sessions;
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
  const { shared, personal, card, sessions, currentUserId } = props;
  const [arrangement, setArrangement] = useState<IdentityArrangement>(DEFAULT_ARRANGEMENT);
  const [viewing, setViewing] = useState<{ where: IdentityHome; id: string } | null>(null);

  const sharedRows = useMemo(() => shared?.identities ?? [], [shared]);
  const everything = useMemo(
    () => [...sharedRows, ...personal.identities],
    [sharedRows, personal.identities]
  );
  const sharedShown = arrangeIdentities(sharedRows, arrangement, sessions);
  const personalShown = arrangeIdentities(personal.identities, arrangement, sessions);
  const sharedIds = useMemo(() => new Set(sharedRows.map((i) => i.id)), [sharedRows]);
  const whereOf = (identity: AgentIdentity): IdentityHome =>
    sharedIds.has(identity.id) ? "container" : "home";

  const statsFor = (wornBy: ReadonlyArray<AvatarStackUser>) =>
    sessions === null && wornBy.length === 0
      ? undefined
      : (identity: AgentIdentity) => ({
          running: runningCount(identity, sessions),
          lastUsed: lastUsedAt(identity, sessions),
          wornBy,
        });
  const open = (identity: AgentIdentity) => setViewing({ where: whereOf(identity), id: identity.id });
  // Read through the live list, so the view follows a save and closes on a delete.
  const viewed = viewing ? everything.find((i) => i.id === viewing.id) : undefined;

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
                emptyLine={SECTIONS_CONTAINER[0].emptyLine}
                onOpen={open}
                markerFor={shared.markerFor}
                scopeFor={sharedScope}
                statsFor={statsFor(shared.wornBy)}
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
                emptyLine={SECTION_PRIVATE_EVERYWHERE.emptyLine}
                onOpen={open}
                actionFor={personal.cardActionFor}
                statsFor={statsFor([])}
                {...card}
              />
            </PersonalBody>
          </IdentityPanel>
        </div>

        {sessions !== null && (
          <aside className="rail-layout-aside" aria-label="Activity">
            <IdentityActivityPanel
              active={liveRuns(everything, sessions)}
              recent={endedRuns(everything, sessions)}
              viewerPhoto={props.viewerPhoto}
              photoFor={(identity) => card.photoFor?.(identity) ?? null}
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
          wearers={viewing.where === "container" ? (shared?.wornBy.length ?? 0) : 0}
          catalogs={card.catalogs}
          sessions={sessions}
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
