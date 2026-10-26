"use client";

/**
 * STAGING STAND-IN for `src/features/billing/components/use-workspace-entitlements.ts`
 * — only the fields the ontology view reads. The object cap is forced by the
 * staging scenario panel ("Object cap: near" / "over"). ⚠ PORTING: do not port.
 */

import { useStagingOntologyStore } from "../store/staging-ontology-store";

export const STAGING_OBJECT_CAP = 1000;

export function useWorkspaceEntitlements(workspaceId?: string) {
  void workspaceId;
  const { scenario } = useStagingOntologyStore();
  const isCapped = scenario === "cap-near" || scenario === "cap-over";
  const objectsUsed = scenario === "cap-over" ? 1000 : scenario === "cap-near" ? 940 : 112;
  return {
    loading: false,
    isCapped,
    objectCap: isCapped ? STAGING_OBJECT_CAP : null,
    objectsUsed,
    overCap: scenario === "cap-over",
    containerKind: "home" as const,
    refresh: async () => {},
  };
}
