"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/shared/ui/toast";
import {
  KnowledgeApiError,
  deleteBase,
  updateBase,
} from "../client/api";
import type { KnowledgeBase } from "../types";
import { AgentWriteToggle } from "./agent-write-toggle";

interface Props {
  workspaceId: string;
  workspaceSlug: string;
  base: KnowledgeBase;
}

/**
 * Settings form for a single knowledge base. Sections:
 *   1. General — name, description.
 *   2. Agent access — the agent-write toggle.
 *   3. Advanced — slug edit (folded behind a disclosure).
 *   4. Danger zone — soft-delete the KB.
 */
export function BaseSettingsForm({ workspaceId, workspaceSlug, base }: Props) {
  const router = useRouter();
  const [name, setName] = useState(base.name);
  const [description, setDescription] = useState(base.description ?? "");
  const [slug, setSlug] = useState(base.slug);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
      // If the slug changed, redirect to the new URL.
      if (next.slug !== base.slug) {
        router.replace(`/${workspaceSlug}/knowledge/${next.slug}/settings`);
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
    const ok = window.confirm(
      `Move "${base.name}" to trash? You can restore it from the trash modal.`
    );
    if (!ok) return;
    setDeleting(true);
    try {
      await deleteBase(base.id, workspaceId);
      toast({ title: `"${base.name}" deleted` });
      // The /knowledge index page no longer exists — bounce to the
      // workspace home; the user can pick another KB from the sidebar.
      router.replace(`/${workspaceSlug}`);
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
            className="h-9 px-3 rounded-md bg-white/[0.06] border border-white/[0.12] text-sm text-white placeholder:text-white/30 outline-none focus:border-white/[0.25] transition-colors"
          />
        </Field>
        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="px-3 py-2 rounded-md bg-white/[0.06] border border-white/[0.12] text-sm text-white placeholder:text-white/30 outline-none focus:border-white/[0.25] transition-colors resize-none"
          />
        </Field>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving}
            className="h-8 px-4 rounded-md bg-white text-black text-xs font-medium hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </Section>

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
          className="text-xs text-text-secondary hover:text-text-primary cursor-pointer"
        >
          {showAdvanced ? "Hide" : "Show"} URL slug
        </button>
        {showAdvanced ? (
          <Field label="Slug">
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="h-9 px-3 rounded-md bg-white/[0.06] border border-white/[0.12] text-sm font-mono text-white outline-none focus:border-white/[0.25] transition-colors"
            />
            <p className="mt-1 text-[11px] text-text-secondary/60">
              Lowercase letters, numbers, and hyphens. Changing it
              updates the URL — links to the old slug will 404.
            </p>
          </Field>
        ) : null}
      </Section>

      {/* Danger zone */}
      <Section title="Danger zone">
        <div className="rounded-lg border border-red-400/30 bg-red-500/[0.04] p-4">
          <p className="text-sm font-medium text-text-primary">
            Delete this knowledge base
          </p>
          <p className="mt-1 text-xs text-text-secondary leading-relaxed">
            Soft-deletes the base and all its folders + entries. You
            can restore from the trash modal until it&rsquo;s purged.
          </p>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="mt-3 h-8 px-4 rounded-md bg-red-500 text-white text-xs font-medium hover:bg-red-500/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {deleting ? "Deleting…" : "Delete knowledge base"}
          </button>
        </div>
      </Section>
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
      <h2 className="text-[10px] font-medium text-white/40 uppercase tracking-wider mb-3">
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
      <label className="text-xs font-medium text-white/60 uppercase tracking-wider">
        {label}
      </label>
      {children}
    </div>
  );
}
