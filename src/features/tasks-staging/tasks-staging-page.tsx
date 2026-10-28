"use client";

/**
 * UI STAGING: the MOCKED Tasks page (Samuel, 2026-10-28), inside the landing demo's window, its
 * header tab between Identities and Ontology. Hard-coded, no fetch, nothing persists.
 *
 * ⚠ CLIENT-ONLY CONTENT, like /playground/identities: the face mounts after hydration so the
 * server pass and the client never disagree.
 */

import { useEffect, useState } from "react";
import { StagingFrame } from "@/features/ui-staging/staging-frame";
import { STAGING_USER_ID } from "@/features/ui-staging/staging-stubs";
import { TasksHome } from "./tasks-home";

export function TasksStagingPage() {
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount flag
  useEffect(() => setMounted(true), []);
  return (
    <StagingFrame tab="tasks">
      {mounted && <TasksHome currentUserId={STAGING_USER_ID} />}
    </StagingFrame>
  );
}
