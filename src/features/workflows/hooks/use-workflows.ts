"use client";

import { useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createRefetchCoordinator,
  type RefetchCoordinator,
} from "@/shared/realtime/refetch-coordinator";
import { toast } from "@/shared/ui/toast";
import type { WorkflowStep } from "../types";
import * as api from "../client/api";
import { useWorkflowsRealtime } from "../client/realtime";
import type {
  NodeContentInput,
  WorkflowDetail,
  WorkflowSummary,
} from "../client/types";
import { createMergeScheduler } from "./merge-scheduler";

const TEXT_SAVE_DELAY_MS = 400;

type QueryStatus = "loading" | "ready" | "error";

const listQueryKey = (workspaceId: string) => ["workflows", workspaceId];
const detailQueryKey = (workspaceId: string, id: string) => ["workflow", workspaceId, id];

// Debounce-save key families (one entity → one key, payloads merge under it).
const wfKey = (workflowId: string) => `wf:${workflowId}`;
const stepKey = (workflowId: string, nodeId: string) => `step:${workflowId}:${nodeId}`;
const edgeKey = (workflowId: string, from: string, to: string) =>
  `edge:${workflowId}:${from}:${to}`;

/** Every pending save that targets this workflow (name / any step / any edge). */
const belongsToWorkflow = (key: string, workflowId: string) =>
  key === wfKey(workflowId) ||
  key.startsWith(`step:${workflowId}:`) ||
  key.startsWith(`edge:${workflowId}:`);

/** Pending saves that touch this step: its own text + any edge on either end. */
const touchesStep = (key: string, workflowId: string, nodeId: string) =>
  key === stepKey(workflowId, nodeId) ||
  key.startsWith(`edge:${workflowId}:${nodeId}:`) ||
  (key.startsWith(`edge:${workflowId}:`) && key.endsWith(`:${nodeId}`));

export interface WorkflowOps {
  createWorkflow: (name: string) => Promise<WorkflowSummary | null>;
  updateWorkflow: (
    id: string,
    patch: { name?: string; description?: string | null }
  ) => void;
  deleteWorkflow: (id: string) => Promise<void>;
  addStep: (workflowId: string, connectFrom?: string) => Promise<string | null>;
  patchStep: (
    workflowId: string,
    nodeId: string,
    wire: NodeContentInput,
    optimistic: Partial<WorkflowStep>,
    opts?: { debounce?: boolean }
  ) => void;
  removeStep: (workflowId: string, nodeId: string) => Promise<void>;
  connectSteps: (
    workflowId: string,
    from: string,
    to: string,
    condition: string,
    opts?: { debounce?: boolean }
  ) => void;
  disconnectSteps: (workflowId: string, from: string, to: string) => Promise<void>;
}

/**
 * Workflows data layer over TanStack Query (house style — see
 * use-ontology). Reads: the list + the selected workflow's detail (with
 * its composed step graph). Writes wrap the `/api/workflows/**` routes:
 * step text edits update the cached graph optimistically and debounce the
 * PATCH (fields MERGE per entity so a title + description burst both land);
 * structural changes (add/remove step, connect/disconnect) FLUSH pending
 * text first, then mutate, then invalidate so the server-owned topo order /
 * entry steps / attachment reconciliation re-land without a stale
 * invalidation reverting an unsent edit. Errors toast and re-fetch truth.
 */
