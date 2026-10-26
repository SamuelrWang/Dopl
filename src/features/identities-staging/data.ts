/**
 * UI-STAGING FAKE DATA for /identities — the agent identities, the selected channel, the
 * runtimes + model catalogs the editor offers, and (borrowed from `/knowledge`'s seed so the two
 * staged pages agree) the knowledge an identity can attach. Pure data: no Supabase, no fetch, no
 * Electron bridge.
 */

import type {
  AgentIdentity,
  IdentityKnowledgeRef,
} from "@/features/agent-identities/client/types";
import type {
  IdentityCardFace,
  IdentityCardStats,
} from "./agent-identities/components/identity-section";
import type { ModelCatalog, ModelCatalogs } from "@/features/channels/lib/model-catalog";
import type { RuntimeDescriptor } from "@/features/channels/lib/runtime-capability";
import type { Role } from "@/features/workspaces/types";
import {
  STAGING_HOME_WORKSPACE_ID,
  STAGING_PEOPLE,
  STAGING_USER_ID,
  daysAgoIso,
} from "@/features/ui-staging/staging-stubs";
import {
  SEED_BASES,
  SEED_ENTRIES,
  SEED_FOLDERS,
  CONTAINER_WORKSPACE_ID,
  CHANNEL_ID,
} from "@/features/knowledge-staging/data";

export { STAGING_HOME_WORKSPACE_ID, STAGING_USER_ID, CONTAINER_WORKSPACE_ID };
export { SEED_BASES as KNOWLEDGE_BASES, SEED_FOLDERS as KNOWLEDGE_FOLDERS, SEED_ENTRIES as KNOWLEDGE_ENTRIES };
export type { IdentityCardFace, IdentityCardStats };

const GRACE = STAGING_PEOPLE[1];
const ANTHONY = STAGING_PEOPLE[2];

// ─── The selected channel ────────────────────────────────────────────

/** The subset of `@/features/channels/types › Channel` the Identities face reads. */
export interface StagingChannel {
  id: string;
  workspaceId: string;
  name: string;
  isDirect: boolean;
  myWorkspaceRole: Role;
  peers: ReadonlyArray<{ userId: string; displayName: string | null }>;
}

export const STAGING_CHANNEL: StagingChannel = {
  id: CHANNEL_ID,
  workspaceId: CONTAINER_WORKSPACE_ID,
  name: "tech-debt",
  isDirect: false,
  myWorkspaceRole: "owner",
  peers: [
    { userId: GRACE.userId, displayName: GRACE.displayName ?? null },
    { userId: ANTHONY.userId, displayName: ANTHONY.displayName ?? null },
  ],
};

/** `apps/desktop-ui/src/pages/home/home-rows.ts › channelPeople`, over the staged channel. */
export function channelPeople(channel: StagingChannel) {
  return channel.peers;
}

/** `home-rows.ts › channelTitle` — the channel's own name, always. */
export function channelTitle(channel: StagingChannel): string {
  return channel.name;
}

// ─── Runtimes + model catalogs (the editor's Runtime / Model rows) ───

export const STAGING_RUNTIMES: RuntimeDescriptor[] = [
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
];

function catalog(
  runtime: string,
  models: Array<{ id: string; label: string; short: string; isDefault?: boolean }>
): ModelCatalog {
  return {
    runtime,
    source: "staging",
    status: "ready",
    reason: "",
    models: models.map((m) => ({
      id: m.id,
      label: m.label,
      short: m.short,
      isDefault: m.isDefault ?? false,
      hidden: false,
      dimensions: {},
      aliases: [],
    })),
    defaultId: models.find((m) => m.isDefault)?.id ?? null,
    dimensions: [],
    truncated: false,
  };
}

export const STAGING_CATALOGS: ModelCatalogs = {
  claude: catalog("claude", [
    { id: "claude-opus-5-5", label: "Claude Opus 5.5", short: "Opus 5.5", isDefault: true },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5", short: "Sonnet 5" },
    { id: "claude-haiku-5", label: "Claude Haiku 5", short: "Haiku 5" },
  ]),
  codex: catalog("codex", [
    { id: "gpt-6", label: "GPT-6", short: "GPT-6", isDefault: true },
    { id: "gpt-6-luna", label: "GPT-6 Luna", short: "Luna" },
  ]),
};

// ─── Knowledge refs (what a card's "Add knowledge" box lists) ───────

function baseRef(baseId: string): IdentityKnowledgeRef {
  const b = SEED_BASES.find((x) => x.id === baseId)!;
  return { baseId: b.id, baseName: b.name, scope: "base", path: b.name };
}

function folderRef(folderId: string): IdentityKnowledgeRef {
  const f = SEED_FOLDERS.find((x) => x.id === folderId)!;
  const b = SEED_BASES.find((x) => x.id === f.knowledgeBaseId)!;
  return {
    baseId: b.id,
    baseName: b.name,
    scope: "folder",
    folderId: f.id,
    folderName: f.name,
    path: `${b.name} / ${f.name}`,
    toolPath: f.name,
  };
}

