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
export declare function reachWarning(message: {
    delivery?: string | null;
    deliveryAt?: string | null;
    recipientAgentIds?: string[] | null;
}): string;
/**
 * **THE DISPLAY NUDGE, READ BACK** (unified display §6.2): the server saw structure in a plain
 * send. ONE line, never a refusal — the post already landed as written.
 */
export declare function displayTip(hint: "choice" | "structure" | undefined): string;
