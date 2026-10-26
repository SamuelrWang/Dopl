"use client";

/**
 * UI STAGING — desktop /home → Identities, on fake data, inside the landing demo's window.
 *
 * What mounts here is the desktop's own face (`home/identity-panels.tsx`, a copy of
 * `apps/desktop-ui/src/pages/home/identity-panels.tsx`) with the props `home-panes.tsx ›
 * HomePane` hands it. The hooks under it read the in-memory store (`identity-store.ts`); a
 * reload re-seeds from `data.ts`.
 */

import { useState } from "react";
import type { Role } from "@/features/workspaces/types";
import { StagingFrame } from "@/features/ui-staging/staging-frame";
import { StagingScenarioSwitch } from "@/features/ui-staging/staging-scenario-switch";
import { HomeIdentityPanels } from "./home/identity-panels";
import { STAGING_CHANNEL, STAGING_HOME_WORKSPACE_ID, STAGING_USER_ID } from "./data";
import { resetIdentityStore, setHomeReadFails, useIdentityState } from "./identity-store";

type ChannelChoice = "tech-debt" | "none";
type RoleChoice = "owner" | "member" | "guest";
type HomeChoice = "ready" | "unset" | "fails";
/** Item 3c: the three runtime worlds Samuel asked to see (all ready / re-auth / not signed in). */
type ReadinessChoice = "ready" | "reauth" | "signin";

export function IdentitiesStagingPage() {
  // Seed the store once per mount (a reload is a clean slate).
  useState(() => {
    resetIdentityStore();
    return true;
  });
  const { homeReadFails } = useIdentityState();
  const [channelChoice, setChannelChoice] = useState<ChannelChoice>("tech-debt");
  const [role, setRole] = useState<RoleChoice>("owner");
  const [homeSetUp, setHomeSetUp] = useState(true);
  const [readiness, setReadiness] = useState<ReadinessChoice>("ready");
  const home: HomeChoice = !homeSetUp ? "unset" : homeReadFails ? "fails" : "ready";

  const channel =
    channelChoice === "none"
      ? null
      : { ...STAGING_CHANNEL, myWorkspaceRole: role as Role };

  return (
    <>
      <StagingFrame tab="identities">
        <HomeIdentityPanels
          // `home-panes.tsx` keys this face by its pane token, so a channel switch remounts it.
          key={`${channelChoice}:${role}:${homeSetUp}`}
          channel={channel}
          homeWorkspaceId={homeSetUp ? STAGING_HOME_WORKSPACE_ID : null}
          currentUserId={STAGING_USER_ID}
          readiness={readiness}
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
            key: "runtimes",
            label: "Runtimes",
            value: readiness,
            options: [
              { value: "ready", label: "All ready" },
              { value: "reauth", label: "Needs re-auth" },
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
    </>
  );
}
