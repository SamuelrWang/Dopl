import type {
  ObjectTypeId,
  ObjectTypeMeta,
  OntologyCluster,
  OntologyObject,
  WorkspaceResource,
} from "./types";

/**
 * Static seed data for the ontology page preview — the insurance-brokerage
 * example. Columns are container objects (Clients, Persons, …) whose
 * children are the cards. UI-only; delete when the real ontology service
 * lands.
 */

/**
 * Workspace knowledge bases / skills with the caller's access already
 * resolved (mocked here). The pickers read ONLY through
 * `accessibleKnowledge()` / `accessibleSkills()` — the single gate to
 * swap for the real role-checked fetch when the service lands.
 */
const KNOWLEDGE_RESOURCES: WorkspaceResource[] = [
  { id: "kb-call-notes", name: "Acme call notes", scope: "Sales team", accessible: true },
  { id: "kb-voice-guide", name: "Dana voice guide", scope: "Sales team", accessible: true },
  { id: "kb-brand", name: "Brand guidelines", scope: "Workspace", accessible: true },
  { id: "kb-sales-playbook", name: "Sales playbook", scope: "Sales team", accessible: true },
  { id: "kb-claim-docs", name: "Claim C-2209 documents", scope: "Claims team", accessible: true },
  { id: "kb-eng", name: "Eng handbook", scope: "Workspace", accessible: false },
  { id: "kb-finance", name: "Finance vault", scope: "Finance team", accessible: false },
];

const SKILL_RESOURCES: WorkspaceResource[] = [
  { id: "sk-brand-voice", name: "Brand voice", scope: "Workspace", accessible: true },
  { id: "sk-lead-enrichment", name: "Lead enrichment", scope: "Sales team", accessible: true },
  { id: "sk-weekly-report", name: "Weekly report", scope: "Sales team", accessible: true },
  { id: "sk-claim-chaser", name: "Claim chaser", scope: "Claims team", accessible: true },
  { id: "sk-billing-export", name: "Billing export", scope: "Finance team", accessible: false },
];

export function accessibleKnowledge(): WorkspaceResource[] {
  return KNOWLEDGE_RESOURCES.filter((r) => r.accessible);
}

export function accessibleSkills(): WorkspaceResource[] {
  return SKILL_RESOURCES.filter((r) => r.accessible);
}

/** Name lookup across both resource kinds (chips, previews). */
export function resourceName(id: string): string | null {
  const all = [...KNOWLEDGE_RESOURCES, ...SKILL_RESOURCES];
  return all.find((r) => r.id === id)?.name ?? null;
}

export const OBJECT_TYPES: Record<ObjectTypeId, ObjectTypeMeta> = {
  person: { id: "person", label: "Person", border: "#2c5f9e", bg: "#e8f0fb", text: "#2c5f9e" },
  team: { id: "team", label: "Team", border: "#25784a", bg: "#e5f4ec", text: "#25784a" },
  client: { id: "client", label: "Client", border: "#a1620e", bg: "#fdf1df", text: "#a1620e" },
  policy: { id: "policy", label: "Policy", border: "#6d3fb0", bg: "#f0e9fb", text: "#6d3fb0" },
  document: { id: "document", label: "Document", border: "#54595f", bg: "#eef0f2", text: "#54595f" },
};

