"use client";

/**
 * useClusterAttachmentSync — keeps the `cluster_knowledge_bases` and
 * `cluster_skills` junction tables in sync with the canvas's visible
 * cluster ↔ KB/Skill membership.
 *
 * Behaviour:
 *  - When a KB or Skill panel is added to a cluster on the canvas, POST
 *    the corresponding attach endpoint. The server upserts so re-attach
 *    is idempotent.
 *  - When a panel is dragged OUT of a cluster (REMOVE_PANEL_FROM_CLUSTER),
 *    DELETE the attachment.
 *  - When a panel is closed (CLOSE_PANEL), the attachment row STAYS so the
 *    agent still sees the relationship. The user must explicitly detach
 *    via the panel header menu.
 *
 * Drag-out vs close discrimination is done by tracking — per (clusterId,
 * refId) pair — exactly which panel ids were contributing to that pair.
 * If the SAME panel id that contributed last tick still exists in
 * state.panels but is no longer in the cluster's panelIds, that's a
 * drag-out (DETACH). If every contributing panel id is gone from
 * state.panels, the user closed them — preserve the attachment.
 *
 * On first mount, last-seen state is seeded silently from the current
 * canvas — we don't fire a POST for every pre-existing attachment.
 *
 * Concurrency:
 *  - Ops are serialized PER (kind, clusterSlug, refId) tuple so a fast
 *    drag-in / drag-out doesn't race on the wire (attach lands after
 *    detach, leaving the row stuck attached). Different pairs still run
 *    in parallel.
 *  - Failed ops do NOT commit their pair into `lastRef`, so the next
 *    render diff re-fires them. Successful ops commit.
 */

import { useEffect, useRef } from "react";
import { useCanvas, useCanvasScope } from "./canvas-store";
import type { Cluster, Panel } from "./types";

type OpKind = "attach-kb" | "detach-kb" | "attach-skill" | "detach-skill";

interface PendingOp {
  kind: OpKind;
  clusterId: string;
  clusterSlug: string;
  refId: string;
}

/** Map<clusterId, Map<refId, Set<panelId>>>. */
type ContributorMap = Map<string, Map<string, Set<string>>>;

// Per-pair op queue lives at module scope so concurrent renders share
// the same serialization. Keyed by `${kind-side}:${clusterId}:${refId}`
// (kind-side = "kb" or "skill"; attach + detach for the same pair share
// a queue so they can't reorder in flight).
const pairQueues = new Map<string, Promise<unknown>>();

function pairKey(op: PendingOp): string {
  const side = op.kind === "attach-kb" || op.kind === "detach-kb" ? "kb" : "skill";
  return `${side}:${op.clusterId}:${op.refId}`;
}

