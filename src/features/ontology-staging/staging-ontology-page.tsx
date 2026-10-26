"use client";

/**
 * /ontology — the desktop /home ONTOLOGY face inside the landing demo's window,
 * on fake in-memory data. Mounted by `src/app/ontology/page.tsx`.
 */

import { useEffect, useState } from "react";
import { StagingFrame } from "@/features/ui-staging/staging-frame";
// ⚠ THE ROWS DISPLAY'S FACE, scoped `.uis-window .uis-ont-*` (Samuel, ask 5b).
// Lives here rather than in `ui-staging/staging.css` so this round touches no
// file the other overhaul workers are in; same selector convention and the same
// "port target if approved" house style as that sheet's `.uis-dev-card`.
import "./ontology-rows.css";
import {
  STAGING_HOME_SEGMENT,
  STAGING_HOME_WORKSPACE_ID,
  STAGING_USER_ID,
} from "@/features/ui-staging/staging-stubs";
import { HomePane } from "./home/home-panes";
import { OntologyBoardSkeleton } from "./ontology/components/ontology-skeleton";
import { StagingScenarioPanel } from "./staging-scenario-panel";
import {
  StagingOntologyProvider,
  useStagingOntologyStore,
} from "./store/staging-ontology-store";

/**
 * ⚠ CLIENT-ONLY PANE: the desktop never server-renders, and its "last opened"
 * memory reads `localStorage` during render, so a server pass would hydrate
 * against a different selection. The server paints the board's own skeleton.
 */
function Pane() {
  const { scenario } = useStagingOntologyStore();
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount flag
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return (
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <OntologyBoardSkeleton />
      </div>
    );
  }
  return (
    <HomePane
      identity={{
        workspace: scenario === "not-onboarded" ? null : { id: STAGING_HOME_WORKSPACE_ID },
        segment: STAGING_HOME_SEGMENT,
        userId: STAGING_USER_ID,
      }}
    />
  );
}

export function StagingOntologyPage() {
  return (
    <StagingOntologyProvider>
      <StagingFrame tab="ontology">
        <Pane />
      </StagingFrame>
      <StagingScenarioPanel />
    </StagingOntologyProvider>
  );
}
