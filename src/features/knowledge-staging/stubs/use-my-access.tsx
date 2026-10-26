"use client";

/**
 * STAGING STUB of `src/features/members/hooks/use-my-access.tsx`. Same exports; the operator
 * resolves to `edit` on every resource (they own or administer everything staged).
 */
import { createContext, useContext, type ReactNode } from "react";
import type { AccessLevel } from "@/features/teams/access-levels";

type ResourceType = "knowledge_base" | "skill";

interface MyAccessPayload {
  defaultLevel: AccessLevel;
  overrides: Array<{ resourceType: ResourceType; resourceId: string; level: AccessLevel }>;
}

export interface UseMyAccessResult {
  data: MyAccessPayload | null;
  loading: boolean;
  resolve: (resourceType: ResourceType, resourceId: string) => AccessLevel | null;
  refetch: () => void;
}

const EDIT_EVERYWHERE: UseMyAccessResult = {
  data: { defaultLevel: "edit", overrides: [] },
  loading: false,
  resolve: () => "edit",
  refetch: () => {},
};

const NO_OP_RESULT: UseMyAccessResult = {
  data: null,
  loading: false,
  resolve: () => null,
  refetch: () => {},
};

const MyAccessCtx = createContext<UseMyAccessResult | null>(null);

export function MyAccessProvider({
  workspaceSegment,
  children,
}: {
  workspaceSegment: string | null;
  children: ReactNode;
}) {
  return (
    <MyAccessCtx.Provider value={workspaceSegment ? EDIT_EVERYWHERE : NO_OP_RESULT}>
      {children}
    </MyAccessCtx.Provider>
  );
}

export function useMyAccessContext(): UseMyAccessResult {
  return useContext(MyAccessCtx) ?? NO_OP_RESULT;
}
