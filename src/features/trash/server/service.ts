import "server-only";

import type { WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import { RETENTION_DAYS } from "../retention";
import {
  buildChatContext,
  listTrashedChats,
  purgeChat,
  restoreChat,
  type ChatTrashItem,
} from "@/features/chats/server/service";
import {
  buildKnowledgeContext,
  listTrashedForWorkspace,
  purgeBase,
  purgeEntry,
  purgeFolder,
  restoreBase,
  restoreEntry,
  restoreFolder,
  type TrashedKnowledgeItem,
} from "@/features/knowledge/server/service";
import {
  buildOntologyContext,
  listTrashedClusters,
  purgeCluster,
  restoreCluster,
  type TrashedClusterSummary,
} from "@/features/ontology/server/service";
import {
  buildSkillContext,
  listTrashedSkills,
  purgeSkill,
  restoreSkill,
  type TrashedSkillItem,
} from "@/features/skills/server/service";
import {
  listTrashedWorkflows,
  purgeWorkflow,
  restoreWorkflow,
  type TrashedWorkflow,
  type WorkflowScope,
} from "@/features/workflows/server/service";

/**
 * Cross-feature aggregation for the unified workspace Trash page (Phase 2).
 * This is the ONLY cross-cutting caller of every feature's per-feature trash
 * primitives (Phase 1): it builds each feature's ctx/scope, normalizes the
 * five list shapes into one `TrashItem`, and dispatches restore/purge by
 * `kind` back to the owning feature. Cross-feature imports are intentional
 * here (precedent: `features/teams/server`); the per-feature server code is
 * NOT touched — every gate (visibility, agent-write, not-trashed) still runs
 * inside the feature service this dispatches to.
 */

/**
 * Trash retention window (days). The daily purge cron
 * (`src/app/api/cron/purge-trash/route.ts`) hard-deletes any soft-deleted row
 * older than this; the same window drives every item's `purgesAt`. Both this
 * service and the cron import it from `../retention` so the knob is
 * single-sourced.
 */
export { RETENTION_DAYS };

const DAY_MS = 24 * 60 * 60 * 1000;

export type TrashKind =
  | "knowledge_base"
  | "knowledge_folder"
  | "knowledge_entry"
  | "skill"
  | "workflow"
  | "chat"
  | "ontology_cluster";

/**
 * One row of the unified Trash page. Every feature collapses to this shape.
 *   - `detail` = the containing knowledge base name (KB folder/entry) or
 *     `"${n} objects"` (ontology cluster); omitted otherwise.
 *   - `purgesAt` = `deletedAt` + `RETENTION_DAYS`, the moment the cron will
 *     hard-delete it.
 */
export interface TrashItem {
  kind: TrashKind;
  id: string;
  name: string;
  deletedAt: string;
  detail?: string;
  purgesAt: string;
}

function purgesAtFrom(deletedAt: string): string {
  return new Date(Date.parse(deletedAt) + RETENTION_DAYS * DAY_MS).toISOString();
}

function toWorkflowScope(auth: WorkspaceAuthContext): WorkflowScope {
  return {
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    role: auth.role,
    source: auth.agentTokenId ? "agent" : "user",
  };
}

// ── Normalizers (one per feature list shape) ─────────────────────────

function fromKnowledge(item: TrashedKnowledgeItem): TrashItem {
  return {
    kind: item.kind,
    id: item.id,
    name: item.name,
    deletedAt: item.deletedAt,
    detail: item.parentName,
    purgesAt: purgesAtFrom(item.deletedAt),
  };
}

function fromSkill(item: TrashedSkillItem): TrashItem {
  return {
    kind: item.kind,
    id: item.id,
    name: item.name,
    deletedAt: item.deletedAt,
    purgesAt: purgesAtFrom(item.deletedAt),
  };
}

function fromWorkflow(item: TrashedWorkflow): TrashItem {
  return {
    kind: item.kind,
    id: item.id,
    name: item.name,
    deletedAt: item.deletedAt,
    purgesAt: purgesAtFrom(item.deletedAt),
  };
}

function fromChat(item: ChatTrashItem): TrashItem {
  return {
    kind: item.kind,
    id: item.id,
    name: item.name,
    deletedAt: item.deletedAt,
    purgesAt: purgesAtFrom(item.deletedAt),
  };
}

function fromCluster(item: TrashedClusterSummary): TrashItem {
  return {
    kind: item.kind,
    id: item.id,
    name: item.name,
    deletedAt: item.deletedAt,
    detail: `${item.objectCount} objects`,
    purgesAt: purgesAtFrom(item.deletedAt),
  };
}

// ── Aggregation ──────────────────────────────────────────────────────

/**
 * Every trashed item across every feature the caller may see, normalized to
 * `TrashItem` and sorted newest-deleted first. Each feature list runs
 * independently via `Promise.allSettled` — one feature throwing (a bad
 * migration, a transient DB error) logs and is skipped, never blanking the
 * whole Trash page.
 */
export async function listWorkspaceTrash(
  auth: WorkspaceAuthContext
): Promise<TrashItem[]> {
  const knowledgeCtx = buildKnowledgeContext(auth);
  const skillCtx = buildSkillContext(auth);
  const chatCtx = buildChatContext(auth);
  const ontologyCtx = buildOntologyContext(auth);
  const workflowScope = toWorkflowScope(auth);

  const sources: Array<{ feature: string; load: () => Promise<TrashItem[]> }> = [
    {
      feature: "knowledge",
      load: async () => (await listTrashedForWorkspace(knowledgeCtx)).map(fromKnowledge),
    },
    {
      feature: "skills",
      load: async () => (await listTrashedSkills(skillCtx)).map(fromSkill),
    },
    {
      feature: "workflows",
      load: async () => (await listTrashedWorkflows(workflowScope)).map(fromWorkflow),
    },
    {
      feature: "chats",
      load: async () => (await listTrashedChats(chatCtx)).map(fromChat),
    },
    {
      feature: "ontology",
      load: async () => (await listTrashedClusters(ontologyCtx)).map(fromCluster),
    },
  ];

  const settled = await Promise.allSettled(sources.map((s) => s.load()));
  const items: TrashItem[] = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      items.push(...result.value);
    } else {
      // One feature failing must not blank the whole page — log + skip it.
      console.error(
        `[trash] ${sources[i].feature} trash list failed:`,
        result.reason
      );
    }
  });

  return items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

