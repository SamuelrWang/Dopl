import type {
  OntologyObject,
  OntologySnapshot,
  TemplateField,
} from "@/features/ontology/types";

/**
 * Data layer for the playground ONTOLOGY pane: one render-ready shape
 * (`PaneCluster` → `PaneLane` → `PaneCard`) that both sources feed —
 * the static marketing demo below, and `snapshotToClusters` mapping the real
 * `GET /api/ontology` response (`features/ontology/types › OntologySnapshot`)
 * once a playground session exists.
 */

export interface PaneCard {
  id: string;
  name: string;
  subtitle: string;
  /** Attribute chips — flat pills, per the design-system "on cards" recipe. */
  chips: string[];
  attrs: number;
  edges: number;
  actions: number;
}

export interface PaneLane {
  id: string;
  name: string;
  subtitle: string;
  fields: { label: string; kind: string }[];
  cards: PaneCard[];
}

export interface PaneCluster {
  id: string;
  name: string;
  purpose: string;
  /** Pill count — column count, like the real view's `columnIds.length`. */
  count: number;
  lanes: PaneLane[];
}

/** Mirrors `features/ontology/components/template-editor › KIND_LABELS`
 *  (not imported: that module carries the whole editor component). */
const KIND_LABELS: Record<TemplateField["kind"], string> = {
  text: "Text",
  pill: "Tag",
  ref: "Object",
  knowledge: "Knowledge",
  skill: "Skill",
};

/**
 * Real snapshot → pane shape. Columns are the cluster's `columnIds` resolved
 * through `objects`; cards are each column's `childIds`. Dangling ids (mid-poll
 * deletes) are dropped, so an empty or half-edited workspace renders as empty
 * lanes rather than crashing.
 */
export function snapshotToClusters(snapshot: OntologySnapshot): PaneCluster[] {
  const objects = snapshot.objects ?? {};
  return (snapshot.clusters ?? []).map((cluster) => {
    const columns = (cluster.columnIds ?? [])
      .map((id) => objects[id])
      .filter((col): col is OntologyObject => Boolean(col));
    return {
      id: cluster.id,
      name: cluster.name,
      purpose: cluster.purpose,
      count: columns.length,
      lanes: columns.map((col) => ({
        id: col.id,
        name: col.name,
        subtitle: col.subtitle,
        fields: (col.template ?? []).map((f) => ({
          label: f.label,
          kind: KIND_LABELS[f.kind] ?? f.kind,
        })),
        cards: (col.childIds ?? [])
          .map((id) => objects[id])
          .filter((obj): obj is OntologyObject => Boolean(obj))
          .map(toCard),
      })),
    };
  });
}

/** Chips = the object's pill-kind attribute values (short, flat strings). */
function toCard(obj: OntologyObject): PaneCard {
  return {
    id: obj.id,
    name: obj.name,
    subtitle: obj.subtitle,
    chips: (obj.attributes ?? []).flatMap((attr) =>
      attr.value.kind === "pill" && attr.value.value.trim()
        ? [attr.value.value.trim()]
        : []
    ),
    attrs: obj.attributes?.length ?? 0,
    edges: obj.relationships?.length ?? 0,
    actions: obj.methods?.length ?? 0,
  };
}

/**
 * Static demo content — the marketing preview shown before a session starts,
 * themed on the "how to use Dopl" starter corpus
 * (`features/workspaces/server/seed-workspace.ts` → ontology seed's
 * "Dopl Playbook" cluster). Only the first cluster carries lanes; the others
 * are cosmetic pills, exactly as the pane rendered before live wiring.
 */
export const DEMO_CLUSTERS: PaneCluster[] = [
  {
    id: "demo-playbook",
    name: "Dopl Playbook",
    purpose:
      "How this workspace is meant to be used — its surfaces and the rituals that keep them current.",
    count: 3,
    lanes: [
      {
        id: "surfaces",
        name: "Surfaces",
        subtitle: "What the workspace is made of",
        fields: [
          { label: "Purpose", kind: "Text" },
          { label: "MCP tool", kind: "Text" },
          { label: "Learn more", kind: "Knowledge" },
        ],
        cards: [
          {
            id: "surface-knowledge",
            name: "Knowledge",
            subtitle: "Durable reference — the facts humans and agents reread.",
            chips: ["dopl_kb", "Dopl Guide"],
            attrs: 3,
            edges: 1,
            actions: 0,
          },
          {
            id: "surface-skills",
            name: "Skills",
            subtitle: "One-task procedures served live to the agent.",
            chips: ["dopl_skill", "File knowledge"],
            attrs: 3,
            edges: 1,
            actions: 0,
          },
          {
            id: "surface-chats",
            name: "Chats",
            subtitle:
              "The record of past sessions — decisions, deliverables, learnings.",
            chips: ["dopl_chats", "Archive session"],
            attrs: 3,
            edges: 1,
            actions: 0,
          },
        ],
      },
      {
        id: "rituals",
        name: "Rituals",
        subtitle: "What keeps the workspace alive",
        fields: [
          { label: "Cadence", kind: "Text" },
          { label: "Skill", kind: "Skill" },
          { label: "Reference", kind: "Knowledge" },
        ],
        cards: [
          {
            id: "ritual-start",
            name: "Session start",
            subtitle:
              "Orient before acting — call dopl_map first, then open any matching skill or entry.",
            chips: ["Every session", "reads → Knowledge"],
            attrs: 3,
            edges: 1,
            actions: 1,
          },
          {
            id: "ritual-end",
            name: "Session end",
            subtitle: "Leave a trail — archive the session before closing it out.",
            chips: ["Every session", "archives → Chats"],
            attrs: 3,
            edges: 1,
            actions: 1,
          },
          {
            id: "ritual-upkeep",
            name: "Weekly upkeep",
            subtitle:
              "Keep the graph honest — prune stale objects, refresh what drifted.",
            chips: ["Weekly", "maintains → Ontology"],
            attrs: 3,
            edges: 2,
            actions: 1,
          },
        ],
      },
      {
        id: "tools",
        name: "Tools",
        subtitle: "What does the work",
        fields: [
          { label: "Purpose", kind: "Text" },
          { label: "MCP tool", kind: "Text" },
        ],
        cards: [
          {
            id: "tool-claude-code",
            name: "Claude Code",
            subtitle: "Terminal agent wired to this workspace over MCP.",
            chips: ["MCP", "dopl_map"],
            attrs: 2,
            edges: 1,
            actions: 0,
          },
          {
            id: "tool-your-agent",
            name: "Your Agent",
            subtitle: "Reads the playbook to route, writes back what it learns.",
            chips: ["Routes via ontology"],
            attrs: 2,
            edges: 2,
            actions: 1,
          },
        ],
      },
    ],
  },
  { id: "demo-projects", name: "Projects", purpose: "", count: 4, lanes: [] },
  { id: "demo-people", name: "People", purpose: "", count: 2, lanes: [] },
];
