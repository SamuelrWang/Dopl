import type {
  ObjectTypeId,
  ObjectTypeMeta,
  OntologyCluster,
  OntologyObject,
} from "./types";

/**
 * Static seed data for the ontology page preview — the insurance-brokerage
 * example (reps, account team, client, policy). UI-only; delete when the
 * real ontology service lands.
 */

export const OBJECT_TYPES: Record<ObjectTypeId, ObjectTypeMeta> = {
  person: { id: "person", label: "Person", border: "#2c5f9e", bg: "#e8f0fb", text: "#2c5f9e" },
  team: { id: "team", label: "Team", border: "#25784a", bg: "#e5f4ec", text: "#25784a" },
  client: { id: "client", label: "Client", border: "#a1620e", bg: "#fdf1df", text: "#a1620e" },
  policy: { id: "policy", label: "Policy", border: "#6d3fb0", bg: "#f0e9fb", text: "#6d3fb0" },
  document: { id: "document", label: "Document", border: "#54595f", bg: "#eef0f2", text: "#54595f" },
};

export const OBJECTS: Record<string, OntologyObject> = {
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
        value: { kind: "files", value: ["dana-voice-guide.md", "sent-samples-2026.md"] },
      },
      { key: "region", label: "Region", value: { kind: "text", value: "Northeast" } },
    ],
    relationships: [
      { label: "member of", targetIds: ["team-acme"] },
      { label: "primary on", targetIds: ["client-acme"] },
    ],
    methods: [],
  },
  "rep-marcus": {
    id: "rep-marcus",
    type: "person",
    name: "Marcus Bell",
    subtitle: "Sales rep",
    attributes: [
      { key: "email", label: "Email", value: { kind: "text", value: "marcus@meridianbrokers.com" } },
      { key: "role", label: "Role", value: { kind: "pill", value: "Account executive" } },
    ],
    relationships: [{ label: "member of", targetIds: ["team-acme"] }],
    methods: [],
  },
  "rep-ines": {
    id: "rep-ines",
    type: "person",
    name: "Inés Romero",
    subtitle: "Sales rep",
    attributes: [
      { key: "email", label: "Email", value: { kind: "text", value: "ines@meridianbrokers.com" } },
      { key: "role", label: "Role", value: { kind: "pill", value: "Account executive" } },
    ],
    relationships: [{ label: "member of", targetIds: ["team-acme"] }],
    methods: [],
  },
  "rep-theo": {
    id: "rep-theo",
    type: "person",
    name: "Theo Nakamura",
    subtitle: "Sales rep",
    attributes: [
      { key: "email", label: "Email", value: { kind: "text", value: "theo@meridianbrokers.com" } },
      { key: "role", label: "Role", value: { kind: "pill", value: "Account executive" } },
    ],
    relationships: [{ label: "member of", targetIds: ["team-acme"] }],
    methods: [],
  },
  "team-acme": {
    id: "team-acme",
    type: "team",
    name: "Acme account team",
    subtitle: "4 reps",
    attributes: [
      { key: "cc", label: "CC policy", value: { kind: "pill", value: "CC all members on client email" } },
      { key: "lead", label: "Lead", value: { kind: "text", value: "Dana Whitfield" } },
    ],
    relationships: [
      { label: "members", targetIds: ["rep-dana", "rep-marcus", "rep-ines", "rep-theo"] },
      { label: "assigned to", targetIds: ["client-acme"] },
    ],
    methods: [],
  },
  "client-acme": {
    id: "client-acme",
    type: "client",
    name: "Acme Logistics",
    subtitle: "Client since 2023 · $410k premium",
    attributes: [
      { key: "correspondent", label: "Correspondent", value: { kind: "text", value: "Sarah Chen (VP Ops)" } },
      { key: "email", label: "Email", value: { kind: "text", value: "s.chen@acmelogistics.com" } },
      {
        key: "transcripts",
        label: "Call transcripts",
        value: { kind: "files", value: ["2026-06-27-renewal-call.md", "2026-05-14-fleet-review.md"] },
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
          "client.correspondent + email",
          "client.transcripts (latest)",
        ],
      },
      {
        name: "Prep renewal brief",
        description: "Compile coverage, claims history, and open items ahead of the renewal date.",
        requires: ["client.policies → coverage", "client.transcripts", "client.renewal date"],
      },
    ],
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
  },
  "claim-2209": {
    id: "claim-2209",
    type: "document",
    name: "Claim #C-2209",
    subtitle: "Acme Logistics · vehicle damage",
    attributes: [
      { key: "status", label: "Status", value: { kind: "pill", value: "Awaiting carrier response" } },
      { key: "filed", label: "Filed", value: { kind: "text", value: "Jun 18, 2026" } },
      { key: "docs", label: "Documents", value: { kind: "files", value: ["incident-report.pdf", "repair-estimate.pdf"] } },
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
  },
};

export const CLUSTERS: OntologyCluster[] = [
  {
    id: "cl-sales",
    name: "Brokerage — Sales",
    purpose: "Reps, account teams, clients, and policies. Anchors outbound + renewal work.",
    objectIds: [
      "client-acme",
      "team-acme",
      "rep-dana",
      "rep-marcus",
      "rep-ines",
      "rep-theo",
      "policy-4471",
      "policy-5108",
    ],
  },
  {
    id: "cl-claims",
    name: "Claims Ops",
    purpose: "Adjusters and open claims. Anchors carrier chasing + client updates.",
    objectIds: ["adj-priya", "claim-2209", "policy-4471"],
  },
];

