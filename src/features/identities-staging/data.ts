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

const GRACE = STAGING_PEOPLE[1];
const ANTHONY = STAGING_PEOPLE[2];

// ─── The selected channel ────────────────────────────────────────────

/** The subset of `@/features/channels/types › Channel` the Identities face reads. */
export interface StagingChannel {
  id: string;
  workspaceId: string;
  name: string;
  myWorkspaceRole: Role;
}

export const STAGING_CHANNEL: StagingChannel = {
  id: CHANNEL_ID,
  workspaceId: CONTAINER_WORKSPACE_ID,
  name: "tech-debt",
  myWorkspaceRole: "owner",
};

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

