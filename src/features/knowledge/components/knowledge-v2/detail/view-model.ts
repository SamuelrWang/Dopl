import { KB_SCOPE_LABEL, kbScope } from "../../../scope";
import type { Selection } from "../types";

export interface ViewModel {
  title: string;
  createdAt: string;
  updatedAt: string;
  scopeLabel: string;
  /** Plain-language summary of who can reach the base. */
  accessLabel: string;
}

const ACCESS_LABEL: Record<string, string> = {
  private: "Owner only",
  team: "Granted teams only",
  workspace: "Everyone in the workspace",
};

/** Flatten a selection (base or entry) into the read-only fields the detail
 *  layout needs (title + timestamps + access labels). */
export function viewModel(selection: Selection): ViewModel {
  const { base } = selection;
  const scope = kbScope(base);
  const scopeLabel = KB_SCOPE_LABEL[scope];
  const accessLabel = ACCESS_LABEL[scope];

  if (selection.kind === "entry") {
    const { entry } = selection;
    return {
      title: entry.title || "Untitled",
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      scopeLabel,
      accessLabel,
    };
  }

  return {
    title: base.name,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
    scopeLabel,
    accessLabel,
  };
}
