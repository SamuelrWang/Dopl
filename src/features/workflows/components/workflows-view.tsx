"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Workflow } from "lucide-react";
import { EmptyState } from "@/shared/ui/empty-state";
import { cn } from "@/shared/lib/utils";
import type { WorkflowGraph } from "../client/types";
import { WorkflowResourcesProvider } from "../hooks/use-workflow-resources";
import { useWorkflows } from "../hooks/use-workflows";
import { StepPanel } from "./step-panel";
import { WorkflowGraphView } from "./workflow-graph";
import { WORKFLOW_EDGE_STYLES } from "./workflow-edge-styles";
import { WorkflowBoardSkeleton, WorkflowsSkeleton } from "./workflows-skeleton";

interface Props {
  workspaceId: string;
  /** Canonical `{slug}-{publicId}` segment — used to keep the URL in sync. */
  workspaceSegment: string;
  /** Deep-linked workflow (`/[ws]/workflows/[workflowSlug]`); first when omitted. */
  initialWorkflowSlug?: string;
  /** Member+ — viewers read the workflow but see no create/edit affordances. */
  canEdit?: boolean;
  /**
   * How the address bar follows the server-canonical workflow slug. Defaults
   * to `history.replaceState` with the path URL — what the Next app has always
   * done, and why the RSC pages pass nothing (a server component cannot hand a
   * function to a client component anyway).
   *
   * The desktop SPA injects its hash-router equivalent: the packaged renderer
   * is a `file://` document where replacing the path is a Chromium security
   * error, so the same intent has to travel through the router there.
   */
  replaceUrl?: (path: string) => void;
}

const EMPTY_GRAPH: WorkflowGraph = { nodes: [], edges: [] };

/** Module-level so the default is referentially stable across renders — the
 *  slug-sync effect depends on it. */
const replaceHistoryUrl = (path: string): void =>
  window.history.replaceState(null, "", path);

/**
 * Workflows page root. A tab strip of workflows over the graph substrate:
 * each workflow is an agent-followable step DAG. Selecting a step opens the
 * StepPanel editor; every edit persists through use-workflows. Chrome
 * mirrors the ontology view (page-float frame, concave-track tabs, inline
 * name/purpose inputs, slug-addressed active tab).
 */
