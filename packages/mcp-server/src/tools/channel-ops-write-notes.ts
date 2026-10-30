import { bySet, toolName } from "../call-ref.js";

/**
 * The one-line notes `opPost` appends to a send's result — split out of `channel-ops-write.ts`
 * (2026-10-29, 500-line cap). Each is advisory: the post already landed as written.
 */

/**
 * **THE AGENT YOU NAMED IS NOT ON THIS SCOPE** (2026-10-29, Thread Mention Reach Fix
 * step 1). The server stored the address but predicted `unreachable`: every agent
 * named works a different thread or the main room, and its desktop feeds only its
 * own scope. Said in the result, never silently, so the sender can re-post where
 * the agent works. ⚠ Only on the PREDICTION: a machine receipt that upgraded the row
 * (`deliveryAt` set) means it landed after all.
 */
export function reachWarning(message: {
  delivery?: string | null;
  deliveryAt?: string | null;
  recipientAgentIds?: string[] | null;
}): string {
  if (message.delivery !== "unreachable" || message.deliveryAt) return "";
  if ((message.recipientAgentIds?.length ?? 0) === 0) return "";
  return "\nWarning: unreachable. The agent you named is not working this thread (or the main room, for a room post), so nothing woke it. Post where it works with the same `to=`; a main-room post reaches a main-room agent.";
}

/**
 * **THE DISPLAY NUDGE, READ BACK** (unified display §6.2): the server saw structure in a plain
 * send. ONE line, never a refusal — the post already landed as written.
 */
export function displayTip(hint: "choice" | "structure" | undefined): string {
  if (!hint) return "";
  const show = bySet({ legacy: 'kind="decision"', granular: "dopl_show" });
  return hint === "choice"
    ? `\nTip: a question with options is a decision — send it with ${toolName("channel.send", { kind: '"decision"' })} or ${show} (a choice block) so they answer in one press, on any device.`
    : `\nTip: lists, tables and status read better as a display — ${show} draws them on desktop and glasses.`;
}

