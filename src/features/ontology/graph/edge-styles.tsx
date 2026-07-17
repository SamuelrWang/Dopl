import type { EdgeStyle } from "@/shared/graph";
import type { SceneEdgeKind } from "./types";

/**
 * The ontology graph's three edge classes, passed to the shared EdgeLayer:
 * containment dashed, relationships solid + arrow + label pill, ref
 * attributes dotted. Kept next to the ontology graph so the shared drawing
 * layer stays domain-agnostic.
 */
export const ONTOLOGY_EDGE_STYLES: Record<SceneEdgeKind, EdgeStyle> = {
  containment: { stroke: "var(--border-highlight)", dash: "3 5", width: 1.5 },
  relationship: { stroke: "var(--text-secondary)", width: 1.5, marker: "url(#og-arrow)" },
  ref: { stroke: "var(--text-muted)", dash: "1.5 4", width: 1.5, marker: "url(#og-arrow-muted)" },
};

/** Arrowhead marker defs referenced by the relationship/ref styles above. */
export function OntologyEdgeMarkers() {
  return (
    <>
      <marker
        id="og-arrow"
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
        id="og-arrow-muted"
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