export function WorkflowsView({
  workspaceId,
  workspaceSegment,
  initialWorkflowSlug,
  canEdit = true,
  replaceUrl = replaceHistoryUrl,
}: Props) {
  const [tabId, setTabId] = useState<string | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Surfaced up from the graph: the reset-to-auto-layout fn, or null when no
  // step has been dragged. Stored as a thunk so setState doesn't invoke it.
  const [resetLayout, setResetLayout] = useState<(() => void) | null>(null);
  const handleLayoutResetChange = useCallback(
    (reset: (() => void) | null) => setResetLayout(() => reset),
    []
  );

  const { workflows, listStatus, detail, detailStatus, ops } = useWorkflows(
    workspaceId,
    tabId
  );

  const active =
    workflows.find((w) => w.id === tabId) ??
    workflows.find((w) => w.slug === initialWorkflowSlug) ??
    workflows[0] ??
    null;

  // Default the active tab to the deep-linked slug (or the first workflow)
  // once the list lands, so the detail query has an id to load.
  useEffect(() => {
    if (tabId !== null || workflows.length === 0) return;
    const initial =
      workflows.find((w) => w.slug === initialWorkflowSlug) ?? workflows[0];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTabId(initial.id);
  }, [tabId, workflows, initialWorkflowSlug]);

  // Keep the URL's slug fresh whenever the active workflow's slug changes —
  // a rename regenerates the slug server-side (list invalidation lands the new
  // one), and selectTab only syncs on a tab switch, so without this the address
  // bar keeps the pre-rename slug.
  const activeSlug = active?.slug;
  useEffect(() => {
    if (!activeSlug) return;
    replaceUrl(`/${workspaceSegment}/workflows/${activeSlug}`);
  }, [activeSlug, workspaceSegment, replaceUrl]);

  const graph = detail?.graph ?? EMPTY_GRAPH;
  const activeStep = selectedStepId
    ? graph.nodes.find((n) => n.id === selectedStepId) ?? null
    : null;

  const selectTab = (id: string) => {
    setTabId(id);
    setSelectedStepId(null);
    setConfirmDelete(false);
    const slug = workflows.find((w) => w.id === id)?.slug;
    if (slug) {
      replaceUrl(`/${workspaceSegment}/workflows/${slug}`);
    }
  };

  const handleCreate = async () => {
    const created = await ops.createWorkflow("New workflow");
    if (created) selectTab(created.id);
  };

  const handleDelete = async () => {
    if (!active) return;
    await ops.deleteWorkflow(active.id);
    setTabId(null);
    setSelectedStepId(null);
    setConfirmDelete(false);
  };

  const handleAddStep = async () => {
    if (!active) return;
    const nodeId = await ops.addStep(active.id);
    if (nodeId) setSelectedStepId(nodeId);
  };

  if (listStatus === "loading") {
    return (
      <Frame>
        <WorkflowsSkeleton />
      </Frame>
    );
  }
  if (listStatus === "error") {
    return (
      <Frame>
        <p className="m-auto text-lead text-danger">
          Couldn&apos;t load workflows. Refresh to retry.
        </p>
      </Frame>
    );
  }
  if (workflows.length === 0 || !active) {
    return (
      <Frame>
        <div className="m-auto">
          <EmptyState
            icon={Workflow}
            title="No workflows yet"
            description={
              canEdit
                ? "A workflow is an agent-followable sequence of steps. Create one here, or let an agent author one with the dopl_workflow tool."
                : "A workspace member can create the first workflow, or an agent can author one with the dopl_workflow tool."
            }
          >
            {canEdit && (
              <button
                type="button"
                onClick={handleCreate}
                className="auth-btn-3d mt-1 rounded-lg px-4 py-2 text-lead font-semibold text-white"
              >
                New workflow
              </button>
            )}
          </EmptyState>
        </div>
      </Frame>
    );
  }

  return (
    <WorkflowResourcesProvider workspaceId={workspaceId}>
      <Frame>
        <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-3 py-2">
          <div className="concave-track flex items-center gap-1">
            {workflows.map((w) => {
              const count =
                w.id === active.id && detail?.graph
                  ? detail.graph.nodes.length
                  : w.stepCount;
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => selectTab(w.id)}
                  className={cn(
                    "flex h-6 items-center gap-1.5 rounded-[6px] px-2.5 text-caption font-medium transition-colors",
                    w.id === active.id
                      ? "raised-tab text-text-primary"
                      : "text-text-secondary hover:text-text-primary"
                  )}
                >
                  {w.name}
                  <span className="text-micro text-text-muted">{count}</span>
                </button>
              );
            })}
            {canEdit && (
              <button
                type="button"
                onClick={handleCreate}
                aria-label="New workflow"
                className="flex h-6 w-6 items-center justify-center rounded-[6px] text-text-muted transition hover:text-text-primary"
              >
                <Plus size={12} />
              </button>
            )}
          </div>

          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            <input
              type="text"
              value={active.name}
              readOnly={!canEdit}
              onChange={(e) => ops.updateWorkflow(active.id, { name: e.target.value })}
              aria-label="Workflow name"
              className="w-44 shrink-0 bg-transparent text-title font-semibold tracking-tight text-text-primary placeholder:text-text-muted focus:outline-none"
              placeholder="Workflow name"
            />
            <input
              type="text"
              value={active.description ?? ""}
              readOnly={!canEdit}
              onChange={(e) => ops.updateWorkflow(active.id, { description: e.target.value })}
              aria-label="Workflow purpose"
              className="min-w-0 flex-1 bg-transparent text-body text-text-secondary placeholder:text-text-muted focus:outline-none"
              placeholder="What this workflow does (agents read this to route)…"
            />
          </div>

          {canEdit && (
            <>
              {confirmDelete ? (
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="rounded-md bg-danger/10 px-2 py-1 text-caption font-semibold text-danger"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="btn-light rounded-md px-2 py-1 text-caption font-medium text-text-primary"
                  >
                    Keep
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  aria-label={`Delete ${active.name || "workflow"}`}
                  title="Delete workflow"
                  onClick={() => setConfirmDelete(true)}
                  className="btn-light flex h-7 w-8 shrink-0 items-center justify-center rounded-md text-text-primary"
                >
                  <Trash2 size={11} />
                </button>
              )}
              <button
                type="button"
                onClick={handleAddStep}
                className="btn-light flex h-7 shrink-0 items-center gap-1 rounded-md px-2.5 text-small font-medium text-text-primary"
              >
                <Plus size={12} /> Step
              </button>
            </>
          )}
          {canEdit && resetLayout && (
            <button
              type="button"
              onClick={resetLayout}
              title="Reset to auto layout"
              className="btn-light flex h-7 shrink-0 items-center rounded-md px-2.5 text-small font-medium text-text-primary"
            >
              Reset layout
            </button>
          )}
          <Legend />
        </div>

        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          {detailStatus === "loading" ? (
            <WorkflowBoardSkeleton />
          ) : (
            <>
              <WorkflowGraphView
                key={active.id}
                workflowId={active.id}
                graph={graph}
                storedLayout={detail?.layout ?? {}}
                selectedId={activeStep?.id ?? null}
                canEdit={canEdit}
                ops={ops}
                onSelect={setSelectedStepId}
                onAddStep={handleAddStep}
                onLayoutResetChange={handleLayoutResetChange}
              />
              {activeStep && (
                <div className="absolute inset-y-1 right-1 z-20 flex">
                  <StepPanel
                    workflowId={active.id}
                    step={activeStep}
                    graph={graph}
                    canEdit={canEdit}
                    ops={ops}
                    onClose={() => setSelectedStepId(null)}
                    onSelectStep={setSelectedStepId}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </Frame>
    </WorkflowResourcesProvider>
  );
}

// Edge swatches read their stroke width / dash / color from the shared
// WORKFLOW_EDGE_STYLES so the legend can't drift from the drawn edges (the
// branch edge is 1.75px, not the hand-rolled 1.5 it used to show).
const EDGE_LEGEND: Array<{ kind: keyof typeof WORKFLOW_EDGE_STYLES; label: string }> = [
  { kind: "sequence", label: "sequence" },
  { kind: "branch", label: "branch" },
];

function Legend() {
  return (
    <div className="flex shrink-0 items-center gap-3">
      <span className="flex items-center gap-1.5">
        <span
          className="rounded-full border border-border-strong bg-bg-inset px-1.5 text-micro font-semibold uppercase tracking-wide text-text-secondary"
          aria-hidden
        >
          entry
        </span>
      </span>
      {EDGE_LEGEND.map(({ kind, label }) => {
        const style = WORKFLOW_EDGE_STYLES[kind];
        return (
          <span key={label} className="flex items-center gap-1.5">
            <svg width={20} height={6} aria-hidden className="overflow-visible">
              <line
                x1={0}
                y1={3}
                x2={20}
                y2={3}
                stroke={style.stroke}
                strokeWidth={style.width}
                strokeDasharray={style.dash}
              />
            </svg>
            <span className="text-micro text-text-muted">{label}</span>
          </span>
        );
      })}
    </div>
  );
}

/** The one raised .page-float card above the shell's sidebar panel. */
function Frame({ children }: { children?: React.ReactNode }) {
  return <div className="page-float flex flex-col antialiased">{children}</div>;
}
