import { inlineOr } from "./narration";

function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}

/**
 * Upstream failure text as a VALUE — same rule as the channel await's. ⚠ "It came from our own
 * server" says where the bytes were copied from, not who wrote them — a 4xx can echo a rejected
 * field, and the fields here are member-typed. The one copy behind `chats-render.ts` and
 * `skills-shared.ts`, which both re-export it (cleanup M04).
 */
export function failureDetail(e: unknown): string {
  return inlineOr(errorMessage(e), "`no detail reported`");
}
