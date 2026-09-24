/**
 * SHARED FIXTURES for the G16 / A11 confirm-and-acknowledge suites.
 *
 * ⚠ **ITS OWN FILE BECAUSE THERE ARE TWO SUITES NOW** (2026-09-02) — the
 * knowledge/agent one and the skills one, split at the §1 500-line cap. A copy of
 * `sharedContainer` in each is two definitions of "the only room this class fires
 * in", and the day they drift one suite is measuring a predicate the server does
 * not run.
 */
import type { KnowledgeBase } from "@dopl/client";
export declare const ME = "user-1";
/**
 * A workspace directory answer, as `resolveConfirmTarget` reads it.
 *
 * ⚠ **`memberCount` IS THE WHOLE ANSWER SINCE 2026-09-17** (Samuel's ruling
 * R-08; F-513) — `kind` is still spelled because the DIRECTORY renders it, not
 * because the confirm class asks it. `undefined` is admitted so a suite can
 * drive the fail-closed arm without hand-rolling a second stub.
 */
export declare function workspaceStub(kind: "standard" | "link", memberCount: number | undefined): {
    getWorkspaceId: import("vitest").Mock<() => string>;
    listWorkspaces: import("vitest").Mock<() => Promise<{
        workspaces: {
            id: string;
            slug: string;
            name: string;
            kind: "link" | "standard";
            role: string;
            memberCount: number | undefined;
        }[];
    }>>;
};
/** A container with a PEER in it. ⚠ A multi-member STANDARD workspace is just
 *  as shared since R-08 — the kind here is incidental. */
export declare const sharedContainer: () => {
    getWorkspaceId: import("vitest").Mock<() => string>;
    listWorkspaces: import("vitest").Mock<() => Promise<{
        workspaces: {
            id: string;
            slug: string;
            name: string;
            kind: "link" | "standard";
            role: string;
            memberCount: number | undefined;
        }[];
    }>>;
};
/** The one shape the class never fires in: a room with exactly one member. */
export declare const soloRoom: () => {
    getWorkspaceId: import("vitest").Mock<() => string>;
    listWorkspaces: import("vitest").Mock<() => Promise<{
        workspaces: {
            id: string;
            slug: string;
            name: string;
            kind: "link" | "standard";
            role: string;
            memberCount: number | undefined;
        }[];
    }>>;
};
/**
 * The two rows the confirm suites write. ⚠ **ONE DEFINITION EACH, FOR THE
 * REASON `sharedContainer` HAS ONE** — `acknowledge-shared.test.ts` and
 * `confirm-class.test.ts` each carried a byte-identical copy of `IDENTITY` and a
 * near-identical `BASE`, which is two definitions of the row whose AUDIENCE is
 * the subject of both files. Moved here 2026-09-17 when R-08's arms met the
 * §1 cap in both.
 */
export declare const IDENTITY: {
    id: string;
    workspaceId: string;
    name: string;
    description: null;
    instructions: null;
    model: null;
    fields: never[];
    visibility: "workspace";
    teamIds: never[];
    knowledgeBases: never[];
    createdBy: string;
    createdAt: string;
    updatedAt: string;
};
/** ⚠ The VISIBILITY is the parameter: it is the axis both suites vary. */
export declare const base: (visibility: "public" | "private") => KnowledgeBase;
export declare const textOf: (res: {
    content: Array<{
        text: string;
    }>;
}) => string;
/** A `DoplApiError`-shaped rejection, duck-typed the way the tools read it. */
export declare function apiError(status: number, code: string): Error;
/** The one-time token out of a preview, or a failed expectation naming the text. */
export declare function tokenIn(text: string): string;
