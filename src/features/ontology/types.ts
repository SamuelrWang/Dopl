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
   * The solo toggle (`ontology_clusters.agents_may_edit`, spec §3.1). Optional
   * because a cached snapshot predates it (INVARIANTS §8); every consumer goes
   * through `hooks/use-ontologies.ts › ontologyListRows`, which falls back to the
   * column default `true`.
   */
  agentsMayEdit?: boolean;
  /**
   * How many home channels this ontology is lent into (spec Q4). Absent is
   * unknown, never zero: a stale payload carried no share rows, and "shared into 0
   * channels" would be a claim nobody read. Emitted only for clusters the caller
   * owns.
   */
  sharedChannelCount?: number;
}

/** Full workspace ontology as the API serves it — the UI store's shape. */
export interface OntologySnapshot {
  clusters: OntologyCluster[];
  objects: Record<string, OntologyObject>;
  /**
   * 🔒 **WHICH CLUSTERS CAME OFF THE CALLER'S OWN PERSONAL SHELF** (S29c,
   * 2026-09-18) — the ontology twin of `KbBasesPayload.homeScopedBaseIds`.
   *
   * ⚠ **ABSENT IS "NOT ANSWERED", NEVER "NONE".** A payload cached against an
   * older server carries no such key, and a reader that defaulted it to `[]`
   * would state that every row lives in the calling container — the exact claim
   * this field exists to stop being made by accident. Every render falls back to
   * a FROZEN EMPTY and files no row under the personal label.
   *
   * ⚠ **A LABEL, NOT A FENCE.** Nothing filters on it: every cluster listed
   * already cleared `levelForCluster`.
   */
  personalClusterIds?: string[];
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
 * The level ladder — `none < view < edit`, the only vocabulary the home-ontology
 * sharing model speaks (spec §1, I2). Not `resource_grants`'s channel vocabulary
 * (`agent_only | visible`), which is two audiences rather than comparable rungs.
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
 * One `(ontology, channel)` share row on the wire — a complete statement about
 * three audiences (I4), which is why `none` is a stored value and unsharing is a
 * row DELETE rather than three `none`s.
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
 * Request-scoped ontology context. It carries both credential axes (INVARIANTS
 * §4A/§11) because the audience asks both: `source` says whether an agent is
 * asking, and `credentialSubjectUserId` whether the credential stands for a person
 * at all — a shared credential inherits nobody's reach and so reaches no home
 * ontology.
 *
 * `role` is the caller's role in {@link OntologyContext.workspaceId} — the
 * member-vs-guest class the share row is read at, not a level.
 */
export interface OntologyContext {
  workspaceId: string;
  userId: string;
  role: Role;
  source: OntologyWriteSource;
  credentialSubjectUserId: string | null;
  /**
   * `X-Dopl-Session-Id` verbatim (the desktop's slot key), or `null`.
   *
   * A non-authorization signal (`shared/auth/session-header.ts`) and the only
   * forgeable field here. Read in exactly one place — the changelog's actor
   * (`revisions/server/service.ts › deriveActor`). Nothing grants on it.
   */
  sessionId?: string | null;
}
