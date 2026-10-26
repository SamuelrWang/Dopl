"use client";

/**
 * /ontology — the desktop /home Ontology face (the PRODUCT's `HomeOntologyPanels`) inside the
 * landing demo's window, over the in-memory staging server. Mounted by `src/app/ontology/page.tsx`.
 */

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HomeOntologyPanels } from "@/features/ontology/components/home-ontology-panels";
import { OntologyBoardSkeleton } from "@/features/ontology/components/ontology-skeleton";
import { StagingFrame } from "@/features/ui-staging/staging-frame";
import {
  STAGING_HOME_SEGMENT,
  STAGING_HOME_WORKSPACE_ID,
  STAGING_USER_ID,
} from "@/features/ui-staging/staging-stubs";
import { DEMO_HOME_CHANNELS } from "./data/demo-ontology-data";
import { StagingScenarioPanel } from "./staging-scenario-panel";
import { createStagingServer, type StagingScenario } from "./store/staging-server";

/**
 * Installs the staging server as `window.dopl` (the SPA bridge) for this mount and restores what
 * was there on unmount. Client-only: the desktop never server-renders, and the face's last-opened
 * memory reads `localStorage` during render.
 */
function useStagingBridge(scenario: StagingScenario): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const host = window as { dopl?: unknown };
    const previous = host.dopl;
    host.dopl = {
      ...createStagingServer(scenario),
      getAuthState: async () => ({ signedIn: true, userId: STAGING_USER_ID }),
      openExternal: async (url: string) => {
        window.open(url, "_blank", "noopener");
        return { ok: true };
      },
    };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot: children wait for the bridge
    setReady(true);
    return () => {
      host.dopl = previous;
    };
  }, [scenario]);
  return ready;
}

function Pane({ scenario }: { scenario: StagingScenario }) {
  const ready = useStagingBridge(scenario);
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
      })
  );
  if (!ready || scenario === "board-loading") {
    return (
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <OntologyBoardSkeleton />
      </div>
    );
  }
  return (
    <QueryClientProvider client={client}>
      <HomeOntologyPanels
        homeWorkspaceId={scenario === "not-onboarded" ? null : STAGING_HOME_WORKSPACE_ID}
        homeWorkspaceSegment={STAGING_HOME_SEGMENT}
        currentUserId={STAGING_USER_ID}
        homeChannels={DEMO_HOME_CHANNELS}
      />
    </QueryClientProvider>
  );
}

export function StagingOntologyPage() {
  const [scenario, setScenario] = useState<StagingScenario>("board");
  return (
    <>
      <StagingFrame tab="ontology" recordClassName="uis-white-pane">
        {/* A scenario is a fresh server and a fresh cache. */}
        <Pane key={scenario} scenario={scenario} />
      </StagingFrame>
      <StagingScenarioPanel scenario={scenario} onChange={setScenario} />
    </>
  );
}
