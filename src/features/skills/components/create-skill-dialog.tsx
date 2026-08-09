"use client";

import { useState } from "react";
import { X } from "lucide-react";
// The shared 2000-char budget `SkillCreateSchema` bounds `description` and
// `whenToUse` at. KB-named but explicitly documented in `@/config` as "the
// same budget as workspace/skill descriptions — keep every editor on this
// constant so the layers can't drift again".
import { KB_BASE_DESCRIPTION_MAX } from "@/config";
// Deep import, not the `settings-modal` barrel — the barrel re-exports
// SettingsModal, which is Next-coupled, and this tree must stay Next-free
// (the desktop SPA renders `SkillsBrowserCore` directly).
import { ModalShell } from "@/shared/layout/settings-modal/modal-shell";
import modalStyles from "@/shared/layout/settings-modal/settings-modal.module.css";
import type { Skill } from "@/features/skills/types";
import { SkillApiError, createSkill } from "@/features/skills/client/api";

const FIELD =
  "px-3 py-2 rounded-md bg-surface-raised-3 border border-border-strong text-body text-text-primary placeholder:text-text-muted outline-none focus:border-border-highlight transition-colors";
const LABEL =
  "text-label font-medium uppercase tracking-wider text-text-secondary";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  /** The skill landed — the browser selects it and re-pulls the list. */
  onCreated: (skill: Skill) => void;
}

/**
 * Create-skill dialog — the same ModalShell chrome as `CreateBaseDialog`.
 *
 * It asks for the THREE fields `SkillCreateSchema` requires and the skill
 * editor cannot edit: name, description, and when to use. Those last two are
 * how an agent decides whether to invoke the skill at all, and `SkillView`
 * only edits the title, folder, sharing and the SKILL.md body — so creating
 * with placeholder text would leave a skill nobody could fix without going
 * back out to MCP, which is the hole this whole affordance exists to close.
 * The procedure itself is written in the editor that opens behind this.
 *
 * Created as a `draft` (like `duplicateSkill`) and private (the service's
 * default for a user-authored skill) — start drafty, publish deliberately.
 */
export function CreateSkillDialog({
  open,
  onOpenChange,
  workspaceId,
  onCreated,
}: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [whenToUse, setWhenToUse] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    onOpenChange(false);
    setName("");
    setDescription("");
    setWhenToUse("");
    setError(null);
    setSubmitting(false);
  }

  const disabled =
    submitting || !name.trim() || !description.trim() || !whenToUse.trim();

  async function handleCreate() {
    if (disabled) return;
    setSubmitting(true);
    setError(null);
    try {
      const { skill } = await createSkill(
        {
          name: name.trim(),
          description: description.trim(),
          whenToUse: whenToUse.trim(),
          status: "draft",
        },
        workspaceId
      );
      close();
      onCreated(skill);
    } catch (err) {
      setError(
        err instanceof SkillApiError || err instanceof Error
          ? err.message
          : "Something went wrong"
      );
      setSubmitting(false);
    }
  }

  return (
    <ModalShell open={open} onClose={close} label="New skill" size="narrow">
      <button
        type="button"
        className={modalStyles.close}
        onClick={close}
        aria-label="Close"
      >
        <X size={18} />
      </button>
      <div className={modalStyles.narrowBody}>
        <h2 className={modalStyles.narrowTitle} style={{ textAlign: "center" }}>
          New skill
        </h2>
        <p className="mb-6 text-lead leading-relaxed text-text-secondary">
          A skill is a procedure your agent discovers over MCP. Name it and say
          when it applies — you write the procedure itself in the editor next.
        </p>

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label className={LABEL} htmlFor="new-skill-name">
              Name
            </label>
            <input
              id="new-skill-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 120))}
              placeholder="e.g. Draft a release note"
              maxLength={120}
              autoFocus
              className={`h-9 ${FIELD}`}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={LABEL} htmlFor="new-skill-description">
              What it does
            </label>
            <textarea
              id="new-skill-description"
              value={description}
              onChange={(e) =>
                setDescription(e.target.value.slice(0, KB_BASE_DESCRIPTION_MAX))
              }
              placeholder="One or two lines the agent reads when listing skills."
              rows={2}
              maxLength={KB_BASE_DESCRIPTION_MAX}
              className={`resize-none ${FIELD}`}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={LABEL} htmlFor="new-skill-when">
              When to use it
            </label>
            <textarea
              id="new-skill-when"
              value={whenToUse}
              onChange={(e) =>
                setWhenToUse(e.target.value.slice(0, KB_BASE_DESCRIPTION_MAX))
              }
              placeholder="The trigger — what the user asks for, or what the agent notices."
              rows={2}
              maxLength={KB_BASE_DESCRIPTION_MAX}
              className={`resize-none ${FIELD}`}
            />
          </div>

          {error && <p className="text-small text-danger">{error}</p>}
        </div>

        <div className={modalStyles.confirmActions}>
          <button type="button" className={modalStyles.btnCancel} onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className={modalStyles.btnConfirm}
            onClick={() => void handleCreate()}
            disabled={disabled}
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
