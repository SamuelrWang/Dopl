/**
 * STAGING STAND-IN for the two reads the demo's channel face can reach but never fires on the
 * landing (the slot is inert there): the launch dialog's identity list
 * (`agent-identities/hooks/use-agent-identities.ts`) and the Threads tab's Artifacts face
 * (`channels/hooks/use-channel-artifacts.ts`: the list and each card's `?artifact=` run, from
 * `./staging-artifacts.ts`), plus the device-name lookups behind every "sent from" pill
 * (`devices/components/use-devices.ts › useDeviceName`, which the landing fires too). All are
 * seeded straight into the page's own QueryClient under the exact `[path, workspaceId, query]` keys
 * (`shared/hooks/use-api-query-core.ts › buildApiQueryOptions`) with `staleTime: Infinity`,
 * so the components render data and NOTHING FETCHES.
 */

import { QueryClient } from "@tanstack/react-query";
import type { AgentIdentity } from "@/features/agent-identities/types";
import { agentIdentitiesPath } from "@/features/agent-identities/client/query-keys";
import { channelArtifactsPath } from "@/features/channels/client/query-keys";
import { DEVICES_PATH } from "@/features/devices/types";
import { GLASSES_DEVICES } from "@/features/glasses/settings/glasses-api";
import { U, WORKSPACE_ID, minsAgo } from "./staging-builders";
import { stagingArtifacts, type SeededArtifact } from "./staging-artifacts";
import type { StagingRow } from "./staging-fixture-types";

function identity(id: string, name: string, description: string, runtime: string): AgentIdentity {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    name,
    description,
    instructions: null,
    model: null,
    runtime,
    fields: [],
    visibility: "workspace",
    teamIds: [],
    knowledgeBases: [],
    knowledge: [],
    unreachableKnowledgeBaseCount: 0,
    createdBy: U.samuel,
    createdAt: minsAgo(60 * 24 * 20),
    updatedAt: minsAgo(60 * 24 * 2),
  };
}

export const STAGING_IDENTITIES: AgentIdentity[] = [
  identity("stg-id-planner", "Cleanup Planner", "Splits a cleanup into work and briefs it out", "claude"),
  identity("stg-id-coder", "Coder", "Writes and tests one change at a time", "claude"),
  identity("stg-id-reviewer", "Reviewer", "Reads a diff for correctness before it lands", "codex"),
  identity("stg-id-researcher", "Researcher", "Reads the knowledge base and the backlog first", "claude"),
];

/** A fresh client per page mount, pre-seeded; nothing it holds ever goes stale. */
export function stagingQueryClient(rows: readonly StagingRow[]): QueryClient {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        gcTime: Infinity,
        retry: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: { retry: false },
    },
  });
  qc.setQueryData([agentIdentitiesPath(), WORKSPACE_ID, undefined], {
    identities: STAGING_IDENTITIES,
  });
  // Empty lists: the pill falls back to the label stamped on the message, as it does offline.
  qc.setQueryData([DEVICES_PATH, undefined, undefined], { devices: [] });
  qc.setQueryData([GLASSES_DEVICES.path, undefined, undefined], { devices: [] });
  for (const row of rows) {
    if (row.kind === "channel") seedChannel(qc, row.channel.id, stagingArtifacts(row));
  }
  return qc;
}

/** Seed one channel's Artifacts read (also called, empty, for channels created on the page). */
export function seedChannel(
  qc: QueryClient,
  channelId: string,
  artifacts: readonly SeededArtifact[] = []
): void {
  const path = channelArtifactsPath(channelId);
  qc.setQueryData([path, WORKSPACE_ID, undefined], {
    artifacts: artifacts.map((a) => a.folded),
    truncated: false,
  });
  for (const { folded, messages } of artifacts) {
    qc.setQueryData([path, WORKSPACE_ID, { artifact: folded.artifact.id }], {
      messages,
      truncated: false,
    });
  }
}
