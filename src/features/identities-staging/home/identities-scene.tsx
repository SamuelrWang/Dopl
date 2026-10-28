"use client";

/**
 * STUB HOST for /playground/identities. It mounts the PRODUCT face
 * (`agent-identities/components/identities-home.tsx`) and the product editor and knowledge dialog
 * over the staging data layer, in place of `apps/desktop-ui/src/pages/home/identity-panels.tsx`,
 * which wires the same props from the real reads, writes and the Electron bridge.
 */

import { useState } from "react";
import type { AgentIdentity } from "@/features/agent-identities/client/types";
import { authorMarker } from "@/features/agent-identities/components/identity-picker";
import {
  IdentitiesHome,
  personalState,
  type IdentityHome,
} from "@/features/agent-identities/components/identities-home";
import { AGENT_RUN_PRESENTER } from "@/features/channels/components/agent-run-presenter";
import { IdentityEditor } from "@/features/agent-identities/components/identity-editor";
import { IdentityKnowledgeDialog } from "@/features/agent-identities/components/identity-knowledge-dialog";
import { draftFromIdentity } from "@/features/agent-identities/lib/identity-draft";
import {
  SECTIONS,
  SECTIONS_CONTAINER,
  groupByVisibility,
} from "@/features/agent-identities/lib/visibility";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { toast } from "@/shared/ui/toast";
import { IdentitiesPreviewSchema } from "@/features/home/preview-types";
import { meetsMinRole } from "@/features/workspaces/types";
import PREVIEW_SEED from "../identities-preview-seed.json";
import {
  REFUSED_LAUNCH,
  STAGING_CATALOGS,
  STAGING_RUNTIMES,
  type StagingChannel,
} from "../data";
import { STAGING_PEERS, nameOf, photoOf, stagingSessions } from "../data-agents";
import { latency } from "../store/identity-store";
import { useStagingAttachableBases } from "../store/use-staging-attachable-bases";
import { useStagingIdentities } from "../store/use-staging-identities";
import { useStagingIdentitySave } from "../store/use-staging-identity-save";
import { TeamsHome } from "../teams/teams-home";


const runtimeLabel = (id: string) => STAGING_RUNTIMES.find((r) => r.id === id)?.label ?? id;
const names = new Map(STAGING_PEERS.map((p) => [p.userId, p.displayName]));
/** The `account_preview_data` payload an account gets, parsed as `GET /api/home/preview` does. */
const PREVIEW = IdentitiesPreviewSchema.parse(PREVIEW_SEED);

