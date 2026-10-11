/**
 * Upstream failure text as a VALUE — same rule as the channel await's. ⚠ "It came from our own
 * server" says where the bytes were copied from, not who wrote them — a 4xx can echo a rejected
 * field, and the fields here are member-typed. The one copy behind `chats-render.ts` and
 * `skills-shared.ts`, which both re-export it (cleanup M04).
 */
export declare function failureDetail(e: unknown): string;
