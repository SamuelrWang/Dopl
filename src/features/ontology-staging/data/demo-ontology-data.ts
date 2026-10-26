/**
 * THE STAGING ONTOLOGY'S FAKE DATA — one file, hard-coded, no fetch.
 *
 * Shapes are the real wire shapes (`@/features/ontology/types`,
 * `@/features/revisions/types`), so the copied components render them exactly as
 * they render `GET /api/ontology`. Four ontologies in the operator's home space:
 * a full sales pipeline (every field kind, relationships, actions), a product
 * roadmap, a hiring board, and a near-empty reading list (empty lane).
 */

import type {
  AttributeValue,
  ObjectAttribute,
  ObjectMethod,
  ObjectRelationship,
  Ontology,
  OntologyObject,
  OntologyShare,
  OntologySnapshot,
  TemplateField,
} from "@/features/ontology/types";
import { daysAgoIso, minsAgoIso } from "@/features/ui-staging/staging-stubs";

/* ── builders ──────────────────────────────────────────────────────── */

type Kind = AttributeValue["kind"];
type Raw = string | string[];

function field(
  label: string,
  kind: Kind,
  extra: { description?: string; options?: string[] } = {}
): TemplateField {
  return { key: keyOf(label), label, kind, ...extra };
}

function keyOf(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function valueOf(kind: Kind, raw: Raw | undefined): AttributeValue {
  if (kind === "ref" || kind === "knowledge" || kind === "skill") {
    return { kind, value: Array.isArray(raw) ? raw : raw ? [raw] : [] };
  }
  return { kind, value: typeof raw === "string" ? raw : "" } as AttributeValue;
}

/** A card: template fields filled from `values` (by label), in template order. */
function card(
  id: string,
  name: string,
  subtitle: string,
  template: TemplateField[],
  values: Record<string, Raw>,
  more: {
    relationships?: ObjectRelationship[];
    methods?: ObjectMethod[];
  } = {}
): OntologyObject {
  const attributes: ObjectAttribute[] = template.map((f) => ({
    key: f.key,
    label: f.label,
    value: valueOf(f.kind, values[f.label]),
    ...(f.options ? { options: [...f.options] } : {}),
  }));
  return {
    id,
    name,
    subtitle,
    attributes,
    relationships: more.relationships ?? [],
    methods: more.methods ?? [],
    childIds: [],
    template: [],
    updatedAt: minsAgoIso(30),
  };
}

/** A lane (an object type): its template + the cards under it. */
function lane(
  id: string,
  name: string,
  subtitle: string,
  template: TemplateField[],
  cards: OntologyObject[],
  more: {
    relationships?: ObjectRelationship[];
    methods?: ObjectMethod[];
  } = {}
): OntologyObject[] {
  const column: OntologyObject = {
    id,
    name,
    subtitle,
    attributes: [],
    relationships: more.relationships ?? [],
    methods: more.methods ?? [],
    childIds: cards.map((c) => c.id),
    template,
    updatedAt: daysAgoIso(2),
  };
  return [column, ...cards];
}

const rel = (label: string, ...targetIds: string[]): ObjectRelationship => ({
  label,
  targetIds,
});

/* ── workspace resources (knowledge bases + entries) ───────────────── */

export const DEMO_KNOWLEDGE_BASES = [
  { id: "kb-playbooks", name: "Sales playbooks", visibility: "private" },
  { id: "kb-product", name: "Product specs", visibility: "workspace" },
  { id: "kb-hiring", name: "Hiring rubric", visibility: "private" },
] as const;

export const DEMO_KNOWLEDGE_ENTRIES: Record<string, { id: string; title: string }[]> = {
  "kb-playbooks": [
    { id: "ent-discovery", title: "Discovery call script" },
    { id: "ent-pricing", title: "Pricing objections" },
    { id: "ent-followup", title: "Follow-up cadence" },
  ],
  "kb-product": [
    { id: "ent-roadmap-q4", title: "Q4 roadmap" },
    { id: "ent-glasses", title: "Glasses MCP spec" },
  ],
  "kb-hiring": [
    { id: "ent-eng-rubric", title: "Engineering rubric" },
    { id: "ent-take-home", title: "Take-home prompt" },
  ],
};

/* ── 1. Sales pipeline ─────────────────────────────────────────────── */

const ACCOUNT_T = [
  field("Industry", "pill", { description: "One word, the account's market." }),
  field("Stage", "enum", {
    description: "Where the account sits in the funnel.",
    options: ["Prospect", "Qualified", "Customer", "Churned"],
  }),
  field("Seats", "number"),
  field("Website", "link"),
  field("Renewal", "date"),
  field("Playbook", "knowledge", { description: "What the agent reads before outreach." }),
];
const CONTACT_T = [
  field("Role", "text"),
  field("Email", "text"),
  field("Seniority", "enum", { options: ["IC", "Manager", "Director", "VP", "C-level"] }),
  field("LinkedIn", "link"),
];
const DEAL_T = [
  field("Amount", "number", { description: "Annual contract value in USD." }),
  field("Stage", "enum", { options: ["Discovery", "Proposal", "Negotiation", "Won", "Lost"] }),
  field("Close date", "date"),
  field("Account", "ref"),
];
const MEETING_T = [field("When", "date"), field("Notes", "text"), field("Attendees", "ref")];

const FOLLOW_UP: ObjectMethod = {
  name: "Send follow-up",
  description: "Draft a short follow-up referencing the last meeting.",
  outcome: "Follow-up email drafted and logged on the contact.",
  tools: "Gmail, LinkedIn",
};
const ENRICH: ObjectMethod = {
  name: "Enrich account",
  description: "Fill seats, industry and website from public sources.",
  outcome: "Every empty field on the account has a value or a note.",
  tools: "Web search, Apollo",
};

const ACCOUNTS = [
  card("acct-northwind", "Northwind Traders", "Logistics, 400 seats", ACCOUNT_T, {
    Industry: "Logistics", Stage: "Customer", Seats: "400",
    Website: "https://northwind.example.com", Renewal: "2027-03-01", Playbook: ["kb-playbooks"],
  }, { relationships: [rel("primary contact", "ct-hana")], methods: [ENRICH] }),
  card("acct-lattice", "Lattice Labs", "Dev tools", ACCOUNT_T, {
    Industry: "Software", Stage: "Qualified", Seats: "85",
    Website: "https://lattice.example.com", Playbook: ["ent-discovery"],
  }, { relationships: [rel("primary contact", "ct-marco")], methods: [ENRICH] }),
  card("acct-vermillion", "Vermillion Health", "Clinics across the Midwest", ACCOUNT_T, {
    Industry: "Healthcare", Stage: "Prospect", Seats: "1200",
    Website: "https://vermillion.example.com",
  }, { methods: [ENRICH] }),
  card("acct-orbit", "Orbit Freight", "", ACCOUNT_T, {
    Industry: "Logistics", Stage: "Churned", Seats: "60", Renewal: "2026-08-15",
  }),
  card("acct-kestrel", "Kestrel Capital", "Family office", ACCOUNT_T, {
    Industry: "Finance", Stage: "Qualified", Seats: "25",
    Website: "https://kestrel.example.com", Playbook: ["ent-pricing"],
  }),
];
const CONTACTS = [
  card("ct-hana", "Hana Okafor", "COO, Northwind", CONTACT_T, {
    Role: "Chief Operating Officer", Email: "hana@northwind.example.com", Seniority: "C-level",
    LinkedIn: "https://linkedin.com/in/hana-okafor",
  }, { relationships: [rel("works at", "acct-northwind")], methods: [FOLLOW_UP] }),
  card("ct-marco", "Marco Bellini", "Head of Platform", CONTACT_T, {
    Role: "Head of Platform", Email: "marco@lattice.example.com", Seniority: "Director",
  }, { relationships: [rel("works at", "acct-lattice")], methods: [FOLLOW_UP] }),
  card("ct-priya", "Priya Raman", "IT lead", CONTACT_T, {
    Role: "IT Lead", Email: "priya@vermillion.example.com", Seniority: "Manager",
  }, { relationships: [rel("works at", "acct-vermillion")], methods: [FOLLOW_UP] }),
  card("ct-jonas", "Jonas Weber", "", CONTACT_T, {
    Role: "Procurement", Seniority: "IC",
  }, { relationships: [rel("works at", "acct-northwind")] }),
  card("ct-elena", "Elena Sato", "Partner", CONTACT_T, {
    Role: "Partner", Email: "elena@kestrel.example.com", Seniority: "C-level",
    LinkedIn: "https://linkedin.com/in/elena-sato",
  }, { relationships: [rel("works at", "acct-kestrel")], methods: [FOLLOW_UP] }),
  card("ct-dev", "Dev Malhotra", "Engineering manager", CONTACT_T, {
    Role: "Engineering Manager", Email: "dev@lattice.example.com", Seniority: "Manager",
  }, { relationships: [rel("works at", "acct-lattice")] }),
];
const DEALS = [
  card("deal-nw-expansion", "Northwind expansion", "+150 seats", DEAL_T, {
    Amount: "54000", Stage: "Negotiation", "Close date": "2026-11-14", Account: ["acct-northwind"],
  }, { relationships: [rel("champion", "ct-hana"), rel("blocked by", "ct-jonas")] }),
  card("deal-lattice-pilot", "Lattice pilot", "", DEAL_T, {
    Amount: "12000", Stage: "Proposal", "Close date": "2026-11-30", Account: ["acct-lattice"],
  }, { relationships: [rel("champion", "ct-marco")] }),
  card("deal-vermillion", "Vermillion rollout", "Three clinics first", DEAL_T, {
    Amount: "96000", Stage: "Discovery", Account: ["acct-vermillion"],
  }),
  card("deal-kestrel", "Kestrel advisory seats", "", DEAL_T, {
    Amount: "8000", Stage: "Won", "Close date": "2026-10-02", Account: ["acct-kestrel"],
  }),
  card("deal-orbit-winback", "Orbit win-back", "", DEAL_T, {
    Amount: "6000", Stage: "Lost", "Close date": "2026-09-20", Account: ["acct-orbit"],
  }),
];
const MEETINGS = [
  card("mtg-nw-qbr", "Northwind QBR", "Quarterly review", MEETING_T, {
    When: "2026-10-28", Notes: "Walk through usage and the expansion quote.",
    Attendees: ["ct-hana", "ct-jonas"],
  }),
  card("mtg-lattice-demo", "Lattice demo", "", MEETING_T, {
    When: "2026-10-24", Notes: "Live demo of channels + ontology.", Attendees: ["ct-marco", "ct-dev"],
  }),
];

const SALES_OBJECTS = [
  ...lane("col-accounts", "Accounts", "Companies we sell to", ACCOUNT_T, ACCOUNTS, {
    methods: [ENRICH],
  }),
  ...lane("col-contacts", "Contacts", "People at accounts", CONTACT_T, CONTACTS, {
    relationships: [rel("works at", "col-accounts")],
    methods: [FOLLOW_UP],
  }),
  ...lane("col-deals", "Deals", "Open and closed opportunities", DEAL_T, DEALS, {
    relationships: [rel("champion", "col-contacts")],
  }),
  ...lane("col-meetings", "Meetings", "", MEETING_T, MEETINGS),
];

/* ── 2. Product roadmap ────────────────────────────────────────────── */

const FEATURE_T = [
  field("Status", "enum", { options: ["Idea", "Planned", "Building", "Shipped"] }),
  field("Owner", "pill"),
  field("Target", "date"),
  field("Spec", "knowledge"),
];
const RELEASE_T = [field("Version", "pill"), field("Date", "date"), field("Notes", "link")];
const BUG_T = [
  field("Severity", "enum", { options: ["P0", "P1", "P2", "P3"] }),
  field("Reported by", "text"),
];

const ROADMAP_OBJECTS = [
  ...lane("col-features", "Features", "What we are building", FEATURE_T, [
    card("ft-glasses", "Glasses MCP hub", "Any agent to any glasses", FEATURE_T, {
      Status: "Shipped", Owner: "Daniel", Target: "2026-09-29", Spec: ["ent-glasses"],
    }, { relationships: [rel("ships in", "rel-138")] }),
    card("ft-dictation", "Dictation", "", FEATURE_T, {
      Status: "Shipped", Owner: "Grace", Target: "2026-10-12",
    }, { relationships: [rel("ships in", "rel-140")] }),
    card("ft-staging", "Web UI staging", "Iterate on desktop faces in the browser", FEATURE_T, {
      Status: "Building", Owner: "Daniel", Target: "2026-10-30",
    }),
    card("ft-offline", "Offline mode", "", FEATURE_T, { Status: "Idea" }),
  ]),
  ...lane("col-releases", "Releases", "", RELEASE_T, [
    card("rel-138", "1.38.0", "Glasses", RELEASE_T, {
      Version: "1.38.0", Date: "2026-09-29", Notes: "https://usedopl.com/changelog",
    }),
    card("rel-140", "1.40.0", "Dictation", RELEASE_T, { Version: "1.40.0", Date: "2026-10-12" }),
    card("rel-142", "1.42.0", "Muse + Grok", RELEASE_T, { Version: "1.42.0", Date: "2026-10-14" }),
  ]),
  ...lane("col-bugs", "Bugs", "Triage queue", BUG_T, [
    card("bug-signout", "Desktop signs out on wake", "", BUG_T, {
      Severity: "P1", "Reported by": "Anthony",
    }, { relationships: [rel("affects", "rel-142")] }),
    card("bug-cpu", "Main process CPU spike", "", BUG_T, { Severity: "P2", "Reported by": "Grace" }),
  ]),
];

/* ── 3. Hiring ─────────────────────────────────────────────────────── */

const ROLE_T = [field("Team", "pill"), field("Openings", "number"), field("Rubric", "knowledge")];
const CANDIDATE_T = [
  field("Stage", "enum", { options: ["Applied", "Screen", "Onsite", "Offer", "Hired"] }),
  field("Source", "pill"),
  field("Portfolio", "link"),
  field("Applied for", "ref"),
];

const HIRING_OBJECTS = [
  ...lane("col-roles", "Roles", "", ROLE_T, [
    card("role-fe", "Frontend engineer", "Desktop + web UI", ROLE_T, {
      Team: "Product", Openings: "2", Rubric: ["ent-eng-rubric"],
    }),
    card("role-design", "Product designer", "", ROLE_T, { Team: "Design", Openings: "1" }),
  ]),
  ...lane("col-candidates", "Candidates", "", CANDIDATE_T, [
    card("cand-amara", "Amara Diallo", "Ex-Linear", CANDIDATE_T, {
      Stage: "Onsite", Source: "Referral", Portfolio: "https://amara.example.com",
      "Applied for": ["role-fe"],
    }),
    card("cand-li", "Li Wei", "", CANDIDATE_T, {
      Stage: "Screen", Source: "Inbound", "Applied for": ["role-fe"],
    }),
    card("cand-sofia", "Sofia Marquez", "Brand + product", CANDIDATE_T, {
      Stage: "Offer", Source: "Dribbble", Portfolio: "https://sofia.example.com",
      "Applied for": ["role-design"],
    }),
  ]),
];

/* ── 4. Reading list (an empty lane) ───────────────────────────────── */

const BOOK_T = [field("Author", "text"), field("Link", "link")];
const READING_OBJECTS = [...lane("col-books", "Books", "", BOOK_T, [])];

/* ── the snapshot ──────────────────────────────────────────────────── */

const ontology = (
  id: string,
  slug: string,
  name: string,
  purpose: string,
  columnIds: string[],
  sharing: { agentsMayEdit: boolean; sharedChannelCount: number }
): Ontology => ({ id, slug, name, purpose, columnIds, layout: {}, ...sharing });

export const DEMO_ONTOLOGIES: Ontology[] = [
  ontology(
    "ont-sales",
    "sales-pipeline",
    "Sales pipeline",
    "Accounts, contacts and deals the outbound agents work from.",
    ["col-accounts", "col-contacts", "col-deals", "col-meetings"],
    { agentsMayEdit: true, sharedChannelCount: 2 }
  ),
  ontology(
    "ont-roadmap",
    "product-roadmap",
    "Product roadmap",
    "What ships when, and what is broken.",
    ["col-features", "col-releases", "col-bugs"],
    { agentsMayEdit: false, sharedChannelCount: 1 }
  ),
  ontology("ont-hiring", "hiring", "Hiring", "", ["col-roles", "col-candidates"], {
    agentsMayEdit: true,
    sharedChannelCount: 0,
  }),
  ontology("ont-reading", "reading-list", "Reading list", "", ["col-books"], {
    agentsMayEdit: true,
    sharedChannelCount: 0,
  }),
];

export function demoSnapshot(): OntologySnapshot {
  const objects: Record<string, OntologyObject> = {};
  for (const o of [...SALES_OBJECTS, ...ROADMAP_OBJECTS, ...HIRING_OBJECTS, ...READING_OBJECTS]) {
    objects[o.id] = o;
  }
  return {
    ontologies: DEMO_ONTOLOGIES.map((o) => ({ ...o, columnIds: [...o.columnIds] })),
    objects,
  };
}

/* ── home channels + share rows ────────────────────────────────────── */

/** The operator's home channels the share popup lists (`use-home-channels.ts`). */
export const DEMO_HOME_CHANNELS = [
  { id: "ch-tech-debt", name: "tech-debt" },
  { id: "ch-outbound", name: "outbound" },
  { id: "ch-launch", name: "launch-week" },
] as const;

export const DEMO_SHARES: Record<string, OntologyShare[]> = {
  "ont-sales": [
    { channelId: "ch-outbound", membersLevel: "edit", guestsLevel: "view", ownerAgentsLevel: "edit" },
    { channelId: "ch-launch", membersLevel: "view", guestsLevel: "none", ownerAgentsLevel: "view" },
  ],
  "ont-roadmap": [
    { channelId: "ch-tech-debt", membersLevel: "edit", guestsLevel: "none", ownerAgentsLevel: "view" },
  ],
};
