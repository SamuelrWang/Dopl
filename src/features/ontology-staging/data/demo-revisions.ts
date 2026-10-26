/**
 * Seed changelog rows (`@/features/revisions/types › Revision`) so the History
 * section and the Changelog face open on a realistic, day-grouped timeline. New
 * rows are appended live by the staging server as the board is edited.
 */

import type { Revision, RevisionActor, RevisionOp, RevisionPayload } from "@/features/revisions/types";
import { STAGING_HOME_WORKSPACE_ID, STAGING_VIEWER, minsAgoIso } from "@/features/ui-staging/staging-stubs";

/** A revision plus which ontology's changelog it belongs to. */
export interface StagedRevision {
  revision: Revision;
  ontologyId: string;
}

export const OPERATOR_ACTOR: RevisionActor = {
  userId: STAGING_VIEWER.userId,
  kind: "user",
  agentSessionId: null,
  displayName: STAGING_VIEWER.displayName,
  avatarUrl: STAGING_VIEWER.avatarUrl,
};

export const AGENT_ACTOR: RevisionActor = {
  userId: STAGING_VIEWER.userId,
  kind: "agent",
  agentSessionId: "sess-pipeline-scout",
  displayName: "Pipeline Scout",
  avatarUrl: null,
};

let seq = 0;
export function makeRevision(
  ontologyId: string,
  resource: { type: "ontology" | "ontology_object"; id: string },
  op: RevisionOp,
  payload: RevisionPayload,
  at: string,
  actor: RevisionActor = OPERATOR_ACTOR,
  summary: string | null = null
): StagedRevision {
  seq += 1;
  return {
    ontologyId,
    revision: {
      id: `rev-${seq}-${Math.random().toString(36).slice(2, 8)}`,
      resourceType: resource.type,
      resourceId: resource.id,
      workspaceId: STAGING_HOME_WORKSPACE_ID,
      actor,
      op,
      summary,
      payload,
      contentHash: `h${seq}`,
      createdAt: at,
      updatedAt: at,
    },
  };
}

const obj = (id: string) => ({ type: "ontology_object" as const, id });
const ont = (id: string) => ({ type: "ontology" as const, id });
const d = (days: number, mins = 0) => minsAgoIso(days * 24 * 60 + mins);

export function demoRevisions(): StagedRevision[] {
  return [
    makeRevision("ont-sales", ont("ont-sales"), "create", {
      fields: { name: "Sales pipeline", purpose: "", agentsMayEdit: true },
    }, d(6, 40)),
    makeRevision("ont-sales", obj("acct-northwind"), "create", {
      fields: { name: "Northwind Traders", subtitle: "", "attribute:stage": { kind: "enum", value: "Prospect" } },
    }, d(6, 20)),
    makeRevision("ont-sales", ont("ont-sales"), "edit", {
      field: "purpose", before: "", after: "Accounts, contacts and deals the outbound agents work from.",
    }, d(5, 300)),
    makeRevision("ont-sales", obj("acct-northwind"), "edit", {
      field: "attribute:stage", before: { kind: "enum", value: "Qualified" }, after: { kind: "enum", value: "Customer" },
    }, d(3, 90), AGENT_ACTOR),
    makeRevision("ont-sales", obj("acct-northwind"), "edit", {
      field: "attribute:seats", before: { kind: "number", value: "250" }, after: { kind: "number", value: "400" },
    }, d(3, 85), AGENT_ACTOR),
    makeRevision("ont-sales", obj("deal-nw-expansion"), "rename", {
      field: "name", before: "Northwind upsell", after: "Northwind expansion",
    }, d(1, 200)),
    makeRevision("ont-sales", obj("deal-nw-expansion"), "edit", {
      association: "relationship", field: "relationship", before: null, after: { label: "champion", targetIds: ["ct-hana"] },
    }, d(1, 190)),
    makeRevision("ont-sales", obj("ct-hana"), "edit", {
      field: "subtitle", before: "Operations", after: "COO, Northwind",
    }, d(0, 240), AGENT_ACTOR),
    makeRevision("ont-sales", obj("deal-lattice-pilot"), "edit", {
      field: "attribute:amount", before: { kind: "number", value: "9000" }, after: { kind: "number", value: "12000" },
    }, d(0, 45)),
    makeRevision("ont-sales", ont("ont-sales"), "edit", {
      association: "share", field: "share:ch-outbound", before: null,
      after: { membersLevel: "edit", guestsLevel: "view", ownerAgentsLevel: "edit" },
    }, d(0, 30)),
    makeRevision("ont-roadmap", ont("ont-roadmap"), "create", {
      fields: { name: "Product roadmap", purpose: "What ships when, and what is broken.", agentsMayEdit: false },
    }, d(9)),
    makeRevision("ont-roadmap", obj("ft-staging"), "edit", {
      field: "attribute:status", before: { kind: "enum", value: "Planned" }, after: { kind: "enum", value: "Building" },
    }, d(0, 120)),
    makeRevision("ont-roadmap", obj("bug-signout"), "edit", {
      field: "attribute:severity", before: { kind: "enum", value: "P2" }, after: { kind: "enum", value: "P1" },
    }, d(2, 10), AGENT_ACTOR),
    makeRevision("ont-hiring", ont("ont-hiring"), "create", {
      fields: { name: "Hiring", purpose: "", agentsMayEdit: true },
    }, d(4)),
    makeRevision("ont-hiring", obj("cand-sofia"), "edit", {
      field: "attribute:stage", before: { kind: "enum", value: "Onsite" }, after: { kind: "enum", value: "Offer" },
    }, d(0, 15)),
  ];
}