export function useClusterAttachmentSync(): void {
  const { state } = useCanvas();
  const scope = useCanvasScope();

  const lastKbRef = useRef<ContributorMap>(new Map());
  const lastSkillRef = useRef<ContributorMap>(new Map());
  const initializedForWorkspaceRef = useRef<string | null>(null);

  useEffect(() => {
    if (!scope?.workspaceId) return;

    const currentKb = computeContributors(state.clusters, state.panels, "knowledge-base");
    const currentSkill = computeContributors(state.clusters, state.panels, "skill");

    // First effect run for a given workspace: seed baseline silently.
    if (initializedForWorkspaceRef.current !== scope.workspaceId) {
      lastKbRef.current = currentKb;
      lastSkillRef.current = currentSkill;
      initializedForWorkspaceRef.current = scope.workspaceId;
      return;
    }

    const slugByClusterId = new Map<string, string>();
    for (const c of state.clusters) {
      if (c.slug) slugByClusterId.set(c.id, c.slug);
    }

    const ops: PendingOp[] = [];
    diffSide(
      currentKb,
      lastKbRef.current,
      state.panels,
      slugByClusterId,
      "knowledge-base",
      ops
    );
    diffSide(
      currentSkill,
      lastSkillRef.current,
      state.panels,
      slugByClusterId,
      "skill",
      ops
    );

    if (ops.length === 0) return;

    // Speculatively commit current state into the refs as the optimistic
    // baseline. After ops resolve, we ROLL BACK any pair whose op failed
    // so the next render diff re-fires it. Successful pairs stay
    // committed.
    const previousKb = lastKbRef.current;
    const previousSkill = lastSkillRef.current;
    lastKbRef.current = currentKb;
    lastSkillRef.current = currentSkill;

    void runOps(ops, scope.workspaceId).then((failed) => {
      if (failed.length === 0) return;
      // Roll back failed pairs to whatever the previous baseline said.
      // Effect re-runs naturally on next state change; if no further
      // change happens, we stay desynced — but the user's next action
      // will retry. (TODO: add retry-on-mount or polling.)
      for (const op of failed) {
        const side = op.kind === "attach-kb" || op.kind === "detach-kb" ? "kb" : "skill";
        const lastRef = side === "kb" ? lastKbRef : lastSkillRef;
        const previous = side === "kb" ? previousKb : previousSkill;
        rollbackPair(lastRef.current, previous, op.clusterId, op.refId);
      }
    });
  }, [state.panels, state.clusters, scope?.workspaceId]);
}

function rollbackPair(
  current: ContributorMap,
  previous: ContributorMap,
  clusterId: string,
  refId: string
): void {
  const prevCluster = previous.get(clusterId);
  const prevContributors = prevCluster?.get(refId);
  const currCluster = current.get(clusterId) ?? new Map<string, Set<string>>();
  if (!current.has(clusterId)) current.set(clusterId, currCluster);
  if (prevContributors === undefined) {
    // Pair didn't exist before → roll back means "remove from current"
    // so the next render's diff will re-add it.
    currCluster.delete(refId);
  } else {
    // Pair existed before → restore exactly that contributor set.
    currCluster.set(refId, new Set(prevContributors));
  }
}

function diffSide(
  current: ContributorMap,
  last: ContributorMap,
  livePanels: ReadonlyArray<Panel>,
  slugByClusterId: Map<string, string>,
  panelType: "knowledge-base" | "skill",
  ops: PendingOp[]
): void {
  const livePanelIds = new Set(livePanels.map((p) => p.id));

  // ATTACH: any (cluster, ref) in current that wasn't in last.
  for (const [clusterId, currentRefs] of current) {
    const slug = slugByClusterId.get(clusterId);
    if (!slug) continue;
    const lastRefs = last.get(clusterId);
    for (const refId of currentRefs.keys()) {
      if (!lastRefs || !lastRefs.has(refId)) {
        ops.push({
          kind: panelType === "knowledge-base" ? "attach-kb" : "attach-skill",
          clusterId,
          clusterSlug: slug,
          refId,
        });
      }
    }
  }

  // DETACH: a (cluster, ref) that was in last but no longer in current,
  // and at least one of its contributing panels is still alive (drag-out).
  for (const [clusterId, lastRefs] of last) {
    const slug = slugByClusterId.get(clusterId);
    if (!slug) continue;
    const currentRefs = current.get(clusterId);
    for (const [refId, lastContributors] of lastRefs) {
      if (currentRefs && currentRefs.has(refId)) continue;
      let anyContributorAlive = false;
      for (const panelId of lastContributors) {
        if (livePanelIds.has(panelId)) {
          anyContributorAlive = true;
          break;
        }
      }
      if (!anyContributorAlive) continue;
      ops.push({
        kind: panelType === "knowledge-base" ? "detach-kb" : "detach-skill",
        clusterId,
        clusterSlug: slug,
        refId,
      });
    }
  }
}