function entryRef(entryId: string): IdentityKnowledgeRef {
  const e = SEED_ENTRIES.find((x) => x.id === entryId)!;
  const b = SEED_BASES.find((x) => x.id === e.knowledgeBaseId)!;
  const f = e.folderId ? SEED_FOLDERS.find((x) => x.id === e.folderId) : null;
  return {
    baseId: b.id,
    baseName: b.name,
    scope: "entry",
    entryId: e.id,
    entryTitle: e.title,
    path: [b.name, f?.name, e.title].filter(Boolean).join(" / "),
    toolPath: [f?.name, `${e.title}.md`].filter(Boolean).join("/"),
  };
}

// ─── Identities ──────────────────────────────────────────────────────

function identity(
  id: string,
  workspaceId: string,
  name: string,
  description: string | null,
  opts: Partial<AgentIdentity> = {}
): AgentIdentity {
  const knowledge = opts.knowledge ?? [];
  return {
    id,
    workspaceId,
    name,
    description,
    instructions: null,
    model: null,
    runtime: null,
    fields: [],
    visibility: "private",
    teamIds: [],
    knowledgeBases: knowledge
      .filter((k) => k.scope === "base")
      .map((k) => ({ id: k.baseId, name: k.baseName })),
    knowledge,
    unreachableKnowledgeBaseCount: 0,
    createdBy: STAGING_USER_ID,
    createdAt: daysAgoIso(30),
    updatedAt: daysAgoIso(2),
    ...opts,
  };
}

/** Shared in #tech-debt: the channel's link container, `visibility: "workspace"`. */
const SHARED: AgentIdentity[] = [
  identity("id-release", CONTAINER_WORKSPACE_ID, "Release Captain", "Runs the release checklist, cuts the build and posts notes in #releases.", {
    visibility: "workspace",
    createdBy: GRACE.userId,
    model: "claude-opus-5-5",
    runtime: "claude",
    instructions:
      "You own the release. Walk the checklist in Platform Runbooks / Deploys, in order, and stop at the first red gate.",
    fields: [
      { key: "channel", value: "#releases" },
      { key: "max_batch", value: "12", type: "number" },
    ],
    knowledge: [baseRef("kb-runbooks")],
  }),
  identity("id-postmortem", CONTAINER_WORKSPACE_ID, "Postmortem Writer", "Drafts blameless postmortems from the incident channel and the deploy log.", {
    visibility: "workspace",
    model: "claude-sonnet-5",
    runtime: "claude",
    knowledge: [baseRef("kb-postmortems")],
  }),
  identity("id-sql", CONTAINER_WORKSPACE_ID, "SQL Reviewer", "Reads every migration before it ships. Byte-exact, by name, md5-verified.", {
    visibility: "workspace",
    createdBy: ANTHONY.userId,
    model: "gpt-6",
    runtime: "codex",
    knowledge: [entryRef("e-migrations")],
    // Two attachments the viewer cannot read — exercises the editor's "aren't reachable" line.
    unreachableKnowledgeBaseCount: 2,
  }),
  // Item 3c: the page shows every channel by default, so the shared set has to span more than
  // one or the scope control has nothing to scope. Reach lives in `page/identity-page-data.ts`.
  identity("id-critic", CONTAINER_WORKSPACE_ID, "Design Critic", "Reviews a screen against the design language and says which rule it breaks.", {
    visibility: "workspace",
    createdBy: GRACE.userId,
    model: "claude-sonnet-5",
    runtime: "claude",
    knowledge: [baseRef("kb-runbooks")],
  }),
  identity("id-flake", CONTAINER_WORKSPACE_ID, "Flake Hunter", "Reruns a failing test until it can say what makes it flaky.", {
    visibility: "workspace",
    model: "gpt-6",
    runtime: "codex",
  }),
];

/** Personal: the operator's own private identities on the home shelf. */
const PERSONAL: AgentIdentity[] = [
  identity("id-coder", STAGING_HOME_WORKSPACE_ID, "Coder", "Daniel as an engineer: TypeScript, Swift, small diffs, tests first.", {
    model: "claude-opus-5-5",
    runtime: "claude",
    instructions:
      "Work like Daniel does: read INVARIANTS first, keep diffs small, run the targeted typecheck and tests before saying done.",
    fields: [
      { key: "repo", value: "https://github.com/dopl/setup-intelligence-engine", type: "url" },
      { key: "ship_without_review", value: "no", type: "boolean" },
    ],
    knowledge: [baseRef("kb-runbooks"), entryRef("e-rollback")],
  }),
  identity("id-researcher", STAGING_HOME_WORKSPACE_ID, "Researcher", "Finds primary sources, summarizes them and files the notes.", {
    model: "gpt-6-luna",
    runtime: "codex",
    knowledge: [folderRef("f-ideas")],
  }),
  identity("id-recruiter", STAGING_HOME_WORKSPACE_ID, "Recruiter", "Screens candidates against the platform role brief and books loops.", {
    model: "claude-sonnet-5",
    runtime: "claude",
    knowledge: [baseRef("kb-hiring")],
  }),
  identity("id-writer", STAGING_HOME_WORKSPACE_ID, "Writer", null),
  identity("id-chief", STAGING_HOME_WORKSPACE_ID, "Chief of Staff", "Keeps the week on track: standups, follow-ups, the Monday digest.", {
    model: "claude-haiku-5",
    runtime: "claude",
    fields: [{ key: "digest_day", value: "2026-10-26", type: "date" }],
    knowledge: [folderRef("f-meetings")],
  }),
];

