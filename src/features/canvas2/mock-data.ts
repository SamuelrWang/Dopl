/**
 * Canvas 2 — hardcoded ontology sample for the graph-view mock.
 * Static data only; no persistence. Shapes mirror the real ontology
 * model (objects + containment + labeled relationships + ref attrs)
 * so swapping in `GET /api/ontology` later is mechanical.
 */

export type MockAttributeKind = "text" | "pill" | "ref" | "knowledge" | "skill";

export interface MockAttribute {
  key: string;
  label: string;
  kind: MockAttributeKind;
  /** Pre-resolved display string (mock stands in for id lookups). */
  display: string;
}

export interface MockAction {
  name: string;
  description: string;
  outcome: string;
  tools: string;
}

export interface MockRelationship {
  label: string;
  targetIds: string[];
}

export interface MockNode {
  id: string;
  kind: "column" | "object";
  name: string;
  subtitle: string;
  /** World coordinates + fixed width; height comes from content. */
  x: number;
  y: number;
  width: number;
  /** Column only. */
  purpose?: string;
  template?: { label: string; kind: MockAttributeKind }[];
  attributes: MockAttribute[];
  relationships: MockRelationship[];
  actions: MockAction[];
}

export type MockEdgeKind = "containment" | "relationship" | "ref";

export type EdgeSide = "top" | "right" | "bottom" | "left";

export interface MockEdge {
  id: string;
  kind: MockEdgeKind;
  from: string;
  to: string;
  label?: string;
  /** Orthogonal-routing hints: exit/entry side + fraction along it. */
  fromSide?: EdgeSide;
  toSide?: EdgeSide;
  fromT?: number;
  toT?: number;
  /** Absolute world coordinate for the middle segment (x for HVH, y for VHV). */
  mid?: number;
}

export const WORLD_WIDTH = 1800;
export const WORLD_HEIGHT = 1000;

export const MOCK_CLUSTER = {
  name: "AI Operator Outreach",
  purpose: "Everything the outreach agents need to source, qualify, and message PE ops leads.",
};

export const MOCK_NODES: MockNode[] = [
  {
    id: "col-prospects",
    kind: "column",
    name: "Prospects",
    subtitle: "People being pursued",
    x: 150,
    y: 80,
    width: 240,
    purpose: "Qualified humans the agents source and message.",
    template: [
      { label: "Role", kind: "text" },
      { label: "Company", kind: "text" },
      { label: "Stage", kind: "pill" },
      { label: "Campaign", kind: "ref" },
    ],
    attributes: [],
    relationships: [],
    actions: [],
  },
  {
    id: "col-subagents",
    kind: "column",
    name: "Subagents",
    subtitle: "Automated operators",
    x: 780,
    y: 80,
    width: 240,
    purpose: "Agents that run the outreach loop end to end.",
    template: [
      { label: "Model", kind: "text" },
      { label: "Cadence", kind: "text" },
      { label: "Playbook", kind: "knowledge" },
    ],
    attributes: [],
    relationships: [],
    actions: [],
  },
  {
    id: "col-campaigns",
    kind: "column",
    name: "Campaigns",
    subtitle: "Active pushes",
    x: 1410,
    y: 80,
    width: 240,
    purpose: "Time-boxed outreach pushes with a goal and channel.",
    template: [
      { label: "Goal", kind: "text" },
      { label: "Channel", kind: "pill" },
    ],
    attributes: [],
    relationships: [],
    actions: [],
  },
  {
    id: "obj-jane",
    kind: "object",
    name: "Jane Rivera",
    subtitle: "VP Ops · Meridian Capital",
    x: 130,
    y: 620,
    width: 280,
    attributes: [
      { key: "role", label: "Role", kind: "text", display: "VP of Operations" },
      { key: "company", label: "Company", kind: "text", display: "Meridian Capital" },
      { key: "stage", label: "Stage", kind: "pill", display: "Qualified" },
      { key: "campaign", label: "Campaign", kind: "ref", display: "PE Ops Q3" },
      { key: "source", label: "Sourced from", kind: "knowledge", display: "Outreach Playbook" },
    ],
    relationships: [],
    actions: [],
  },
  {
    id: "obj-marcus",
    kind: "object",
    name: "Marcus Chen",
    subtitle: "Head of Platform · Northwind PE",
    x: 130,
    y: 330,
    width: 280,
    attributes: [
      { key: "role", label: "Role", kind: "text", display: "Head of Platform" },
      { key: "company", label: "Company", kind: "text", display: "Northwind PE" },
      { key: "stage", label: "Stage", kind: "pill", display: "New" },
    ],
    relationships: [],
    actions: [],
  },
  {
    id: "obj-find-qualify",
    kind: "object",
    name: "Find & Qualify Agent",
    subtitle: "Sources and scores new leads",
    x: 750,
    y: 330,
    width: 300,
    attributes: [
      { key: "model", label: "Model", kind: "text", display: "claude-sonnet-5" },
      { key: "cadence", label: "Cadence", kind: "text", display: "Daily, 7am" },
      { key: "playbook", label: "Playbook", kind: "knowledge", display: "Outreach Playbook" },
      { key: "skill", label: "Skill", kind: "skill", display: "sam-ops-outreach" },
    ],
    relationships: [
      { label: "qualifies", targetIds: ["obj-jane", "obj-marcus"] },
      { label: "feeds", targetIds: ["obj-connect-message"] },
    ],
    actions: [
      {
        name: "Source new leads",
        description: "Pull fresh PE ops contacts matching the target profile.",
        outcome: "New prospect objects created in the Prospects column.",
        tools: "dopl_kb, apollo",
      },
      {
        name: "Score lead fit",
        description: "Run the scoring rubric against a prospect.",
        outcome: "Stage attribute set to Qualified or Dropped.",
        tools: "dopl_ontology",
      },
    ],
  },
  {
    id: "obj-connect-message",
    kind: "object",
    name: "Connect & Message Agent",
    subtitle: "Drafts and sends outreach",
    x: 750,
    y: 680,
    width: 300,
    attributes: [
      { key: "model", label: "Model", kind: "text", display: "claude-fable-5" },
      { key: "cadence", label: "Cadence", kind: "text", display: "On qualify" },
      { key: "voice", label: "Voice", kind: "knowledge", display: "voices" },
    ],
    relationships: [
      { label: "messages", targetIds: ["obj-jane"] },
      { label: "runs in", targetIds: ["obj-campaign-q3"] },
    ],
    actions: [
      {
        name: "Draft outreach",
        description: "Write a first-touch email in Samuel's voice.",
        outcome: "Draft saved to Gmail, prospect marked reached_out.",
        tools: "gmail, dopl_skill",
      },
    ],
  },
  {
    id: "obj-campaign-q3",
    kind: "object",
    name: "PE Ops Q3",
    subtitle: "Advisory push, Jul–Sep",
    x: 1390,
    y: 330,
    width: 280,
    attributes: [
      { key: "goal", label: "Goal", kind: "text", display: "8 discovery calls" },
      { key: "channel", label: "Channel", kind: "pill", display: "Email" },
      { key: "window", label: "Window", kind: "text", display: "Jul 1 – Sep 30" },
    ],
    relationships: [{ label: "targets", targetIds: ["col-prospects"] }],
    actions: [],
  },
];