function computeContributors(
  clusters: ReadonlyArray<Cluster>,
  panels: ReadonlyArray<Panel>,
  panelType: "knowledge-base" | "skill"
): ContributorMap {
  const byId = new Map<string, Panel>();
  for (const p of panels) byId.set(p.id, p);
  const out: ContributorMap = new Map();
  for (const c of clusters) {
    const refMap = new Map<string, Set<string>>();
    for (const pid of c.panelIds) {
      const p = byId.get(pid);
      if (!p) continue;
      let refId: string | null = null;
      if (panelType === "knowledge-base" && p.type === "knowledge-base") {
        refId = p.knowledgeBaseId;
      } else if (panelType === "skill" && p.type === "skill") {
        refId = p.skillId;
      }
      if (!refId) continue;
      const set = refMap.get(refId) ?? new Set<string>();
      set.add(pid);
      refMap.set(refId, set);
    }
    out.set(c.id, refMap);
  }
  return out;
}

/**
 * Execute ops with per-pair serialization. Returns the ops that failed
 * (network or 4xx/5xx) so the caller can roll back baseline for them.
 */
async function runOps(
  ops: PendingOp[],
  workspaceId: string
): Promise<PendingOp[]> {
  const results = await Promise.all(
    ops.map((op) => enqueueForPair(op, workspaceId))
  );
  return results.filter((r): r is PendingOp => r !== null);
}

/**
 * Chain `op` onto the existing promise for its pair so attach + detach
 * for the same (cluster, ref) execute serially in dispatch order.
 * Resolves to `null` on success, the `op` itself on failure.
 */
function enqueueForPair(
  op: PendingOp,
  workspaceId: string
): Promise<PendingOp | null> {
  const key = pairKey(op);
  const prev = pairQueues.get(key) ?? Promise.resolve();
  const next = prev.then(() => executeOp(op, workspaceId));
  // Keep the queue moving even when a prior task throws — but only chain
  // the SUCCESS-resolved promise. The error case is captured below.
  pairQueues.set(
    key,
    next.catch(() => undefined)
  );
  return next.then(
    () => null,
    () => op
  );
}

async function executeOp(op: PendingOp, workspaceId: string): Promise<void> {
  let res: Response;
  try {
    if (op.kind === "attach-kb") {
      res = await fetch(
        `/api/clusters/${encodeURIComponent(op.clusterSlug)}/knowledge-bases`,
        {
          method: "POST",
          headers: jsonHeaders(workspaceId),
          body: JSON.stringify({ knowledge_base_id: op.refId }),
          credentials: "same-origin",
        }
      );
    } else if (op.kind === "detach-kb") {
      res = await fetch(
        `/api/clusters/${encodeURIComponent(op.clusterSlug)}/knowledge-bases/${encodeURIComponent(op.refId)}`,
        {
          method: "DELETE",
          headers: { "x-workspace-id": workspaceId },
          credentials: "same-origin",
        }
      );
    } else if (op.kind === "attach-skill") {
      res = await fetch(
        `/api/clusters/${encodeURIComponent(op.clusterSlug)}/skills`,
        {
          method: "POST",
          headers: jsonHeaders(workspaceId),
          body: JSON.stringify({ skill_id: op.refId }),
          credentials: "same-origin",
        }
      );
    } else {
      res = await fetch(
        `/api/clusters/${encodeURIComponent(op.clusterSlug)}/skills/${encodeURIComponent(op.refId)}`,
        {
          method: "DELETE",
          headers: { "x-workspace-id": workspaceId },
          credentials: "same-origin",
        }
      );
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`cluster-attachment-sync: ${op.kind} network error`, op, err);
    throw err;
  }
  if (!res.ok) {
    // eslint-disable-next-line no-console
    console.warn(
      `cluster-attachment-sync: ${op.kind} HTTP ${res.status}`,
      op.clusterSlug,
      op.refId
    );
    throw new Error(`HTTP ${res.status}`);
  }
}

function jsonHeaders(workspaceId: string): HeadersInit {
  return {
    "content-type": "application/json",
    "x-workspace-id": workspaceId,
  };
}