export const SEED_IDENTITIES: AgentIdentity[] = [...SHARED, ...PERSONAL];

/**
 * One personal identity whose launch is REFUSED, so the card's refusal line is reachable by
 * clicking Launch on it. The sentence is the shape `launchRefusalText` produces for a runtime
 * that is not signed in.
 */
export const REFUSED_LAUNCH: Record<string, string> = {
  "id-researcher": "Codex isn't signed in on this computer. Sign in from Settings → Runtimes, then launch again.",
};

// ─── The card's face: whose identity it is, and what it runs on ──────

/**
 * Runtime id → the logo its badge wears, the same files the login journey and the landing demo
 * use (`src/app/(auth)/auth-shell.tsx › WEB_LOGIN_IMAGES`; Codex is OpenAI's, so it takes the
 * ChatGPT mark). Staging-only: in the product this comes off the runtime registry beside
 * `RuntimeDescriptor.label`, which carries no logo yet (PORTING.md).
 */
const RUNTIME_LOGOS: Record<string, string> = {
  claude: "/img/onboarding/claude-logo.svg",
  codex: "/img/onboarding/chatgpt-logo.svg",
};

/**
 * The owner's photo plus the runtime badge, from the staged roster
 * (`ui-staging/staging-stubs.ts › STAGING_PEOPLE`) and {@link STAGING_RUNTIMES}. An author the
 * roster cannot name keeps a face with no photo — the same shape as a member with no avatar, and
 * never a stand-in for someone else.
 */
/**
 * MOCK LIVE STATE, item 2b: how many agents are running from a row, when it was last used, and
 * who else in the channel can wear a shared one. Allowed on the staged card as mock data (ask
 * §2b checklist 2); final inclusion is Samuel's pick, so nothing is wired to a real read.
 *
 * ⚠ `lastUsed` is a LITERAL LABEL, not a timestamp, on purpose: the staged clock is fixed
 * (`ui-staging/staging-stubs.ts`) and a relative label computed against the real clock renders
 * differently on the server and the client. In the product it is `updatedAt` through a relative
 * formatter, client-side.
 */
const CARD_STATE: Record<string, { running: number; lastUsed: string | null }> = {
  "id-release": { running: 1, lastUsed: "40m ago" },
  "id-postmortem": { running: 0, lastUsed: "3d ago" },
  "id-sql": { running: 2, lastUsed: "15m ago" },
  "id-coder": { running: 1, lastUsed: "5m ago" },
  "id-researcher": { running: 0, lastUsed: "2d ago" },
  "id-recruiter": { running: 0, lastUsed: "9d ago" },
  "id-critic": { running: 0, lastUsed: "1h ago" },
  "id-flake": { running: 1, lastUsed: "3m ago" },
  "id-writer": { running: 0, lastUsed: null },
  "id-chief": { running: 0, lastUsed: "20m ago" },
};

/** Who can wear a shared row: the channel's people, the author first. Mock, like {@link CARD_STATE}. */
const WORN_BY: Record<string, ReadonlyArray<string>> = {
  "id-release": [GRACE.userId, STAGING_USER_ID, ANTHONY.userId],
  "id-postmortem": [STAGING_USER_ID, GRACE.userId],
  "id-sql": [ANTHONY.userId, STAGING_USER_ID],
  "id-critic": [GRACE.userId, STAGING_USER_ID],
  "id-flake": [STAGING_USER_ID, ANTHONY.userId],
};

export function identityCardStats(identity: AgentIdentity): IdentityCardStats {
  const state = CARD_STATE[identity.id] ?? { running: 0, lastUsed: null };
  const wornBy = (WORN_BY[identity.id] ?? []).flatMap((userId) => {
    const person = STAGING_PEOPLE.find((p) => p.userId === userId);
    return person
      ? [
          {
            userId: person.userId,
            displayName: person.displayName ?? person.email ?? "Member",
            avatarUrl: person.avatarUrl ?? null,
          },
        ]
      : [];
  });
  return { ...state, wornBy };
}

export function identityCardFace(identity: AgentIdentity): IdentityCardFace {
  const owner = STAGING_PEOPLE.find((p) => p.userId === identity.createdBy);
  const runtime = identity.runtime;
  return {
    photo: owner?.avatarUrl ?? null,
    runtimeLogo: runtime ? RUNTIME_LOGOS[runtime] ?? null : null,
    runtimeLabel:
      STAGING_RUNTIMES.find((r) => r.id === runtime)?.label ?? runtime ?? null,
  };
}
