"use client";

import { useState, type ReactNode } from "react";
// Deep import of `modal-shell`, as every dialog in this kit does. The `settings-modal`
// barrel used to re-export the web SettingsModal and so reached `next/navigation`; that
// modal was deleted 2026-10-11 (cleanup ST1) and the barrel is Next-free now.
import { ModalShell } from "@/shared/layout/settings-modal/modal-shell";
import modalStyles from "@/shared/layout/settings-modal/settings-modal.module.css";
import { SettingsPane } from "@/shared/layout/settings-modal/sections/settings-panel";
import { SegmentedControl, type SegmentedOption } from "@/shared/ui/segmented-control";
import { SMALL_TEXT_BUTTON } from "@/shared/ui/small-action-button";
import type { Role } from "@/features/workspaces/types";
import type { KnowledgeBase, KnowledgeFolder } from "../types";
import type { KnowledgeRouting } from "./knowledge-v2/routing";
import { AgentWriteToggle } from "./agent-write-toggle";
import { BaseGeneralPane } from "./base-settings-general";
import { FolderDescriptions } from "./base-settings-folders";
import { KbChannelGrantsSection } from "./kb-channel-grants-section";
import { KbSharingSection } from "./kb-sharing-section";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  workspaceSlug: string;
  base: KnowledgeBase;
  currentUserId: string;
  role: Role;
  /** Active folders; each gets a description editor under Folders. */
  folders: KnowledgeFolder[];
  /** Fires after a folder description saves, so the parent can refresh its
   *  tree snapshot. */
  onFoldersChanged?: () => void;
  /** Router bindings for the general pane's slug-change / delete moves. */
  routing: KnowledgeRouting;
}

type Section = "general" | "sharing" | "folders" | "agents";

const NAV: ReadonlyArray<SegmentedOption<Section>> = [
  { key: "general", label: "General" },
  { key: "sharing", label: "Sharing" },
  { key: "folders", label: "Folders" },
  { key: "agents", label: "Agents" },
];

/**
 * Per-KB settings, in the profile popup's chrome (`settings-modal-core.tsx`): the
 * underline rail on `--bg-overlay`, one pane per section built from
 * `settings-panel.tsx`.
 *
 *   General — name, description, URL slug; the danger zone.
 *   Sharing — which workspace members see it (scope + team grants), then which
 *             channels (and so which guests and agents) reach it. Two audiences,
 *             one question, so one pane; Channels decides on the server whether
 *             it exists at all.
 *   Folders — agent-facing folder summaries. Drawn only when there are folders,
 *             so the rail never offers an empty pane.
 *   Agents  — the agent-write switch.
 */
export function BaseSettingsModal({
  open,
  onOpenChange,
  workspaceId,
  workspaceSlug,
  base,
  currentUserId,
  role,
  folders,
  onFoldersChanged,
  routing,
}: Props) {
  const [section, setSection] = useState<Section>("general");
  const nav = NAV.filter(({ key }) => key !== "folders" || folders.length > 0);
  const shown = nav.some(({ key }) => key === section) ? section : "general";
  const close = () => onOpenChange(false);

  return (
    <ModalShell open={open} onClose={close} label={`${base.name} settings`}>
      <nav className={modalStyles.nav}>
        <p className="truncate px-0.5 pb-3 text-caption text-text-muted" title={base.name}>
          {base.name}
        </p>
        <SegmentedControl<Section>
          options={nav}
          value={shown}
          onChange={setSection}
          variant="underline"
          size="lg"
          orientation="vertical"
          ariaLabel="Knowledge base settings sections"
        />
        <div className={modalStyles.navFoot}>
          <button type="button" onClick={close} className={SMALL_TEXT_BUTTON}>
            Close
          </button>
        </div>
      </nav>

      {/* Every pane stays mounted while the dialog is open, as the one long form
          did: a section switch keeps a half-typed name and a toggled switch. */}
      <div className={modalStyles.pane}>
        <Pane when="general" shown={shown}>
          <BaseGeneralPane
            workspaceId={workspaceId}
            workspaceSlug={workspaceSlug}
            base={base}
            routing={routing}
          />
        </Pane>
        <Pane when="sharing" shown={shown}>
          <KbSharingSection
            workspaceId={workspaceId}
            workspaceSlug={workspaceSlug}
            base={base}
            currentUserId={currentUserId}
            role={role}
            routing={routing}
          />
          <KbChannelGrantsSection baseId={base.id} workspaceId={workspaceId} />
        </Pane>
        {folders.length > 0 && (
          <Pane when="folders" shown={shown}>
            <FolderDescriptions
              folders={folders}
              workspaceId={workspaceId}
              onSaved={onFoldersChanged}
            />
          </Pane>
        )}
        <Pane when="agents" shown={shown}>
          <AgentWriteToggle
            baseId={base.id}
            workspaceId={workspaceId}
            initialValue={base.agentWriteEnabled}
          />
        </Pane>
      </div>
    </ModalShell>
  );
}

function Pane({ when, shown, children }: { when: Section; shown: Section; children: ReactNode }) {
  return (
    <div hidden={when !== shown}>
      <SettingsPane>{children}</SettingsPane>
    </div>
  );
}
