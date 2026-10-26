"use client";

/** STAND-IN for `agent-identities/hooks/use-attachable-bases.ts`: `/knowledge`'s seed bases in the
 *  named workspace, after one pending beat. */
import { useEffect, useMemo, useState } from "react";
import type { AttachableBases } from "@/features/agent-identities/hooks/use-attachable-bases";
import { KNOWLEDGE_BASES } from "../data";

export function useStagingAttachableBases(workspaceId: string): AttachableBases {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 150);
    return () => clearTimeout(t);
  }, []);
  const bases = useMemo(
    () =>
      KNOWLEDGE_BASES.filter((b) => b.workspaceId === workspaceId).map((b) => ({
        id: b.id,
        name: b.name,
      })),
    [workspaceId]
  );
  return { bases, state: ready ? "ready" : "pending", retry: () => setReady(true) };
}
