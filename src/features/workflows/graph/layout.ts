import type { NodeLayout, SceneEdge, SceneLayout } from "@/shared/graph";
import type { WorkflowStep } from "../types";

/**
 * Layered DAG layout for a workflow's step graph. Chosen orientation:
 * **left-to-right ranks, cards stacked top-to-bottom within a rank.**
 * Cards are 280px wide (wider than tall), so ranks become narrow vertical
 * columns and a workflow reads as a left→right sequence — matching how the
 * step list flows and how the ontology substrate already stacks lane cards.
 * Branches fan downward within the next rank; branch conditions ride the
 * horizontal edge segment between columns as label pills.
 *
 * Rank = longest-path depth from an entry step (indegree 0), so every edge
 * points from a lower rank to a strictly higher one and all connectors flow
 * one direction. Within a rank, nodes are ordered by the barycenter (mean
 * position) of their predecessors to reduce crossings, tie-broken by input
 * order for determinism. Fully disconnected steps (no edges at all) park in
 * a trailing rank so they never crowd the real entry column.
 */

export const CARD_WIDTH = 280;
export const COL_GAP = 200;
export const COL_PITCH = CARD_WIDTH + COL_GAP;
export const MARGIN_X = 120;
export const TOP_Y = 80;
export const VGAP = 56;
export const DEFAULT_HEIGHT = 150;
const WORLD_PADDING = 140;
export const MIN_WORLD_WIDTH = 1000;
export const MIN_WORLD_HEIGHT = 640;

const STAGGER = 22;
const T_CYCLE = [0.32, 0.5, 0.68] as const;

interface Edge {
  from: string;
  to: string;
  condition: string;
}

export interface WorkflowRanking {
  /** rank index per step id. */
  rankOf: Map<string, number>;
  /** ordered step ids per rank (index = rank). */
  ranks: string[][];
}

function heightOf(id: string, heights: Record<string, number>): number {
  return heights[id] ?? DEFAULT_HEIGHT;
}

// 0, +22, -22, +44, -44, … — separates parallel edges crossing one gap.
function staggerOffset(k: number): number {
  if (k === 0) return 0;
  const magnitude = Math.ceil(k / 2) * STAGGER;
  return k % 2 === 1 ? magnitude : -magnitude;
}

/**
 * Longest-path ranks + crossing-reduced within-rank order. Deterministic:
 * ranks derive from a topological pass over `nodes` (input order is the
 * server's topo/position order); within-rank order sorts by predecessor
 * barycenter with a stable input-order tie-break. Isolated steps (degree 0)
 * are collected into one trailing rank.
 */