export function useWorkflows(
  workspaceId: string,
  selectedWorkflowId: string | null
): {
  workflows: WorkflowSummary[];
  listStatus: QueryStatus;
  detail: WorkflowDetail | null;
  detailStatus: QueryStatus;
  refetchDetail: () => void;
  ops: WorkflowOps;
} {
  const qc = useQueryClient();

  const listQuery = useQuery({
    queryKey: listQueryKey(workspaceId),
    queryFn: () => api.listWorkflows(workspaceId),
  });

  const detailQuery = useQuery({
    queryKey: ["workflow", workspaceId, selectedWorkflowId],
    queryFn: () => api.getWorkflow(workspaceId, selectedWorkflowId as string),
    enabled: selectedWorkflowId !== null,
  });

  // One debounced, per-entity MERGING save scheduler for the hook's lifetime.
  // Merges fields under a stable per-entity key (no lost title/description),
  // and exposes flush/cancel so structural ops can order writes correctly.
  const schedulerRef = useRef<ReturnType<typeof createMergeScheduler> | null>(null);
  const scheduler = (schedulerRef.current ??= createMergeScheduler(TEXT_SAVE_DELAY_MS));

  // Flush any pending debounced save on unmount / workspace switch so an edit
  // inside the debounce window survives navigating away.
  useEffect(() => {
    return () => {
      void scheduler.flushAll();
    };
  }, [scheduler, workspaceId]);

  // ── Live updates from MCP/CLI agents and other tabs ────────────────
  // A remote change invalidates the list + the open workflow's detail so
  // the graph re-lands the server-owned topo order / attachments. The
  // guard: if the ACTIVE workflow has pending merge-scheduler entries the
  // user is mid-edit — invalidating would refetch and revert their unsent
  // title/description/condition (the clobber the scheduler was built to
  // stop). The coordinator defers until those entries drain; each
  // debounced save's completion (settleAfterSave) flushes the deferred
  // invalidation. Other workflows' updates wait behind the active edit,
  // then land together — an acceptable trade for never clobbering a typer.
  const selectedIdRef = useRef(selectedWorkflowId);
  useEffect(() => {
    selectedIdRef.current = selectedWorkflowId;
  });
  const activeHasPending = useCallback(() => {
    const wfId = selectedIdRef.current;
    if (!wfId) return false;
    return scheduler.pendingKeys().some((k) => belongsToWorkflow(k, wfId));
  }, [scheduler]);
  const coordinatorRef = useRef<RefetchCoordinator | null>(null);
  const remoteInvalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: listQueryKey(workspaceId) });
    const wfId = selectedIdRef.current;
    if (wfId) {
      void qc.invalidateQueries({ queryKey: detailQueryKey(workspaceId, wfId) });
    }
  }, [qc, workspaceId]);
  const remoteInvalidateRef = useRef(remoteInvalidate);
  useEffect(() => {
    remoteInvalidateRef.current = remoteInvalidate;
  });
  useEffect(() => {
    coordinatorRef.current = createRefetchCoordinator(() =>
      remoteInvalidateRef.current()
    );
  }, []);
  // Run after a debounced save completes: if a remote invalidation was
  // deferred and the active workflow's edits have now drained, flush it.
  const settleAfterSave = useCallback(() => {
    coordinatorRef.current?.settle(activeHasPending());
  }, [activeHasPending]);
  useWorkflowsRealtime(workspaceId, () =>
    coordinatorRef.current?.request(activeHasPending())
  );

  const patchDetailNode = useCallback(
    (workflowId: string, nodeId: string, patch: Partial<WorkflowStep>) => {
      qc.setQueryData<WorkflowDetail>(detailQueryKey(workspaceId, workflowId), (prev) => {
        if (!prev?.graph) return prev;
        return {
          ...prev,
          graph: {
            ...prev.graph,
            nodes: prev.graph.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
          },
        };
      });
    },
    [qc, workspaceId]
  );

  const invalidate = useCallback(
    (workflowId: string) => {
      void qc.invalidateQueries({ queryKey: detailQueryKey(workspaceId, workflowId) });
      void qc.invalidateQueries({ queryKey: listQueryKey(workspaceId) });
    },
    [qc, workspaceId]
  );

  // Flush pending text/edge saves for a workflow BEFORE a structural mutation
  // + invalidate, so the invalidation can't revert an unsent controlled input.
  const flushWorkflow = useCallback(
    (workflowId: string) => scheduler.flushWhere((k) => belongsToWorkflow(k, workflowId)),
    [scheduler]
  );

  const createWorkflow = useCallback(
    async (name: string): Promise<WorkflowSummary | null> => {
      try {
        const created = await api.createWorkflow(workspaceId, { name });
        await qc.invalidateQueries({ queryKey: listQueryKey(workspaceId) });
        return created;
      } catch (err) {
        reportSaveError("create workflow", err);
        return null;
      }
    },
    [qc, workspaceId]
  );

  const updateWorkflow = useCallback(
    (id: string, patch: { name?: string; description?: string | null }) => {
      qc.setQueryData<WorkflowSummary[]>(listQueryKey(workspaceId), (prev) =>
        prev?.map((w) => (w.id === id ? { ...w, ...patch } : w))
      );
      qc.setQueryData<WorkflowDetail>(detailQueryKey(workspaceId, id), (prev) =>
        prev ? { ...prev, ...patch } : prev
      );
      scheduler.schedule(wfKey(id), patch, (merged) =>
        api
          .updateWorkflow(workspaceId, id, merged)
          // Rename regenerates the slug server-side; refresh the list so the
          // cached WorkflowSummary.slug (and the URL synced off it) stops being
          // stale. List-only — invalidating the detail here would clobber other
          // in-flight optimistic step edits.
          .then(() => qc.invalidateQueries({ queryKey: listQueryKey(workspaceId) }))
          .catch((err) => {
            reportSaveError("workflow", err);
            invalidate(id);
          })
          .finally(() => settleAfterSave())
      );
    },
    [qc, workspaceId, scheduler, invalidate, settleAfterSave]
  );

  const deleteWorkflow = useCallback(
    async (id: string) => {
      try {
        // The workflow is going away — drop its pending saves so a late timer
        // can't re-issue a PATCH against a deleted row.
        scheduler.cancelWhere((k) => belongsToWorkflow(k, id));
        await api.deleteWorkflow(workspaceId, id);
        qc.removeQueries({ queryKey: detailQueryKey(workspaceId, id) });
        await qc.invalidateQueries({ queryKey: listQueryKey(workspaceId) });
      } catch (err) {
        reportSaveError("delete workflow", err);
      }
    },
    [qc, workspaceId, scheduler]
  );

  const addStep = useCallback(
    async (workflowId: string, connectFrom?: string): Promise<string | null> => {
      try {
        await flushWorkflow(workflowId);
        const ref = `step-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const nodeId = await api.addStep(workspaceId, workflowId, {
          ref,
          title: "New step",
          connect_from: connectFrom,
        });
        invalidate(workflowId);
        return nodeId;
      } catch (err) {
        reportSaveError("add step", err);
        return null;
      }
    },
    [workspaceId, invalidate, flushWorkflow]
  );

  const patchStep = useCallback(
    (
      workflowId: string,
      nodeId: string,
      wire: NodeContentInput,
      optimistic: Partial<WorkflowStep>,
      opts?: { debounce?: boolean }
    ) => {
      patchDetailNode(workflowId, nodeId, optimistic);
      if (opts?.debounce) {
        scheduler.schedule(stepKey(workflowId, nodeId), wire, (merged) =>
          api
            .updateStep(workspaceId, workflowId, nodeId, merged)
            .catch((err) => {
              reportSaveError("step", err);
              invalidate(workflowId);
            })
            .finally(() => settleAfterSave())
        );
        return;
      }
      // Immediate reads/actions edit — flush pending text first so the
      // invalidate below can't revert an unsent title/description.
      void (async () => {
        try {
          await flushWorkflow(workflowId);
          await api.updateStep(workspaceId, workflowId, nodeId, wire);
          invalidate(workflowId);
        } catch (err) {
          reportSaveError("step", err);
          invalidate(workflowId);
        }
      })();
    },
    [workspaceId, patchDetailNode, scheduler, invalidate, flushWorkflow, settleAfterSave]
  );

  const removeStep = useCallback(
    async (workflowId: string, nodeId: string) => {
      try {
        // Drop pending saves for the doomed step + any edge on it (a queued
        // condition edit would otherwise re-insert an edge we're deleting),
        // then flush the rest of the workflow's edits before the DELETE.
        scheduler.cancelWhere((k) => touchesStep(k, workflowId, nodeId));
        await flushWorkflow(workflowId);
        await api.removeStep(workspaceId, workflowId, nodeId);
        invalidate(workflowId);
      } catch (err) {
        reportSaveError("remove step", err);
        invalidate(workflowId);
      }
    },
    [workspaceId, invalidate, flushWorkflow, scheduler]
  );

  const connectSteps = useCallback(
    (
      workflowId: string,
      from: string,
      to: string,
      condition: string,
      opts?: { debounce?: boolean }
    ) => {
      // Condition-only edits (existing edge) upsert via the same connect
      // route; debounce those. New connections apply immediately.
      if (opts?.debounce) {
        qc.setQueryData<WorkflowDetail>(detailQueryKey(workspaceId, workflowId), (prev) => {
          if (!prev?.graph) return prev;
          return {
            ...prev,
            graph: {
              ...prev.graph,
              edges: prev.graph.edges.map((e) =>
                e.from === from && e.to === to ? { ...e, condition } : e
              ),
            },
          };
        });
        scheduler.schedule(edgeKey(workflowId, from, to), { condition }, (merged) =>
          // No success-path invalidate: a condition edit is optimistic like a
          // step text edit (see patchStep's debounced branch); refetching mid-
          // type reverts the controlled input and flickers. Errors still
          // invalidate to re-sync truth; the immediate-connect path below
          // invalidates because it changes topology.
          api
            .connectSteps(workspaceId, workflowId, from, to, merged.condition)
            .catch((err) => {
              reportSaveError("connection", err);
              invalidate(workflowId);
            })
            .finally(() => settleAfterSave())
        );
        return;
      }
      void (async () => {
        try {
          await flushWorkflow(workflowId);
          await api.connectSteps(workspaceId, workflowId, from, to, condition);
          invalidate(workflowId);
        } catch (err) {
          reportSaveError("connection", err);
          invalidate(workflowId);
        }
      })();
    },
    [qc, workspaceId, scheduler, invalidate, flushWorkflow, settleAfterSave]
  );

  const disconnectSteps = useCallback(
    async (workflowId: string, from: string, to: string) => {
      try {
        // Cancel any queued condition edit for THIS edge first — otherwise its
        // timer fires after the DELETE and resurrects the edge.
        scheduler.cancel(edgeKey(workflowId, from, to));
        await flushWorkflow(workflowId);
        await api.disconnectSteps(workspaceId, workflowId, from, to);
        invalidate(workflowId);
      } catch (err) {
        reportSaveError("disconnect", err);
        invalidate(workflowId);
      }
    },
    [workspaceId, invalidate, flushWorkflow, scheduler]
  );

  return {
    workflows: listQuery.data ?? [],
    listStatus: statusOf(listQuery),
    detail: selectedWorkflowId ? detailQuery.data ?? null : null,
    detailStatus: statusOf(detailQuery),
    refetchDetail: () => {
      if (selectedWorkflowId) void detailQuery.refetch();
    },
    ops: {
      createWorkflow,
      updateWorkflow,
      deleteWorkflow,
      addStep,
      patchStep,
      removeStep,
      connectSteps,
      disconnectSteps,
    },
  };
}

function statusOf(q: { isError: boolean; data: unknown }): QueryStatus {
  if (q.data !== undefined) return "ready";
  if (q.isError) return "error";
  return "loading";
}

function reportSaveError(what: string, err: unknown): void {
  toast({
    title: `Couldn't save ${what}`,
    description: err instanceof Error ? err.message : "Unknown error",
  });
}
