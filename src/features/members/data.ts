/**
 * Hardcoded members + teams data for the static UI pass. No DB
 * backing yet — when this ships for real, members come from
 * `workspace_members` and teams from a new `workspace_teams` table.
 *
 * Access levels per resource:
 *   - "none" — invisible / 404 to this member.
 *   - "read" — can browse the resource but agent writes via this
 *      member's session are blocked.
 *   - "edit" — full read + write.
 *
 * Resource slugs match the seeded skills + knowledge bases from
 * features/skills/server/seed.ts and the workspace-level KBs.
 */

export type MemberRole = "owner" | "admin" | "manager" | "member" | "viewer";
export type AccessLevel = "none" | "read" | "edit";

export interface AccessGrant {
  slug: string;
  level: AccessLevel;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  /** First initial used as avatar fallback when no photo. */
  initial: string;
  /** Tailwind gradient class for the avatar circle. */
  avatarGradient: string;
  role: MemberRole;
  /** Team ids the member belongs to. */
  teamIds: string[];
  /** Human-readable last-active timestamp. */
  lastActive: string;
  /** Per-KB access overrides on top of team grants. */
  knowledgeAccess: AccessGrant[];
  /** Per-skill access overrides on top of team grants. */
  skillAccess: AccessGrant[];
}

export interface Team {
  id: string;
  name: string;
  description: string;
  memberIds: string[];
  /** Default KB grants every member of the team inherits. */
  knowledgeAccess: AccessGrant[];
  skillAccess: AccessGrant[];
}

/**
 * Mirror of the seeded KB and skill catalog so the access matrix has
 * concrete labels to render. Slugs match the actual workspace data so
 * the static UI looks plausible against the real backend state.
 */
export const KNOWLEDGE_BASES: ReadonlyArray<{ slug: string; name: string }> = [
  { slug: "networking-emails", name: "Networking emails" },
  { slug: "competitor-intel", name: "Competitor intel" },
  { slug: "customer-feedback", name: "Customer feedback" },
  { slug: "product-specs", name: "Product specs" },
];

export const SKILLS: ReadonlyArray<{ slug: string; name: string }> = [
  { slug: "outbound-email-drafting", name: "Outbound email drafting" },
  { slug: "competitor-research-synthesis", name: "Competitor research synthesis" },
  { slug: "customer-feedback-rollup", name: "Customer feedback rollup" },
  { slug: "spec-doc-writer", name: "Spec doc writer" },
  { slug: "voice-memo-to-note", name: "Voice memo to note" },
];

export const TEAMS: ReadonlyArray<Team> = [
  {
    id: "team-engineering",
    name: "Engineering",
    description: "Builds the product. Full access to specs + competitor intel; read on customer feedback.",
    memberIds: ["m-alice", "m-olivia", "m-tim"],
    knowledgeAccess: [
      { slug: "product-specs", level: "edit" },
      { slug: "competitor-intel", level: "edit" },
      { slug: "customer-feedback", level: "read" },
      { slug: "networking-emails", level: "none" },
    ],
    skillAccess: [
      { slug: "spec-doc-writer", level: "edit" },
      { slug: "competitor-research-synthesis", level: "read" },
      { slug: "customer-feedback-rollup", level: "read" },
      { slug: "outbound-email-drafting", level: "none" },
      { slug: "voice-memo-to-note", level: "read" },
    ],
  },
  {
    id: "team-sales",
    name: "Sales",
    description: "Outbound + accounts. Owns networking emails, reads competitor intel.",
    memberIds: ["m-marcus", "m-diego"],
    knowledgeAccess: [
      { slug: "networking-emails", level: "edit" },
      { slug: "competitor-intel", level: "read" },
      { slug: "customer-feedback", level: "read" },
      { slug: "product-specs", level: "read" },
    ],
    skillAccess: [
      { slug: "outbound-email-drafting", level: "edit" },
      { slug: "competitor-research-synthesis", level: "read" },
      { slug: "voice-memo-to-note", level: "edit" },
      { slug: "spec-doc-writer", level: "none" },
      { slug: "customer-feedback-rollup", level: "read" },
    ],
  },
  {
    id: "team-product",
    name: "Product",
    description: "PMs + designers. Owns spec doc writer + customer feedback.",
    memberIds: ["m-liane", "m-jayna"],
    knowledgeAccess: [
      { slug: "product-specs", level: "edit" },
      { slug: "customer-feedback", level: "edit" },
      { slug: "competitor-intel", level: "read" },
      { slug: "networking-emails", level: "none" },
    ],
    skillAccess: [
      { slug: "spec-doc-writer", level: "edit" },
      { slug: "customer-feedback-rollup", level: "edit" },
      { slug: "competitor-research-synthesis", level: "read" },
      { slug: "voice-memo-to-note", level: "edit" },
      { slug: "outbound-email-drafting", level: "none" },
    ],
  },
  {
    id: "team-marketing",
    name: "Marketing",
    description: "Content + comms. Read access to most surfaces.",
    memberIds: ["m-anya", "m-jordan"],
    knowledgeAccess: [
      { slug: "competitor-intel", level: "read" },
      { slug: "customer-feedback", level: "read" },
      { slug: "networking-emails", level: "read" },
      { slug: "product-specs", level: "read" },
    ],
    skillAccess: [
      { slug: "outbound-email-drafting", level: "read" },
      { slug: "competitor-research-synthesis", level: "edit" },
      { slug: "customer-feedback-rollup", level: "read" },
      { slug: "spec-doc-writer", level: "none" },
      { slug: "voice-memo-to-note", level: "read" },
    ],
  },
];