export function rankWorkflow(nodes: WorkflowStep[], edges: Edge[]): WorkflowRanking {
  const ids = nodes.map((n) => n.id);
  const idSet = new Set(ids);
  const valid = edges.filter((e) => idSet.has(e.from) && idSet.has(e.to) && e.from !== e.to);

  const preds = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  const outdeg = new Map<string, number>();
  for (const id of ids) {
    preds.set(id, []);
    indeg.set(id, 0);
    outdeg.set(id, 0);
  }
  for (const e of valid) {
    preds.get(e.to)!.push(e.from);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
    outdeg.set(e.from, (outdeg.get(e.from) ?? 0) + 1);
  }

  const isolated = ids.filter((id) => (indeg.get(id) ?? 0) === 0 && (outdeg.get(id) ?? 0) === 0);
  const isolatedSet = new Set(isolated);

  // Longest-path rank via Kahn over the connected sub-graph. Cycles can't be
  // authored (server rejects), but guard anyway: any node the queue never
  // settles falls back to rank 0.
  const rankOf = new Map<string, number>();
  for (const id of ids) if (!isolatedSet.has(id)) rankOf.set(id, 0);
  const workIndeg = new Map(indeg);
  const succ = new Map<string, string[]>();
  for (const id of ids) succ.set(id, []);
  for (const e of valid) succ.get(e.from)!.push(e.to);

  const queue = ids.filter((id) => !isolatedSet.has(id) && (workIndeg.get(id) ?? 0) === 0);
  let processed = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    processed++;
    const r = rankOf.get(id) ?? 0;
    for (const next of succ.get(id) ?? []) {
      if (r + 1 > (rankOf.get(next) ?? 0)) rankOf.set(next, r + 1);
      const d = (workIndeg.get(next) ?? 1) - 1;
      workIndeg.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  // On a cycle (processed < connected count) leftover nodes keep rank 0 —
  // degenerate but total.
  void processed;

  const maxConnectedRank = rankOf.size > 0 ? Math.max(...rankOf.values()) : -1;
  const isolatedRank = maxConnectedRank + 1;
  for (const id of isolated) rankOf.set(id, isolatedRank);

  // Bucket ids into ranks, seeded in input order.
  const rankCount = Math.max(maxConnectedRank + 1, isolated.length > 0 ? isolatedRank + 1 : 0);
  const ranks: string[][] = Array.from({ length: rankCount }, () => []);
  const inputIndex = new Map(ids.map((id, i) => [id, i] as const));
  for (const id of ids) ranks[rankOf.get(id) ?? 0].push(id);

  // Barycenter ordering, left→right: each rank ordered by the mean order-
  // position of its predecessors in the already-ordered previous ranks.
  const orderPos = new Map<string, number>();
  ranks[0]?.forEach((id, i) => orderPos.set(id, i));
  for (let r = 1; r < ranks.length; r++) {
    const bary = new Map<string, number>();
    for (const id of ranks[r]) {
      const ps = (preds.get(id) ?? []).filter((p) => orderPos.has(p));
      const mean =
        ps.length > 0
          ? ps.reduce((sum, p) => sum + (orderPos.get(p) ?? 0), 0) / ps.length
          : Number.POSITIVE_INFINITY;
      bary.set(id, mean);
    }
    ranks[r].sort((a, b) => {
      const d = (bary.get(a) ?? 0) - (bary.get(b) ?? 0);
      if (d !== 0 && Number.isFinite(d)) return d;
      return (inputIndex.get(a) ?? 0) - (inputIndex.get(b) ?? 0);
    });
    ranks[r].forEach((id, i) => orderPos.set(id, i));
  }

  return { rankOf, ranks };
}

/** Positions every step: rank → x column, within-rank order → stacked y. */
export function layoutWorkflow(
  nodes: WorkflowStep[],
  edges: Edge[],
  heights: Record<string, number>
): SceneLayout & { ranking: WorkflowRanking } {
  const ranking = rankWorkflow(nodes, edges);
  const positions: Record<string, NodeLayout> = {};

  ranking.ranks.forEach((rankIds, rank) => {
    const x = MARGIN_X + rank * COL_PITCH;
    let y = TOP_Y;
    for (const id of rankIds) {
      positions[id] = { x, y, width: CARD_WIDTH };
      y += heightOf(id, heights) + VGAP;
    }
  });

  let maxRight = 0;
  let maxBottom = 0;
  for (const node of nodes) {
    const pos = positions[node.id];
    if (!pos) continue;
    maxRight = Math.max(maxRight, pos.x + pos.width);
    maxBottom = Math.max(maxBottom, pos.y + heightOf(node.id, heights));
  }

  return {
    positions,
    worldWidth: Math.max(MIN_WORLD_WIDTH, maxRight + WORLD_PADDING),
    worldHeight: Math.max(MIN_WORLD_HEIGHT, maxBottom + WORLD_PADDING),
    ranking,
  };
}

/**
 * Orthogonal routing hints for each edge. Every edge flows left→right
 * (source rank < target rank), so it exits the source's right side and
 * enters the target's left side; its vertical segment sits in the gap just
 * past the source rank. Parallel edges crossing the same gap are staggered
 * (offset `mid`, cycled `fromT`/`toT`) so they don't overlap. Branch
 * conditions become the edge `label`. Pure + deterministic.
 */
export function routeWorkflowEdges(
  edges: Edge[],
  layout: SceneLayout & { ranking: WorkflowRanking }
): SceneEdge[] {
  const gapCounters = new Map<number, number>();
  const out: SceneEdge[] = [];

  for (const e of edges) {
    const fromPos = layout.positions[e.from];
    const toPos = layout.positions[e.to];
    const id = `e:${e.from}:${e.to}`;
    if (!fromPos || !toPos) {
      out.push({ id, kind: "sequence", from: e.from, to: e.to, label: e.condition || undefined });
      continue;
    }
    const fromRank = layout.ranking.rankOf.get(e.from) ?? 0;
    const k = gapCounters.get(fromRank) ?? 0;
    gapCounters.set(fromRank, k + 1);

    const gapCenterX = fromPos.x + CARD_WIDTH + COL_GAP / 2;
    out.push({
      id,
      kind: e.condition ? "branch" : "sequence",
      from: e.from,
      to: e.to,
      label: e.condition || undefined,
      fromSide: "right",
      toSide: "left",
      fromT: T_CYCLE[k % T_CYCLE.length],
      toT: T_CYCLE[(k + 1) % T_CYCLE.length],
      mid: gapCenterX + staggerOffset(k),
    });
  }

  return out;
}