export function IdentitiesScene({
  channel,
  homeWorkspaceId,
  currentUserId,
}: {
  channel: StagingChannel | null;
  homeWorkspaceId: string | null;
  currentUserId: string;
}) {
  const [editing, setEditing] = useState<{ where: IdentityHome; identity: AgentIdentity | null } | null>(null);
  const [attaching, setAttaching] = useState<AgentIdentity | null>(null);
  const [launching, setLaunching] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ identityId: string; message: string } | null>(null);
  const [sessions] = useState(() => stagingSessions(Date.now()));
  const [view, setView] = useState<"identities" | "teams">("identities");

  const containerList = useStagingIdentities(channel?.workspaceId ?? null);
  const homeList = useStagingIdentities(homeWorkspaceId);
  const shared = groupByVisibility(containerList.identities).workspace;
  const personal = groupByVisibility(homeList.identities).private.filter(
    (i) => i.createdBy === currentUserId
  );

  // N1 (Samuel, 2026-10-28): a track switch leading the page's own control row, not a tab bar.
  const switcher = (
    <SegmentedControl
      variant="track"
      options={[
        { key: "identities", label: "Identities" },
        { key: "teams", label: "Agent teams" },
      ]}
      value={view}
      onChange={setView}
      ariaLabel="Identities or agent teams"
      className="flex-none"
    />
  );

  async function launch(identity: AgentIdentity) {
    setLaunching(identity.id);
    setRefusal(null);
    await latency(900);
    setLaunching(null);
    const message = REFUSED_LAUNCH[identity.id];
    if (message) return setRefusal({ identityId: identity.id, message });
    toast({ title: `"${identity.name}" launched into "${channel?.name}"`, variant: "invert" });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {view === "teams" ? (
        <TeamsHome
          channelName={channel?.name ?? null}
          currentUserId={currentUserId}
          viewerPhoto={photoOf(currentUserId)}
          switcher={switcher}
        />
      ) : (
        <IdentitiesHome
          shared={
            channel && {
              channelName: channel.name,
              identities: shared,
              markerFor: (identity) => authorMarker(identity, currentUserId, names),
              canCreate: meetsMinRole(channel.myWorkspaceRole, "member"),
              peers: STAGING_PEERS,
            }
          }
          personal={{
            identities: personal,
            state: personalState(homeWorkspaceId, homeList),
            canCreate: homeWorkspaceId !== null,
            footer: channel
              ? {
                  launch: {
                    canLaunch: true,
                    busyId: launching,
                    error: refusal,
                    launch: (identity) => void launch(identity),
                  },
                  onAddKnowledge: setAttaching,
                }
              : undefined,
          }}
          card={{ photoFor: (i) => photoOf(i.createdBy), runtimeLabel, catalogs: STAGING_CATALOGS }}
          sessions={sessions}
          preview={PREVIEW}
          agents={AGENT_RUN_PRESENTER}
          runtimes={STAGING_RUNTIMES}
          currentUserId={currentUserId}
          viewerPhoto={photoOf(currentUserId)}
          ownerName={nameOf}
          onCreate={(where) => setEditing({ where, identity: null })}
          onEdit={(where, identity) => setEditing({ where, identity })}
          switcher={switcher}
        />
      )}

      {editing && (
        <StagingEditor
          workspaceId={editing.where === "container" ? channel?.workspaceId : homeWorkspaceId}
          where={editing.where}
          identity={editing.identity}
          onClose={() => setEditing(null)}
        />
      )}
      {attaching && homeWorkspaceId && (
        <StagingKnowledgeDialog
          identity={attaching}
          workspaceId={homeWorkspaceId}
          onClose={() => setAttaching(null)}
        />
      )}
    </div>
  );
}

function StagingEditor({
  workspaceId,
  where,
  identity,
  onClose,
}: {
  workspaceId: string | null | undefined;
  where: IdentityHome;
  identity: AgentIdentity | null;
  onClose: () => void;
}) {
  const ws = workspaceId ?? "";
  const attachable = useStagingAttachableBases(ws);
  const { save, remove, error, saving, deleting } = useStagingIdentitySave({ workspaceId: ws, onDone: onClose });
  if (!workspaceId) return null;
  const container = where === "container";
  return (
    <IdentityEditor
      open
      workspaceId={ws}
      session={1}
      identity={identity}
      teams={[]}
      sections={container ? SECTIONS_CONTAINER : SECTIONS}
      containerKind={container ? "link" : "home"}
      defaultVisibility={container ? "workspace" : undefined}
      knowledgeBases={attachable.bases}
      knowledgeState={attachable.state}
      onKnowledgeRetry={attachable.retry}
      saving={saving}
      deleting={deleting}
      error={error}
      onClose={onClose}
      onSave={(draft) => void save(draft, identity)}
      onDelete={() => void remove(identity)}
    />
  );
}

function StagingKnowledgeDialog({
  identity,
  workspaceId,
  onClose,
}: {
  identity: AgentIdentity;
  workspaceId: string;
  onClose: () => void;
}) {
  const attachable = useStagingAttachableBases(workspaceId);
  const { save, error, saving } = useStagingIdentitySave({ workspaceId, onDone: onClose });
  return (
    <IdentityKnowledgeDialog
      identity={identity}
      workspaceId={workspaceId}
      attachable={attachable}
      saving={saving}
      error={error}
      onSave={(refs) => void save({ ...draftFromIdentity(identity), knowledge: refs }, identity)}
      onClose={onClose}
    />
  );
}
