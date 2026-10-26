// STAGING ONLY (item 4e). The one contract the three variants share, so the section's state lives
// in `devices-overview.tsx` and a variant is a pure renderer.
import type { MockHost } from "@/features/overview-staging/overview-mock-data";

/** Which structure is on screen. Samuel picks one; the other files are deleted after. */
export type VariantKey = "bands" | "tree" | "panes" | "cards";

export const VARIANT_OPTIONS: ReadonlyArray<{ key: VariantKey; label: string }> = [
  { key: "bands", label: "A · Weight" },
  { key: "tree", label: "B · Tree" },
  { key: "panes", label: "C · Panes" },
  { key: "cards", label: "D · Cards" },
];

/** Rename and remove, for a host or one of its reaches. Every variant takes the same four. */
export interface HostHandlers {
  onRename: (hostId: string, name: string) => void;
  onRemove: (hostId: string) => void;
  onRenameEndpoint: (hostId: string, endpointId: string, name: string) => void;
  onRemoveEndpoint: (hostId: string, endpointId: string) => void;
}

export interface VariantProps {
  hosts: ReadonlyArray<MockHost>;
  handlers: HostHandlers;
}