export const MEMBERS: ReadonlyArray<Member> = [
  {
    id: "m-sam",
    name: "Sam Wang",
    email: "sam@usedopl.com",
    initial: "S",
    avatarGradient: "from-violet-500 to-fuchsia-500",
    role: "owner",
    teamIds: [],
    lastActive: "Just now",
    knowledgeAccess: KNOWLEDGE_BASES.map((kb) => ({ slug: kb.slug, level: "edit" })),
    skillAccess: SKILLS.map((s) => ({ slug: s.slug, level: "edit" })),
  },
  {
    id: "m-howard",
    name: "Howard Chang",
    email: "howard@usedopl.com",
    initial: "H",
    avatarGradient: "from-emerald-500 to-cyan-500",
    role: "admin",
    teamIds: [],
    lastActive: "12m ago",
    knowledgeAccess: KNOWLEDGE_BASES.map((kb) => ({ slug: kb.slug, level: "edit" })),
    skillAccess: SKILLS.map((s) => ({ slug: s.slug, level: "edit" })),
  },
  {
    id: "m-riley",
    name: "Riley Park",
    email: "riley@usedopl.com",
    initial: "R",
    avatarGradient: "from-sky-500 to-indigo-500",
    role: "member",
    teamIds: [],
    lastActive: "Joined yesterday",
    knowledgeAccess: [
      { slug: "networking-emails", level: "none" },
      { slug: "competitor-intel", level: "read" },
      { slug: "customer-feedback", level: "none" },
      { slug: "product-specs", level: "read" },
    ],
    skillAccess: [
      { slug: "outbound-email-drafting", level: "none" },
      { slug: "competitor-research-synthesis", level: "read" },
      { slug: "customer-feedback-rollup", level: "none" },
      { slug: "spec-doc-writer", level: "none" },
      { slug: "voice-memo-to-note", level: "read" },
    ],
  },
  {
    id: "m-alice",
    name: "Alice Chen",
    email: "alice@usedopl.com",
    initial: "A",
    avatarGradient: "from-pink-500 to-rose-500",
    role: "manager",
    teamIds: ["team-engineering"],
    lastActive: "2h ago",
    knowledgeAccess: [
      { slug: "product-specs", level: "edit" },
      { slug: "competitor-intel", level: "edit" },
      { slug: "customer-feedback", level: "read" },
      { slug: "networking-emails", level: "none" },
    ],
    skillAccess: [
      { slug: "spec-doc-writer", level: "edit" },
      { slug: "competitor-research-synthesis", level: "edit" },
      { slug: "customer-feedback-rollup", level: "read" },
      { slug: "outbound-email-drafting", level: "none" },
      { slug: "voice-memo-to-note", level: "read" },
    ],
  },
  {
    id: "m-olivia",
    name: "Olivia Ferguson",
    email: "olivia@usedopl.com",
    initial: "O",
    avatarGradient: "from-orange-500 to-amber-500",
    role: "member",
    teamIds: ["team-engineering"],
    lastActive: "Yesterday",
    knowledgeAccess: [
      { slug: "product-specs", level: "edit" },
      { slug: "competitor-intel", level: "edit" },
      { slug: "customer-feedback", level: "read" },
      { slug: "networking-emails", level: "none" },
    ],
    skillAccess: [
      { slug: "spec-doc-writer", level: "edit" },
      { slug: "competitor-research-synthesis", level: "read" },
      { slug: "customer-feedback-rollup", level: "read" },
      { slug: "outbound-email-drafting", level: "none" },
      { slug: "voice-memo-to-note", level: "read" },
    ],
  },
  {
    id: "m-tim",
    name: "Tim Nguyen",
    email: "tim@usedopl.com",
    initial: "T",
    avatarGradient: "from-blue-500 to-indigo-500",
    role: "member",
    teamIds: ["team-engineering"],
    lastActive: "3d ago",
    knowledgeAccess: [
      { slug: "product-specs", level: "edit" },
      { slug: "competitor-intel", level: "read" },
      { slug: "customer-feedback", level: "read" },
      { slug: "networking-emails", level: "none" },
    ],
    skillAccess: [
      { slug: "spec-doc-writer", level: "edit" },
      { slug: "competitor-research-synthesis", level: "read" },
      { slug: "customer-feedback-rollup", level: "none" },
      { slug: "outbound-email-drafting", level: "none" },
      { slug: "voice-memo-to-note", level: "read" },
    ],
  },
  {
    id: "m-marcus",
    name: "Marcus Lee",
    email: "marcus@usedopl.com",
    initial: "M",
    avatarGradient: "from-teal-500 to-emerald-500",
    role: "manager",
    teamIds: ["team-sales"],
    lastActive: "1h ago",
    knowledgeAccess: [
      { slug: "networking-emails", level: "edit" },
      { slug: "competitor-intel", level: "read" },
      { slug: "customer-feedback", level: "read" },
      { slug: "product-specs", level: "read" },
    ],
    skillAccess: [
      { slug: "outbound-email-drafting", level: "edit" },
      { slug: "competitor-research-synthesis", level: "read" },
      { slug: "voice-memo-to-note", level: "edit" },
      { slug: "spec-doc-writer", level: "none" },
      { slug: "customer-feedback-rollup", level: "read" },
    ],
  },
  {
    id: "m-diego",
    name: "Diego Rivera",
    email: "diego@usedopl.com",
    initial: "D",
    avatarGradient: "from-yellow-500 to-orange-500",
    role: "member",
    teamIds: ["team-sales"],
    lastActive: "30m ago",
    knowledgeAccess: [
      { slug: "networking-emails", level: "edit" },
      { slug: "competitor-intel", level: "read" },
      { slug: "customer-feedback", level: "none" },
      { slug: "product-specs", level: "read" },
    ],
    skillAccess: [
      { slug: "outbound-email-drafting", level: "edit" },
      { slug: "competitor-research-synthesis", level: "read" },
      { slug: "voice-memo-to-note", level: "read" },
      { slug: "spec-doc-writer", level: "none" },
      { slug: "customer-feedback-rollup", level: "none" },
    ],
  },
  {
    id: "m-liane",
    name: "Liane Park",
    email: "liane@usedopl.com",
    initial: "L",
    avatarGradient: "from-fuchsia-500 to-pink-500",
    role: "manager",
    teamIds: ["team-product"],
    lastActive: "5h ago",
    knowledgeAccess: [
      { slug: "product-specs", level: "edit" },
      { slug: "customer-feedback", level: "edit" },
      { slug: "competitor-intel", level: "read" },
      { slug: "networking-emails", level: "none" },
    ],
    skillAccess: [
      { slug: "spec-doc-writer", level: "edit" },
      { slug: "customer-feedback-rollup", level: "edit" },
      { slug: "competitor-research-synthesis", level: "read" },
      { slug: "voice-memo-to-note", level: "edit" },
      { slug: "outbound-email-drafting", level: "none" },
    ],
  },
  {
    id: "m-jayna",
    name: "Jayna Sanders",
    email: "jayna@usedopl.com",
    initial: "J",
    avatarGradient: "from-cyan-500 to-blue-500",
    role: "member",
    teamIds: ["team-product"],
    lastActive: "Yesterday",
    knowledgeAccess: [
      { slug: "product-specs", level: "edit" },
      { slug: "customer-feedback", level: "edit" },
      { slug: "competitor-intel", level: "read" },
      { slug: "networking-emails", level: "none" },
    ],
    skillAccess: [
      { slug: "spec-doc-writer", level: "edit" },
      { slug: "customer-feedback-rollup", level: "edit" },
      { slug: "competitor-research-synthesis", level: "read" },
      { slug: "voice-memo-to-note", level: "edit" },
      { slug: "outbound-email-drafting", level: "none" },
    ],
  },
  {
    id: "m-anya",
    name: "Anya Lerner",
    email: "anya@usedopl.com",
    initial: "A",
    avatarGradient: "from-purple-500 to-violet-500",
    role: "manager",
    teamIds: ["team-marketing"],
    lastActive: "4h ago",
    knowledgeAccess: [
      { slug: "competitor-intel", level: "read" },
      { slug: "customer-feedback", level: "read" },
      { slug: "networking-emails", level: "read" },
      { slug: "product-specs", level: "read" },
    ],
    skillAccess: [
      { slug: "outbound-email-drafting", level: "read" },
      { slug: "competitor-research-synthesis", level: "edit" },
      { slug: "customer-feedback-rollup", level: "read" },
      { slug: "spec-doc-writer", level: "none" },
      { slug: "voice-memo-to-note", level: "read" },
    ],
  },
  {
    id: "m-jordan",
    name: "Jordan Howard",
    email: "jordan@usedopl.com",
    initial: "J",
    avatarGradient: "from-red-500 to-pink-500",
    role: "viewer",
    teamIds: ["team-marketing"],
    lastActive: "2d ago",
    knowledgeAccess: [
      { slug: "competitor-intel", level: "read" },
      { slug: "customer-feedback", level: "read" },
      { slug: "networking-emails", level: "none" },
      { slug: "product-specs", level: "read" },
    ],
    skillAccess: [
      { slug: "outbound-email-drafting", level: "none" },
      { slug: "competitor-research-synthesis", level: "read" },
      { slug: "customer-feedback-rollup", level: "read" },
      { slug: "spec-doc-writer", level: "none" },
      { slug: "voice-memo-to-note", level: "read" },
    ],
  },
];

export function findMember(id: string): Member | undefined {
  return MEMBERS.find((m) => m.id === id);
}

export function findTeam(id: string): Team | undefined {
  return TEAMS.find((t) => t.id === id);
}
