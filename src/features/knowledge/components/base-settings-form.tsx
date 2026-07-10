"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/shared/ui/toast";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import {
  KnowledgeApiError,
  deleteBase,
  updateBase,
  updateFolder,
} from "../client/api";
import { DESCRIPTION_MAX } from "@/config";
import type { Role } from "@/features/workspaces/types";
import type { KnowledgeBase, KnowledgeFolder } from "../types";
import { knowledgeBaseSegment } from "../url";
import { AgentWriteToggle } from "./agent-write-toggle";
import { KbSharingSection } from "./kb-sharing-section";

interface Props {
  workspaceId: string;
  workspaceSlug: string;
  base: KnowledgeBase;
  folders: KnowledgeFolder[];
  currentUserId: string;
  role: Role;
  onFoldersChanged?: () => void;
}

/**
 * Settings form for a single knowledge base. Sections:
 *   1. General — name, description.
 *   2. Sharing — private / teams / workspace scope + team grants.
 *   3. Agent access — the agent-write toggle.
 *   4. Advanced — slug edit (folded behind a disclosure).
 *   5. Danger zone — soft-delete the KB.
 */
export function BaseSettingsForm({
  workspaceId,
  workspaceSlug,
  base,
  folders,
  currentUserId,
  role,
  onFoldersChanged,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState(base.name);
  const [description, setDescription] = useState(base.description ?? "");
  const [slug, setSlug] = useState(base.slug);
  const [showAdvanced, setShowAdvanced] = useState(false);
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
      // Slug change keeps the same publicId — the route resolver will
      // 301 the old URL anyway, but we replace eagerly so the address
      // bar reflects the new canonical immediately.
      if (next.slug !== base.slug) {
        router.replace(
          `/${workspaceSlug}/knowledge/${knowledgeBaseSegment(next)}`
        );
      } else {
        router.refresh();
      }
    } catch (err) {
      const msg =
        err instanceof KnowledgeApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Save failed";
      toast({ title: "Couldn't save", description: msg });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteBase(base.id, workspaceId);
      toast({ title: `"${base.name}" deleted` });
      // Return to the knowledge list; the user can pick another base there.
      router.replace(`/${workspaceSlug}/knowledge`);
      router.refresh();
    } catch (err) {
      const msg =
        err instanceof KnowledgeApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Couldn't delete";
      toast({ title: "Couldn't delete", description: msg });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* General */}
      <Section title="General">
        <Field label="Name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-9 px-3 rounded-md bg-surface-raised-3 border border-border-strong text-body text-text-primary placeholder:text-text-muted outline-none focus:border-border-highlight transition-colors"
          />
        </Field>
        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) =>
              setDescription(e.target.value.slice(0, DESCRIPTION_MAX))
            }
            rows={3}
            maxLength={DESCRIPTION_MAX}
            placeholder="What's in this knowledge base? Agents see this when listing bases."
            className="px-3 py-2 rounded-md bg-surface-raised-3 border border-border-strong text-body text-text-primary placeholder:text-text-muted outline-none focus:border-border-highlight transition-colors resize-none"
          />
          <p className="text-right font-mono text-micro text-text-muted">
            {description.length}/{DESCRIPTION_MAX}
          </p>
        </Field>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving}
            className="h-8 px-4 rounded-md bg-surface-cta text-text-on-cta text-small font-medium hover:bg-surface-cta/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </Section>

      {/* Sharing — three-way scope + team grants. */}
      <Section title="Sharing">
        <KbSharingSection
          workspaceId={workspaceId}
          workspaceSlug={workspaceSlug}
          base={base}
          currentUserId={currentUserId}
          role={role}
        />
      </Section>

      {/* Folder descriptions — agent-facing summaries streamed into MCP
          tree / directory listings alongside the folder names. */}
      {folders.length > 0 ? (
        <Section title="Folder descriptions">
          <p className="text-caption text-text-secondary leading-relaxed -mt-1">
            Short summaries of what each folder holds. Agents see these when
            browsing the tree, so they can navigate without opening every
            file.
          </p>
          <div className="flex flex-col gap-3">
            {sortFoldersByPath(folders).map(({ folder, pathLabel }) => (
              <FolderDescriptionRow
                key={folder.id}
                folder={folder}
                pathLabel={pathLabel}
                workspaceId={workspaceId}
                onSaved={onFoldersChanged}
              />
            ))}
          </div>
        </Section>
      ) : null}

      {/* Agent access */}
      <Section title="Agent access">
        <AgentWriteToggle
          baseId={base.id}
          workspaceId={workspaceId}
          initialValue={base.agentWriteEnabled}
        />
      </Section>

      {/* Advanced */}
      <Section title="Advanced">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-small text-text-secondary hover:text-text-primary cursor-pointer"
        >
          {showAdvanced ? "Hide" : "Show"} URL slug
        </button>
        {showAdvanced ? (
          <Field label="Slug">
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="h-9 px-3 rounded-md bg-surface-raised-3 border border-border-strong text-body font-mono text-text-primary outline-none focus:border-border-highlight transition-colors"
            />
            <p className="mt-1 text-caption text-text-secondary/60">
              Lowercase letters, numbers, and hyphens. Changing it
              updates the URL — links to the old slug will 404.
            </p>
          </Field>
        ) : null}
      </Section>

      {/* Danger zone */}
      <Section title="Danger zone">
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-4">
          <p className="text-title font-medium text-text-primary">
            Delete this knowledge base
          </p>
          <p className="mt-1 text-caption text-text-secondary leading-relaxed">
            Soft-deletes the base and all its folders + entries. You
            can restore from the trash modal until it&rsquo;s purged.
          </p>
          <button
            type="button"
            onClick={() => setConfirmDeleteOpen(true)}
            disabled={deleting}
            className="mt-3 h-8 px-4 rounded-md bg-danger text-white text-small font-medium hover:bg-danger/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {deleting ? "Deleting…" : "Delete knowledge base"}
          </button>
        </div>
      </Section>

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Delete knowledge base?"
        description={`“${base.name}” and all its folders + entries will move to trash. You can restore it from the trash modal until it's purged.`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
      />
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-label font-medium text-text-muted uppercase tracking-wider mb-3">
        {title}
      </h2>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-label font-medium text-text-tertiary uppercase tracking-wider">
        {label}
      </label>
      {children}
    </div>
  );
}

/** Full path label per folder ("parent / child"), sorted so nested
 *  folders list under their ancestors. Cycle-guarded. */
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

/** One folder's description editor — saves on blur when changed. */
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
      const msg =
        err instanceof KnowledgeApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Save failed";
      toast({ title: "Couldn't save folder description", description: msg });
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-small font-medium text-text-primary truncate">
          {pathLabel}
        </span>
        <span className="shrink-0 font-mono text-micro text-text-muted">
          {value.length}/{DESCRIPTION_MAX}
        </span>
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, DESCRIPTION_MAX))}
        onBlur={handleBlur}
        rows={2}
        maxLength={DESCRIPTION_MAX}
        placeholder="What's in this folder?"
        className="px-3 py-2 rounded-md bg-surface-raised-3 border border-border-strong text-body text-text-primary placeholder:text-text-muted outline-none focus:border-border-highlight transition-colors resize-none"
      />
    </div>
  );
}
