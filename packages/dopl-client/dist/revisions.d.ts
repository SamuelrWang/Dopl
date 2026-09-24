/**
 * HISTORY + RESTORE for durable content: knowledge entries, skills and
 * ontology objects. Every route here already existed for the app's Changelog panels and is
 * agent-reachable by design (a restore APPENDS a revision and destroys nothing, so none is
 * `sessionOnly`); the server's write gates — `assertBaseWritable` / `agent_write_enabled`, the
 * skill toggle, the ontology share level — are what fence an agent.
 *
 * ⚠ EVERY RESTORE TAKES `expectedVersion`, sent as `X-Updated-At` — the same precondition the
 * write routes take, so a restore over a newer edit is a 412 rather than a silent clobber.
 */
import type { DoplTransport } from "./transport.js";
import type { KnowledgeEntry } from "./knowledge-types.js";
import type { OntologyObject } from "./ontology-types.js";
import type { SkillFile } from "./skill-types.js";
/** What produced a revision row (`src/features/revisions/types.ts › REVISION_OPS`). */
export type RevisionOp = "create" | "edit" | "section_edit" | "rename" | "move" | "delete" | "restore";
/** One append-only history row carrying the POST-write snapshot. */
export interface ContentRevision {
    id: string;
    resourceType: string;
    resourceId: string;
    workspaceId: string;
    actor: {
        userId: string | null;
        kind: "user" | "agent";
        agentSessionId: string | null;
    };
    op: RevisionOp;
    summary: string | null;
    /** Knowledge: `{body, title, path}`. Ontology: `{field, before, after}` or `{association…}` / `{fields}`. */
    payload: {
        body?: string | null;
        title?: string | null;
        path?: string | null;
        field?: string;
        before?: unknown;
        after?: unknown;
        association?: string;
        fields?: Record<string, unknown>;
    };
    contentHash: string;
    createdAt: string;
    updatedAt: string;
}
export interface ContentRevisionPage {
    revisions: ContentRevision[];
    nextCursor: string | null;
}
export interface RevisionPageOpts {
    cursor?: string;
    limit?: number;
}
/** A skill body snapshot's metadata (`skill_versions`), newest first in history. */
export interface SkillVersionMeta {
    id: string;
    skillId: string;
    authorId: string | null;
    source: string;
    createdAt: string;
    bodyBytes: number;
}
export interface SkillHistory {
    versions: SkillVersionMeta[];
    events: Array<{
        id: string;
        type: string;
        createdAt: string;
        source: string;
    }>;
}
export declare function listKbEntryRevisions(t: DoplTransport, entryId: string, opts?: RevisionPageOpts): Promise<ContentRevisionPage>;
export declare function restoreKbEntryRevision(t: DoplTransport, entryId: string, revisionId: string, expectedVersion: string): Promise<KnowledgeEntry>;
export declare function getSkillHistory(t: DoplTransport, slug: string, opts?: {
    limit?: number;
}): Promise<SkillHistory>;
export declare function getSkillVersion(t: DoplTransport, versionId: string): Promise<SkillVersionMeta & {
    body: string;
}>;
export declare function restoreSkillVersion(t: DoplTransport, versionId: string, expectedVersion: string): Promise<SkillFile>;
export declare function listOntologyObjectRevisions(t: DoplTransport, objectId: string, opts?: RevisionPageOpts): Promise<ContentRevisionPage>;
export declare function listOntologyRevisions(t: DoplTransport, ontologyId: string, opts?: RevisionPageOpts): Promise<ContentRevisionPage>;
export declare function restoreOntologyObjectRevision(t: DoplTransport, objectId: string, revisionId: string, expectedVersion: string): Promise<OntologyObject>;
