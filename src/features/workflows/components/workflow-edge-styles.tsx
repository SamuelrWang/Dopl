import type { EdgeStyle } from "@/shared/graph";

/**
 * Two edge classes for the workflow graph: a plain `sequence` (do this
 * next) and a conditioned `branch` (do this next WHEN … — the condition
 * rides the edge as a label pill). Both point right with an arrowhead.
 */
export const WORKFLOW_EDGE_STYLES: Record<string, EdgeStyle> = {
  sequence: { stroke: "var(--text-muted)", width: 1.5, marker: "url(#wf-arrow-muted)" },
  branch: { stroke: "var(--text-secondary)", width: 1.75, marker: "url(#wf-arrow)" },
};

export function WorkflowEdgeMarkers() {
  return (
    <>
      <marker
        id="wf-arrow"
        viewBox="0 0 8 8"
        refX="7"
        refY="4"
        markerWidth="7"
        markerHeight="7"
        orient="auto-start-reverse"
      >
        <path d="M0.5 0.8 L7 4 L0.5 7.2" fill="none" stroke="var(--text-secondary)" strokeWidth="1.4" />
      </marker>
      <marker
        id="wf-arrow-muted"
        viewBox="0 0 8 8"
        refX="7"
        refY="4"
        markerWidth="7"
        markerHeight="7"
        orient="auto-start-reverse"
      >
        <path d="M0.5 0.8 L7 4 L0.5 7.2" fill="none" stroke="var(--text-muted)" strokeWidth="1.4" />
      </marker>
    </>
  );
}
