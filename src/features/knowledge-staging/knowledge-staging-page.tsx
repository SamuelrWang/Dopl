"use client";

/**
 * UI STAGING — desktop /home → Knowledge, on fake data, inside the landing demo's window.
 *
 * What mounts here is the PRODUCT face (`knowledge/components/home/home-knowledge-panels.tsx`,
 * which the desktop's `home-panes.tsx` mounts too) with the props `HomePane` hands it. Its requests
 * are answered in memory by `staging-bridge.ts` → `server/routes.ts`, installed client-side, so
 * the server renders the frame and the face's skeleton. A private QueryClient keeps the staged
 * cache off the app's own (persisted) one; a mount re-seeds from `data.ts`.
 */

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Role } from "@/features/workspaces/types";
import { StagingFrame } from "@/features/ui-staging/staging-frame";
import { HomeKnowledgePanels } from "@/features/knowledge/components/home/home-knowledge-panels";
import { HomeKnowledgePanelsSkeleton } from "@/features/knowledge/components/knowledge-skeletons";
import {
  STAGING_CHANNEL,
  STAGING_HOME_SEGMENT,
  STAGING_HOME_WORKSPACE_ID,
  STAGING_USER_ID,
} from "./data";
import { useStagingBridge } from "./staging-bridge";
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
  const ready = useStagingBridge();
  const [client] = useState(makeClient);
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
      <StagingFrame tab="knowledge" recordClassName="uis-white-pane">
        {ready ? (
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
        ) : (
          <HomeKnowledgePanelsSkeleton />
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