export const OBJECTS: Record<string, OntologyObject> = {
  "col-clients": {
    id: "col-clients",
    type: "client",
    name: "Clients",
    subtitle: "Accounts the sales team owns",
    attributes: [],
    relationships: [],
    methods: [],
    childIds: ["client-acme"],
  },
  "col-teams": {
    id: "col-teams",
    type: "team",
    name: "Teams",
    subtitle: "Account teams",
    attributes: [],
    relationships: [],
    methods: [],
    childIds: ["team-acme"],
  },
  "col-people": {
    id: "col-people",
    type: "person",
    name: "Persons",
    subtitle: "Reps and client contacts",
    attributes: [],
    relationships: [],
    methods: [],
    childIds: ["rep-dana", "rep-marcus", "rep-ines", "rep-theo", "corr-sarah", "corr-mike"],
  },
  "col-policies": {
    id: "col-policies",
    type: "policy",
    name: "Policies",
    subtitle: "Active coverage",
    attributes: [],
    relationships: [],
    methods: [],
    childIds: ["policy-4471", "policy-5108"],
  },
  "col-adjusters": {
    id: "col-adjusters",
    type: "person",
    name: "Adjusters",
    subtitle: "Claims staff",
    attributes: [],
    relationships: [],
    methods: [],
    childIds: ["adj-priya"],
  },
  "col-claims": {
    id: "col-claims",
    type: "document",
    name: "Claims",
    subtitle: "Open claims",
    attributes: [],
    relationships: [],
    methods: [],
    childIds: ["claim-2209"],
  },
  "col-claim-policies": {
    id: "col-claim-policies",
    type: "policy",
    name: "Policies",
    subtitle: "Policies with open claims",
    attributes: [],
    relationships: [],
    methods: [],
    childIds: ["policy-4471"],
  },
  "client-acme": {
    id: "client-acme",
    type: "client",
    name: "Acme Logistics",
    subtitle: "Client since 2023 · $410k premium",
    attributes: [
      { key: "correspondents", label: "Correspondents", value: { kind: "ref", value: ["corr-sarah", "corr-mike"] } },
      {
        key: "transcripts",
        label: "Call transcripts",
        value: { kind: "knowledge", value: ["kb-call-notes"] },
      },
      { key: "renewal", label: "Renewal date", value: { kind: "pill", value: "Sep 30, 2026" } },
    ],
    relationships: [
      { label: "served by", targetIds: ["team-acme"] },
      { label: "holds", targetIds: ["policy-4471", "policy-5108"] },
    ],
    methods: [
      {
        name: "Send follow-up email",
        description: "Draft a follow-up on a topic from the latest conversation, in the sender's voice, CCing the account team.",
        requires: [
          "caller.voice files",
          "caller.team → members.email (cc)",
          "client.correspondents → primary.email",
          "client.transcripts (latest)",
        ],
      },
      {
        name: "Prep renewal brief",
        description: "Compile coverage, claims history, and open items ahead of the renewal date.",
        requires: ["client.policies → coverage", "client.transcripts", "client.renewal date"],
      },
    ],
    childIds: [],
  },
  "corr-sarah": {
    id: "corr-sarah",
    type: "person",
    name: "Sarah Chen",
    subtitle: "VP Ops · primary correspondent, Acme",
    attributes: [
      { key: "email", label: "Email", value: { kind: "text", value: "s.chen@acmelogistics.com" } },
      { key: "prefers", label: "Prefers", value: { kind: "pill", value: "Email, concise" } },
      { key: "contact-for", label: "Contact for", value: { kind: "ref", value: ["client-acme"] } },
    ],
    relationships: [],
    methods: [],
    childIds: [],
  },
  "corr-mike": {
    id: "corr-mike",
    type: "person",
    name: "Mike Torres",
    subtitle: "Fleet manager · technical contact, Acme",
    attributes: [
      { key: "email", label: "Email", value: { kind: "text", value: "m.torres@acmelogistics.com" } },
      { key: "scope", label: "Loop in for", value: { kind: "pill", value: "Vehicle schedules, claims" } },
      { key: "contact-for", label: "Contact for", value: { kind: "ref", value: ["client-acme"] } },
    ],
    relationships: [],
    methods: [],
    childIds: [],
  },
  "team-acme": {
    id: "team-acme",
    type: "team",
    name: "Acme account team",
    subtitle: "4 reps",
    attributes: [
      { key: "cc", label: "CC policy", value: { kind: "pill", value: "CC all members on client email" } },
      { key: "roster", label: "Roster", value: { kind: "ref", value: ["col-people"] } },
    ],
    relationships: [
      { label: "members", targetIds: ["rep-dana", "rep-marcus", "rep-ines", "rep-theo"] },
      { label: "assigned to", targetIds: ["client-acme"] },
    ],
    methods: [],
    childIds: [],
  },
  "rep-dana": {
    id: "rep-dana",
    type: "person",
    name: "Dana Whitfield",
    subtitle: "Sales rep · you",
    attributes: [
      { key: "email", label: "Email", value: { kind: "text", value: "dana@meridianbrokers.com" } },
      { key: "role", label: "Role", value: { kind: "pill", value: "Senior account executive" } },
      {
        key: "voice",
        label: "Email voice",
        value: { kind: "knowledge", value: ["kb-voice-guide"] },
      },
      { key: "skills", label: "Skills", value: { kind: "skill", value: ["sk-brand-voice", "sk-lead-enrichment"] } },
    ],
    relationships: [
      { label: "member of", targetIds: ["team-acme"] },
      { label: "primary on", targetIds: ["client-acme"] },
    ],
    methods: [],
    childIds: [],
  },
  "rep-marcus": {
    id: "rep-marcus",
    type: "person",
    name: "Marcus Bell",
    subtitle: "Sales rep",
    attributes: [
      { key: "email", label: "Email", value: { kind: "text", value: "marcus@meridianbrokers.com" } },
    ],
    relationships: [{ label: "member of", targetIds: ["team-acme"] }],
    methods: [],
    childIds: [],
  },
  "rep-ines": {
    id: "rep-ines",
    type: "person",
    name: "Inés Romero",
    subtitle: "Sales rep",
    attributes: [
      { key: "email", label: "Email", value: { kind: "text", value: "ines@meridianbrokers.com" } },
    ],
    relationships: [{ label: "member of", targetIds: ["team-acme"] }],
    methods: [],
    childIds: [],
  },
  "rep-theo": {
    id: "rep-theo",
    type: "person",
    name: "Theo Nakamura",
    subtitle: "Sales rep",
    attributes: [
      { key: "email", label: "Email", value: { kind: "text", value: "theo@meridianbrokers.com" } },
    ],
    relationships: [{ label: "member of", targetIds: ["team-acme"] }],
    methods: [],
    childIds: [],
  },
  "policy-4471": {
    id: "policy-4471",
    type: "policy",
    name: "Policy #P-4471",
    subtitle: "Commercial auto · active",
    attributes: [
      { key: "coverage", label: "Coverage", value: { kind: "text", value: "$2M combined single limit" } },
      { key: "carrier", label: "Carrier", value: { kind: "text", value: "Hartwell Mutual" } },
      { key: "expires", label: "Expires", value: { kind: "pill", value: "Sep 30, 2026" } },
    ],
    relationships: [{ label: "held by", targetIds: ["client-acme"] }],
    methods: [],
    childIds: [],
  },
  "policy-5108": {
    id: "policy-5108",
    type: "policy",
    name: "Policy #P-5108",
    subtitle: "General liability · active",
    attributes: [
      { key: "coverage", label: "Coverage", value: { kind: "text", value: "$5M aggregate" } },
      { key: "carrier", label: "Carrier", value: { kind: "text", value: "Cascade Underwriters" } },
    ],
    relationships: [{ label: "held by", targetIds: ["client-acme"] }],
    methods: [],
    childIds: [],
  },
  "adj-priya": {
    id: "adj-priya",
    type: "person",
    name: "Priya Anand",
    subtitle: "Claims adjuster",
    attributes: [
      { key: "email", label: "Email", value: { kind: "text", value: "priya@meridianbrokers.com" } },
      { key: "load", label: "Open claims", value: { kind: "pill", value: "7" } },
    ],
    relationships: [{ label: "handling", targetIds: ["claim-2209"] }],
    methods: [],
    childIds: [],
  },
  "claim-2209": {
    id: "claim-2209",
    type: "document",
    name: "Claim #C-2209",
    subtitle: "Acme Logistics · vehicle damage",
    attributes: [
      { key: "status", label: "Status", value: { kind: "pill", value: "Awaiting carrier response" } },
      { key: "docs", label: "Documents", value: { kind: "knowledge", value: ["kb-claim-docs"] } },
    ],
    relationships: [
      { label: "against", targetIds: ["policy-4471"] },
      { label: "adjuster", targetIds: ["adj-priya"] },
    ],
    methods: [
      {
        name: "Chase carrier",
        description: "Draft a status-request email to the carrier contact with the claim summary attached.",
        requires: ["claim.docs", "policy.carrier", "adjuster.email (cc)"],
      },
    ],
    childIds: [],
  },
};

export const CLUSTERS: OntologyCluster[] = [
  {
    id: "cl-sales",
    name: "Brokerage — Sales",
    purpose: "Reps, account teams, clients, and policies. Anchors outbound + renewal work.",
    columnIds: ["col-clients", "col-teams", "col-people", "col-policies"],
  },
  {
    id: "cl-claims",
    name: "Claims Ops",
    purpose: "Adjusters and open claims. Anchors carrier chasing + client updates.",
    columnIds: ["col-adjusters", "col-claims", "col-claim-policies"],
  },
];
