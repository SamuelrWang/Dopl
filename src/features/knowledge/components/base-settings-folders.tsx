"use client";

import { userFacingMessage } from "@/shared/api/user-facing-message";
import { useState } from "react";
import {
  SettingsPanel,
  SettingsRows,
} from "@/shared/layout/settings-modal/sections/settings-panel";
import { toast } from "@/shared/ui/toast";
import { DESCRIPTION_MAX } from "@/config";
import { updateFolder } from "../client/api";
import type { KnowledgeFolder } from "../types";
import { InPlaceDescription } from "@/shared/ui/in-place-fields";

/** Agent-facing folder summaries, shown in MCP tree listings: one row per folder, saved on blur. */
export function FolderDescriptions({
  folders,
  workspaceId,
  onSaved,
}: {
  folders: KnowledgeFolder[];
  workspaceId: string;
  onSaved?: () => void;
}) {
  return (
    <SettingsPanel
      id="kb-settings-folders"
      label="Folder descriptions"
      caption="Agents read these when browsing the tree."
    >
      <SettingsRows label="Folder descriptions">
        {sortFoldersByPath(folders).map(({ folder, pathLabel }) => (
          <FolderDescriptionRow
            key={folder.id}
            folder={folder}
            pathLabel={pathLabel}
            workspaceId={workspaceId}
            onSaved={onSaved}
          />
        ))}
      </SettingsRows>
    </SettingsPanel>
  );
}

/** Full path label per folder ("parent / child"), sorted so nested folders
 *  list under their ancestors. Cycle-guarded. */
function sortFoldersByPath(
  folders: KnowledgeFolder[]
): Array<{ folder: KnowledgeFolder; pathLabel: string }> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  return folders
    .map((folder) => {
      const parts: string[] = [];
      const visited = new Set<string>();
      let current: KnowledgeFolder | undefined = folder;
      while (current && !visited.has(current.id)) {
        visited.add(current.id);
        parts.unshift(current.name);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
      return { folder, pathLabel: parts.join(" / ") };
    })
    .sort((a, b) => a.pathLabel.localeCompare(b.pathLabel));
}

function FolderDescriptionRow({
  folder,
  pathLabel,
  workspaceId,
  onSaved,
}: {
  folder: KnowledgeFolder;
  pathLabel: string;
  workspaceId: string;
  onSaved?: () => void;
}) {
  const [value, setValue] = useState(folder.description ?? "");
  const [savedValue, setSavedValue] = useState(folder.description ?? "");

  async function handleBlur() {
    const next = value.trim();
    if (next === savedValue.trim()) return;
    try {
      await updateFolder(
        folder.id,
        { description: next === "" ? null : next },
        workspaceId
      );
      setSavedValue(next);
      onSaved?.();
    } catch (err) {
      toast({
        title: "Couldn't save folder description",
        description: userFacingMessage(err),
      });
    }
  }

  return (
    <li className="flex flex-col gap-0.5 py-2.5">
      <span className="truncate text-body font-medium text-text-primary">{pathLabel}</span>
      <InPlaceDescription
        label={`${pathLabel} description`}
        multiline
        value={value}
        onChange={setValue}
        onBlur={handleBlur}
        max={DESCRIPTION_MAX}
        placeholder="What's in this folder?"
      />
    </li>
  );
}