// ── Dispatch (restore / purge by kind) ───────────────────────────────

function unknownKind(kind: string): HttpError {
  return new HttpError(400, "TRASH_UNKNOWN_KIND", `Unknown trash kind: ${kind}`);
}

/**
 * Restore one trashed item, dispatching to the owning feature's restore fn
 * (which re-runs that feature's visibility + write gates). Unknown kind → 400.
 */
export async function restoreTrashItem(
  auth: WorkspaceAuthContext,
  kind: string,
  id: string
): Promise<void> {
  switch (kind) {
    case "knowledge_base":
      await restoreBase(buildKnowledgeContext(auth), id);
      return;
    case "knowledge_folder":
      await restoreFolder(buildKnowledgeContext(auth), id);
      return;
    case "knowledge_entry":
      await restoreEntry(buildKnowledgeContext(auth), id);
      return;
    case "skill":
      await restoreSkill(buildSkillContext(auth), id);
      return;
    case "workflow":
      await restoreWorkflow(id, toWorkflowScope(auth));
      return;
    case "chat":
      await restoreChat(buildChatContext(auth), id);
      return;
    case "ontology_cluster":
      await restoreCluster(buildOntologyContext(auth), id);
      return;
    default:
      throw unknownKind(kind);
  }
}

/**
 * Permanently purge one trashed item, dispatching to the owning feature's
 * purge fn (which refuses a live row and re-runs that feature's gates).
 * Unknown kind → 400.
 */
export async function purgeTrashItem(
  auth: WorkspaceAuthContext,
  kind: string,
  id: string
): Promise<void> {
  switch (kind) {
    case "knowledge_base":
      await purgeBase(buildKnowledgeContext(auth), id);
      return;
    case "knowledge_folder":
      await purgeFolder(buildKnowledgeContext(auth), id);
      return;
    case "knowledge_entry":
      await purgeEntry(buildKnowledgeContext(auth), id);
      return;
    case "skill":
      await purgeSkill(buildSkillContext(auth), id);
      return;
    case "workflow":
      await purgeWorkflow(id, toWorkflowScope(auth));
      return;
    case "chat":
      await purgeChat(buildChatContext(auth), id);
      return;
    case "ontology_cluster":
      await purgeCluster(buildOntologyContext(auth), id);
      return;
    default:
      throw unknownKind(kind);
  }
}
