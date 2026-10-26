"use client";

/**
 * UI STAGING — desktop /home → Knowledge, on fake data, inside the landing demo's window.
 *
 * What mounts here is the desktop's own face (`home/knowledge-panels.tsx`, a copy of
 * `apps/desktop-ui/src/pages/home/knowledge-panels.tsx`) with the props `home-panes.tsx ›
 * HomePane` hands it. Everything under it is a staged copy whose data layer is the in-memory
 * store (`fake-store.ts`). A private QueryClient keeps the staged cache off the app's own
 * (persisted) one; a reload re-seeds from `data.ts`.
 */

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Role } from "@/features/workspaces/types";
import { StagingFrame } from "@/features/ui-staging/staging-frame";
import { HomeKnowledgePanels } from "./home/knowledge-panels";
import {
  STAGING_CHANNEL,
  STAGING_HOME_SEGMENT,
  STAGING_HOME_WORKSPACE_ID,
  STAGING_USER_ID,
} from "./data";
import { resetKnowledgeStore } from "./fake-store";
import { StagingScenarioSwitch } from "@/features/ui-staging/staging-scenario-switch";

type ChannelChoice = "tech-debt" | "none";
type RoleChoice = "owner" | "member" | "guest";
type HomeChoice = "ready" | "unset";

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

export function KnowledgeStagingPage() {
  // Seed the in-memory DB and the cache once per mount (a reload is a clean slate).
  const [client] = useState(() => {
    resetKnowledgeStore();
    return makeClient();
  });
  const [channelChoice, setChannelChoice] = useState<ChannelChoice>("tech-debt");
  const [role, setRole] = useState<RoleChoice>("owner");
  const [home, setHome] = useState<HomeChoice>("ready");

  const channel =
    channelChoice === "none"
      ? null
      : { ...STAGING_CHANNEL, myWorkspaceRole: role as Role };
  const homeReady = home === "ready";

  return (
    <QueryClientProvider client={client}>
      <StagingFrame tab="knowledge">
        <HomeKnowledgePanels
          // `home-panes.tsx` keys this face by the selected row; the staging states join the key
          // so a flip starts the face fresh, as a channel switch does on desktop.
          key={`${channelChoice}:${role}:${home}`}
          channel={channel}
          homeWorkspaceId={homeReady ? STAGING_HOME_WORKSPACE_ID : null}
          homeWorkspaceSegment={homeReady ? STAGING_HOME_SEGMENT : null}
          homeRole={homeReady ? "owner" : null}
          currentUserId={STAGING_USER_ID}
        />
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
            key: "home",
            label: "Home space",
            value: home,
            options: [
              { value: "ready", label: "Set up" },
              { value: "unset", label: "Not set up" },
            ],
            onChange: setHome,
          },
        ]}
      />
    </QueryClientProvider>
  );
}
