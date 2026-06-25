import { KB_SCOPE_LABEL, kbScope } from "../../../scope";
import type { Selection } from "../types";
import { baseTint, initial } from "../utils";

export interface ViewModel {
  tint: string;
  title: string;
  subtitle: string;
  containerName: string;
  ownerInitial: string;
  createdAt: string;
  updatedAt: string;
  scopeLabel: string;
  /** Plain-language summary of who can reach the base. */
  accessLabel: string;
  description: string;
}

const ACCESS_LABEL: Record<string, string> = {
  private: "Owner only",
  team: "Granted teams only",
  workspace: "Everyone in the workspace",
};

/** Flatten a selection (base or entry) into the fields the detail layout
 *  needs. Entry view nests under its base; base view stands alone. */
export function viewModel(selection: Selection): ViewModel {
  const { base } = selection;
  const tint = baseTint(base);
  const scope = kbScope(base);
  const scopeLabel = KB_SCOPE_LABEL[scope];
  const accessLabel = ACCESS_LABEL[scope];

  if (selection.kind === "entry") {
    const { entry } = selection;
    return {
      tint,
      title: entry.title || "Untitled",
      subtitle: entry.excerpt || `Entry in ${base.name}.`,
      containerName: base.name,
      ownerInitial: initial(base.name),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      scopeLabel,
      accessLabel,
      description: entry.excerpt || entry.body || "",
    };
  }

  return {
    tint,
    title: base.name,
    subtitle: base.description || `${scopeLabel} knowledge base.`,
    containerName: base.name,
    ownerInitial: initial(base.name),
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
    scopeLabel,
    accessLabel,
    description: base.description || "",
  };
}
