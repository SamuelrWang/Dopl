import type { GraphLayout } from "@/shared/graph";
import type { Role } from "@/features/workspaces/types";

export type AttributeValue =
  | { kind: "text"; value: string }
  | { kind: "pill"; value: string }
  /** References to other objects — individual cards or whole columns. */
  | { kind: "ref"; value: string[] }
  /** Workspace knowledge-base entries the agent should read (access-gated). */
  | { kind: "knowledge"; value: string[] }
  /** Workspace skills the agent should use (access-gated). */
  | { kind: "skill"; value: string[] };

export interface ObjectAttribute {
  key: string;
  label: string;
  value: AttributeValue;
}

/** One field of a column's object template: label + kind, no value. New
 *  children are born with these as empty attributes. */
export interface TemplateField {
  key: string;
  label: string;
  kind: AttributeValue["kind"];
}

export interface ObjectRelationship {
  /** Edge label, e.g. "member of", "assigned to". */
  label: string;
  targetIds: string[];
}

export interface ObjectMethod {
  name: string;
  description: string;
  /** What the result of the action should be, e.g. "Follow-up email sent and logged". */
  outcome: string;
  /** Tools the agent should use to perform it, e.g. "Gmail, LinkedIn". */
  tools: string;
}

export interface OntologyObject {
  id: string;
  name: string;
  subtitle: string;
  attributes: ObjectAttribute[];
  relationships: ObjectRelationship[];
  methods: ObjectMethod[];
  /** Contained objects. Columns are objects too — their children are the cards. */
  childIds: string[];
  /** Column-only: default fields for new children. */
  template: TemplateField[];
  /** Optimistic-concurrency token (row's `updated_at`). Passed back as the
   *  `X-Updated-At` precondition → 412 if the object changed underneath.
   *  Optional so existing object literals stay valid. */
  updatedAt?: string;
}

export interface OntologyCluster {
  id: string;
  /** URL handle (`/[workspace]/ontology/[slug]`). Stable across renames. */
  slug: string;
  name: string;
  purpose: string;
  /** The cluster's columns — each a container object whose children are the cards. */
  columnIds: string[];
  /** Persisted dragged node positions (id → {x,y}); `{}` = pure auto-layout. */
  layout: GraphLayout;
  /**
   * Samuel's SOLO TOGGLE (`ontology_clusters.agents_may_edit`, spec §3.1).
   *
   * ⚠ **OPTIONAL BECAUSE A CACHED SNAPSHOT PREDATES IT** (INVARIANTS §8, the
   * stale-cache rule): `GET /api/ontology`'s body is served from IndexedDB on
   * the first paint after an upgrade. Every consumer goes through
   * `hooks/use-ontologies.ts › ontologyListRows`, which falls back to the COLUMN
   * DEFAULT `true` — a fact about a row nobody has narrowed.
   */
  agentsMayEdit?: boolean;
  /**
   * How many home channels this ontology is lent into (spec Q4 — the delete
   * confirm's count, and the card's line).
   *
   * ⚠ **ABSENT IS "UNKNOWN", NEVER ZERO**, which is why the fallback differs
   * from `agentsMayEdit`'s: a stale payload carried no share rows at all, and a
   * card that rendered "shared into 0 channels" would be claiming something
   * nobody read. ⚠ **EMITTED ONLY FOR CLUSTERS THE CALLER OWNS** — how widely
   * somebody else's ontology is lent is their business, not a lent reader's.
   */
  sharedChannelCount?: number;
}

/** Full workspace ontology as the API serves it — the UI store's shape. */
export interface OntologySnapshot {
  clusters: OntologyCluster[];
  objects: Record<string, OntologyObject>;
}

/** A workspace knowledge base or skill, with the caller's access resolved. */
export interface WorkspaceResource {
  id: string;
  name: string;
  /** Where it's shared from — groups the picker. */
  scope: string;
  /** Resolved per caller — the picker only ever shows accessible items. */
  accessible: boolean;
}

/**
 * THE LEVEL LADDER — `none < view < edit`, and the ONLY vocabulary the
 * home-ontology sharing model speaks (spec §1, I2).
 *
 * ⚠ NOT `resource_grants`'s channel vocabulary (`agent_only | visible`), which
 * is two AUDIENCES rather than rungs. Two words that look like a level and are
 * not comparable is how a `min` gets written against the wrong table.
 */
export const ONTOLOGY_LEVELS = ["none", "view", "edit"] as const;
export type OntologyLevel = (typeof ONTOLOGY_LEVELS)[number];

const LEVEL_RANK: Record<OntologyLevel, number> = { none: 0, view: 1, edit: 2 };

/** I2 — `edit` ⇒ `view`. One ladder compared by RANK, never two booleans. */
export function meetsLevel(actual: OntologyLevel, min: OntologyLevel): boolean {
  return LEVEL_RANK[actual] >= LEVEL_RANK[min];
}

/** The narrower of two rungs — I1's `min`, written once. */
export function narrowerLevel(a: OntologyLevel, b: OntologyLevel): OntologyLevel {
  return LEVEL_RANK[a] <= LEVEL_RANK[b] ? a : b;
}

/**
 * One `(ontology, channel)` share row on the wire — a COMPLETE statement about
 * three audiences (I4), which is why `none` is a stored value and unsharing is
 * a row DELETE rather than three `none`s.
 */
export interface OntologyShare {
  channelId: string;
  membersLevel: OntologyLevel;
  guestsLevel: OntologyLevel;
  ownerAgentsLevel: OntologyLevel;
}

/** Session vs. agent token — the `last_edited_source` literal, and the axis
 *  `resolveOntologyAudience` branches the owner arm on. */
export type OntologyWriteSource = "user" | "agent";

/**
 * Request-scoped ontology context.
 *
 * ⚠ IT CARRIES THE CREDENTIAL AXES (INVARIANTS §4A/§11) BECAUSE THE AUDIENCE
 * ASKS BOTH: `source` says whether an AGENT is asking (the solo toggle and
 * `owner_agents_level` arms), and `credentialSubjectUserId` says whether the
 * credential stands for a PERSON at all — a shared credential inherits nobody's
 * reach and therefore reaches no home ontology.
 *
 * ⚠ `role` is the caller's role in {@link OntologyContext.workspaceId} and is
 * the MEMBER-vs-GUEST class the share row is read at. It is not a level.
 */
export interface OntologyContext {
  workspaceId: string;
  userId: string;
  role: Role;
  source: OntologyWriteSource;
  credentialSubjectUserId: string | null;
  /**
   * `X-Dopl-Session-Id` verbatim (the desktop's slot key), or `null` for every
   * caller that sends none.
   *
   * ⚠ A NON-AUTHORIZATION SIGNAL (`shared/auth/session-header.ts`) and the ONLY
   * forgeable field on this context. It is read in exactly one place — the
   * CHANGELOG's actor (`revisions/server/service.ts › deriveActor`), which
   * stamps it for AGENT writes so a session's edits group visually. Nothing
   * grants on it and no gate in this feature reads it.
   */
  sessionId?: string | null;
}
