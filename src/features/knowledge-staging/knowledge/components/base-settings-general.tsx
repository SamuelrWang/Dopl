"use client";

/** STAGING (new with the overhaul, PORTING.md): the settings popup's General pane — `src/features/knowledge/components/base-settings-form.tsx`'s General, Advanced and Danger zone sections. */
import { userFacingMessage } from "@/shared/api/user-facing-message";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/shared/lib/utils";
import {
  SettingsCard,
  SettingsPanel,
  SettingsRow,
  SettingsRows,
} from "@/shared/layout/settings-modal/sections/settings-panel";
import { UnderlineField } from "@/shared/ui/form-dialog";
import {
  SMALL_PILL_BUTTON,
  SMALL_PRIMARY_PILL,
  SMALL_TEXT_BUTTON,
} from "@/shared/ui/small-action-button";
import { toast } from "@/shared/ui/toast";
import { KB_BASE_DESCRIPTION_MAX } from "@/config";
import { updateBase } from "../client/api";
import { seedKnowledgeBase } from "../client/hooks";
import type { KnowledgeBase } from "../types";
import { deleteBaseAndLeave } from "./delete-base";
import { DeleteBaseConfirm } from "./delete-base-confirm";
import type { KnowledgeRouting } from "./knowledge-v2/routing";

/**
 * Name, description and URL slug, saved together by one verb, then the danger
 * zone. The slug edit is folded behind a toggle: changing it moves the URL and
 * strands every old link.
 */
export function BaseGeneralPane({
  workspaceId,
  workspaceSlug,
  base,
  routing,
}: {
  workspaceId: string;
  workspaceSlug: string;
  base: KnowledgeBase;
  /** Slug edits and the delete both change which URL is canonical
   *  (./knowledge-v2/routing.ts). */
  routing: KnowledgeRouting;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(base.name);
  const [description, setDescription] = useState(base.description ?? "");
  const [slug, setSlug] = useState(base.slug);
  const [showSlug, setShowSlug] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const dirty =
    name.trim() !== base.name ||
    description !== (base.description ?? "") ||
    slug !== base.slug;

  async function handleSave() {
    if (!dirty) return;
    setSaving(true);
    try {
      const next = await updateBase(
        base.id,
        {
          name: name.trim() !== base.name ? name.trim() : undefined,
          description:
            description !== (base.description ?? "")
              ? description.trim() === ""
                ? null
                : description.trim()
              : undefined,
          slug: slug !== base.slug ? slug : undefined,
        },
        workspaceId
      );
      toast({ title: "Saved" });
      // The new row must be in the cache before the URL moves: the segment
      // carries the slug and the controller resolves it against this list.
      seedKnowledgeBase(queryClient, workspaceId, next);
      // Slug change keeps the publicId, so the resolver would 301 anyway;
      // replace eagerly so the address bar shows the new canonical at once.
      if (next.slug !== base.slug) {
        routing.goToBase(next, "replace");
      } else {
        routing.refreshServerData();
      }
    } catch (err) {
      toast({ title: "Couldn't save", description: userFacingMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteBaseAndLeave(base, workspaceId, queryClient, routing);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <SettingsPanel
        id="kb-settings-details"
        label="Details"
        caption={
          <span className="font-mono">
            /{workspaceSlug}/knowledge/{base.slug}
          </span>
        }
      >
        <SettingsCard label="Details">
          <div className="flex flex-col gap-4">
            <UnderlineField
              id="kb-settings-name"
              label="Name"
              ariaLabel="Name"
              value={name}
              onChange={setName}
            />
            <UnderlineField
              id="kb-settings-description"
              label="Description"
              ariaLabel="Description"
              caption={`${description.length}/${KB_BASE_DESCRIPTION_MAX}`}
              value={description}
              onChange={(next) => setDescription(next.slice(0, KB_BASE_DESCRIPTION_MAX))}
              maxLength={KB_BASE_DESCRIPTION_MAX}
              multiline
              minRows={2}
            />
            {showSlug ? (
              <UnderlineField
                id="kb-settings-slug"
                label="URL slug"
                ariaLabel="Slug"
                caption="Old links stop working"
                value={slug}
                onChange={setSlug}
              />
            ) : null}
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setShowSlug((v) => !v)}
              className={cn(SMALL_TEXT_BUTTON, "-ml-2.5")}
            >
              {showSlug ? "Hide URL slug" : "Edit URL slug"}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || saving}
              className={cn(SMALL_PRIMARY_PILL, "disabled:cursor-not-allowed disabled:opacity-40")}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </SettingsCard>
      </SettingsPanel>

      <SettingsPanel id="kb-settings-danger" label="Danger zone">
        <SettingsRows label="Danger zone">
          <SettingsRow
            title="Delete this knowledge base"
            meta="Deletes every folder and entry in it. This can't be undone."
          >
            <button
              type="button"
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={deleting}
              className={cn(SMALL_PILL_BUTTON, "text-danger")}
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </SettingsRow>
        </SettingsRows>
      </SettingsPanel>

      <DeleteBaseConfirm
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        baseName={base.name}
        onConfirm={handleDelete}
      />
    </>
  );
}
