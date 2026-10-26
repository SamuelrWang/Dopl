"use client";

/**
 * UI STAGING: desktop /home → Identities on fake data, inside the landing demo's window. The face
 * is the product's own (`home/identities-scene.tsx` is the stub host); the store reseeds on mount.
 *
 * ⚠ CLIENT-ONLY CONTENT: the agents' times are relative to `Date.now()`, so a server pass would
 * print different labels than the client. The server paints the empty window; the face mounts
 * after hydration.
 */

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Role } from "@/features/workspaces/types";
import { StagingFrame } from "@/features/ui-staging/staging-frame";
import { StagingScenarioSwitch } from "@/features/ui-staging/staging-scenario-switch";
import { IdentitiesScene, type ReadinessScenario } from "./home/identities-scene";
import {
  CONTAINER_WORKSPACE_ID,
  KNOWLEDGE_BASES,
  KNOWLEDGE_ENTRIES,
  KNOWLEDGE_FOLDERS,
  STAGING_CHANNEL,
  STAGING_HOME_WORKSPACE_ID,
  STAGING_USER_ID,
} from "./data";
import { resetIdentityStore, setHomeReadFails, useIdentityState } from "./store/identity-store";

type ChannelChoice = "tech-debt" | "none";
type RoleChoice = "owner" | "member" | "guest";
type HomeChoice = "ready" | "unset" | "fails";

/** The knowledge picker's per-base tree read (`knowledge/client/hooks.ts › useKnowledgeTree`),
 *  seeded under its own key in both workspaces, so the product picker renders and nothing fetches. */
function stagingQueryClient(): QueryClient {
  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false } },
  });
  for (const ws of [STAGING_HOME_WORKSPACE_ID, CONTAINER_WORKSPACE_ID]) {
    for (const base of KNOWLEDGE_BASES) {
      qc.setQueryData(["knowledge", `tree:${ws}:${base.id}`], {
        base,
        folders: KNOWLEDGE_FOLDERS.filter((f) => f.knowledgeBaseId === base.id),
        entries: KNOWLEDGE_ENTRIES.filter((e) => e.knowledgeBaseId === base.id),
      });
    }
  }
  return qc;
}

export function IdentitiesStagingPage() {
  const [qc] = useState(stagingQueryClient);
  // Seed the store once per mount (a reload is a clean slate).
  useState(() => {
    resetIdentityStore();
    return true;
  });
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount flag
  useEffect(() => setMounted(true), []);
  const { homeReadFails } = useIdentityState();
  const [channelChoice, setChannelChoice] = useState<ChannelChoice>("tech-debt");
  const [role, setRole] = useState<RoleChoice>("owner");
  const [homeSetUp, setHomeSetUp] = useState(true);
  const [readiness, setReadiness] = useState<ReadinessScenario>("ready");
  const home: HomeChoice = !homeSetUp ? "unset" : homeReadFails ? "fails" : "ready";

  const channel =
    channelChoice === "none" ? null : { ...STAGING_CHANNEL, myWorkspaceRole: role as Role };

  return (
    <QueryClientProvider client={qc}>
      <StagingFrame tab="identities" recordClassName="uis-white-pane">
        {mounted && (
          <IdentitiesScene
            // The desktop keys this face by its pane token, so a channel switch remounts it.
            key={`${channelChoice}:${role}:${homeSetUp}`}
            channel={channel}
            homeWorkspaceId={homeSetUp ? STAGING_HOME_WORKSPACE_ID : null}
            currentUserId={STAGING_USER_ID}
            readiness={readiness}
          />
        )}
      </StagingFrame>
      <StagingScenarioSwitch
        groups={[
          {
            key: "channel",
            label: "Selected channel",
            value: channelChoice,
            options: [
              { value: "tech-debt", label: "#tech-debt" },
              { value: "none", label: "None" },
            ],
            onChange: setChannelChoice,
          },
          {
            key: "role",
            label: "Your role in the channel",
            value: role,
            options: [
              { value: "owner", label: "Owner" },
              { value: "member", label: "Member" },
              { value: "guest", label: "Guest" },
            ],
            onChange: setRole,
          },
          {
            key: "runtimes",
            label: "Runtimes",
            value: readiness,
            options: [
              { value: "ready", label: "All ready" },
              { value: "signin", label: "Not signed in" },
            ],
            onChange: setReadiness,
          },
          {
            key: "home",
            label: "Home space",
            value: home,
            options: [
              { value: "ready", label: "Set up" },
              { value: "unset", label: "Not set up" },
              { value: "fails", label: "Read fails" },
            ],
            onChange: (next: HomeChoice) => {
              setHomeSetUp(next !== "unset");
              setHomeReadFails(next === "fails");
            },
          },
        ]}
      />
    </QueryClientProvider>
  );
}
