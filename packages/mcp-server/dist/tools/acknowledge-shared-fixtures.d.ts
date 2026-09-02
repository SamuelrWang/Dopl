/**
 * SHARED FIXTURES for the G16 / A11 confirm-and-acknowledge suites.
 *
 * ⚠ **ITS OWN FILE BECAUSE THERE ARE TWO SUITES NOW** (2026-09-02) — the
 * knowledge/agent one and the skills one, split at the §1 500-line cap. A copy of
 * `sharedContainer` in each is two definitions of "the only room this class fires
 * in", and the day they drift one suite is measuring a predicate the server does
 * not run.
 */
export declare const ME = "user-1";
/** A workspace directory answer, as `resolveConfirmTarget` reads it. */
export declare function workspaceStub(kind: "standard" | "link", memberCount: number): {
    getWorkspaceId: import("vitest").Mock<() => string>;
    listWorkspaces: import("vitest").Mock<() => Promise<{
        workspaces: {
            id: string;
            slug: string;
            name: string;
            kind: "standard" | "link";
            role: string;
            memberCount: number;
        }[];
    }>>;
};
/** A `kind='link'` container with a PEER in it — the only room the class fires in. */
export declare const sharedContainer: () => {
    getWorkspaceId: import("vitest").Mock<() => string>;
    listWorkspaces: import("vitest").Mock<() => Promise<{
        workspaces: {
            id: string;
            slug: string;
            name: string;
            kind: "standard" | "link";
            role: string;
            memberCount: number;
        }[];
    }>>;
};
export declare const textOf: (res: {
    content: Array<{
        text: string;
    }>;
}) => string;
/** A `DoplApiError`-shaped rejection, duck-typed the way the tools read it. */
export declare function apiError(status: number, code: string): Error;
/** The one-time token out of a preview, or a failed expectation naming the text. */
export declare function tokenIn(text: string): string;
