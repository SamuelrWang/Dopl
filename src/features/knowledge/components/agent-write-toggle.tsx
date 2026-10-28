"use client";

import { userFacingMessage } from "@/shared/api/user-facing-message";
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import {
  SettingsPanel,
  SettingsRow,
  SettingsRows,
} from "@/shared/layout/settings-modal/sections/settings-panel";
import { Switch } from "@/shared/ui/switch";
import { toast } from "@/shared/ui/toast";
import { updateBase } from "../client/api";

interface Props {
  baseId: string;
  workspaceId: string;
  initialValue: boolean;
}

/**
 * The settings popup's Agents pane: the `agent_write_enabled` switch. ON lets
 * MCP-origin callers create/edit/move/delete in this base; OFF (default) is
 * read-only.
 *
 * Enforcement is server-side in
 * [service.ts#assertAgentWriteAllowed](src/features/knowledge/server/service.ts).
 */
export function AgentWriteToggle({
  baseId,
  workspaceId,
  initialValue,
}: Props) {
  const [enabled, setEnabled] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);

  async function handleToggle(next: boolean) {
    setSubmitting(true);
    try {
      const updated = await updateBase(
        baseId,
        { agentWriteEnabled: next },
        workspaceId
      );
      setEnabled(updated.agentWriteEnabled);
      toast({
        title: updated.agentWriteEnabled
          ? "Agent writes enabled"
          : "Agent writes disabled",
        description: updated.agentWriteEnabled
          ? "Your agent (MCP / CLI) can now edit this knowledge base."
          : "Your agent can read but not modify this knowledge base.",
      });
    } catch (err) {
      toast({ title: "Couldn't toggle", description: userFacingMessage(err) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SettingsPanel id="kb-settings-agents" label="Agent access">
      <SettingsRows label="Agent access">
        <SettingsRow
          title="Allow agent writes"
          meta="Create, edit, move and delete files. Reads are always allowed."
        >
          <Switch
            checked={enabled}
            disabled={submitting}
            onChange={(next) => void handleToggle(next)}
            aria-label="Allow agent writes"
          />
        </SettingsRow>
      </SettingsRows>
      {enabled ? (
        <p className="flex items-center gap-1.5 px-1 text-caption text-warning">
          <AlertTriangle size={11} aria-hidden="true" />
          Agent edits land directly. There&rsquo;s no review step.
        </p>
      ) : null}
    </SettingsPanel>
  );
}
