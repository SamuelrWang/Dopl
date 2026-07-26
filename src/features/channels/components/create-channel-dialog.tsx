"use client";

import { useState } from "react";
import { ModalShell } from "@/shared/layout/settings-modal";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import type { Channel, ChannelVisibility } from "../types";
import { ChannelApiError, createChannel } from "../client/api";

interface Props {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (channel: Channel) => void;
}

/**
 * Create-channel dialog: name, optional topic, and a visibility choice
 * (private = members only, public = the whole workspace).
 */
export function CreateChannelDialog({
  workspaceId,
  open,
  onOpenChange,
  onCreated,
}: Props) {
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [visibility, setVisibility] = useState<ChannelVisibility>("private");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setTopic("");
    setVisibility("private");
    setError(null);
    setSubmitting(false);
  }

  function close() {
    onOpenChange(false);
    reset();
  }

  async function submit() {
    const trimmed = name.trim();
    if (trimmed === "" || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const channel = await createChannel(
        { name: trimmed, topic: topic.trim() || undefined, visibility },
        workspaceId
      );
      onCreated(channel);
      close();
    } catch (err) {
      setError(
        err instanceof ChannelApiError ? err.message : "Couldn't create the channel"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell open={open} onClose={close} label="New channel" size="narrow">
      <div className="flex flex-col gap-4 p-6">
        <div className="flex flex-col items-center gap-1.5 text-center">
          <h2 className="text-title font-semibold text-text-primary">
            New channel
          </h2>
          <p className="text-caption text-text-secondary">
            A shared thread for your team and their agents.
          </p>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
            Name
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            maxLength={120}
            autoFocus
            placeholder="e.g. Release planning"
            className="concave-field h-9 rounded-[9px] px-3 text-body text-text-primary outline-none placeholder:text-text-muted"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
            Topic <span className="font-normal normal-case text-text-muted">(optional)</span>
          </span>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            maxLength={2000}
            placeholder="What is this channel about?"
            className="concave-field h-9 rounded-[9px] px-3 text-body text-text-primary outline-none placeholder:text-text-muted"
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
            Visibility
          </span>
          <SegmentedControl
            options={[
              { key: "private" as const, label: "Private" },
              { key: "public" as const, label: "Public" },
            ]}
            value={visibility}
            onChange={setVisibility}
          />
          <p className="text-caption text-text-muted">
            {visibility === "private"
              ? "Only people you add can see and post."
              : "Any workspace member can see and join."}
          </p>
        </div>

        {error && <p className="text-caption text-danger">{error}</p>}

        <div className="flex flex-col gap-1.5 pt-1">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || name.trim() === ""}
            className="auth-btn-3d h-10 rounded-[9px] text-body font-medium disabled:opacity-40"
          >
            {submitting ? "Creating…" : "Create channel"}
          </button>
          <button
            type="button"
            onClick={close}
            className="h-10 rounded-[9px] text-body font-medium text-text-secondary transition-colors hover:bg-surface-raised-2 hover:text-text-primary"
          >
            Cancel
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