export const MOCK_EDGES: MockEdge[] = [
  // Containment (column → child). Verticals where the child sits under
  // its column; left-side loops for second children.
  {
    id: "c1", kind: "containment", from: "col-prospects", to: "obj-marcus",
    fromSide: "bottom", toSide: "top",
  },
  {
    id: "c2", kind: "containment", from: "col-prospects", to: "obj-jane",
    fromSide: "left", toSide: "left", mid: 70,
  },
  {
    id: "c3", kind: "containment", from: "col-subagents", to: "obj-find-qualify",
    fromSide: "bottom", toSide: "top",
  },
  {
    id: "c4", kind: "containment", from: "col-subagents", to: "obj-connect-message",
    fromSide: "left", toSide: "left", mid: 690, fromT: 0.5, toT: 0.5,
  },
  {
    id: "c5", kind: "containment", from: "col-campaigns", to: "obj-campaign-q3",
    fromSide: "bottom", toSide: "top",
  },
  // Labeled relationships
  {
    id: "r1", kind: "relationship", from: "obj-find-qualify", to: "obj-jane",
    label: "qualifies", fromSide: "left", toSide: "right", fromT: 0.75, toT: 0.3, mid: 560,
  },
  {
    id: "r2", kind: "relationship", from: "obj-find-qualify", to: "obj-marcus",
    label: "qualifies", fromSide: "left", toSide: "right", fromT: 0.3, toT: 0.4, mid: 580,
  },
  {
    id: "r3", kind: "relationship", from: "obj-find-qualify", to: "obj-connect-message",
    label: "feeds", fromSide: "bottom", toSide: "top",
  },
  {
    id: "r4", kind: "relationship", from: "obj-connect-message", to: "obj-jane",
    label: "messages", fromSide: "left", toSide: "right", fromT: 0.5, toT: 0.7, mid: 620,
  },
  {
    id: "r5", kind: "relationship", from: "obj-connect-message", to: "obj-campaign-q3",
    label: "runs in", fromSide: "right", toSide: "bottom", fromT: 0.4,
  },
  {
    id: "r6", kind: "relationship", from: "obj-campaign-q3", to: "col-prospects",
    label: "targets", fromSide: "top", toSide: "bottom", fromT: 0.2, toT: 0.75, mid: 280,
  },
  // Ref attribute (implicit link) — routed through the clear lane below.
  {
    id: "f1", kind: "ref", from: "obj-jane", to: "obj-campaign-q3",
    label: "campaign", fromSide: "bottom", toSide: "bottom", fromT: 0.7, toT: 0.4, mid: 940,
  },
];

/** Column an object sits in (containment lookup) — "what it is". */
export function containerNameOf(id: string): string | null {
  const edge = MOCK_EDGES.find((e) => e.kind === "containment" && e.to === id);
  if (!edge) return null;
  return MOCK_NODES.find((n) => n.id === edge.from)?.name ?? null;
}
