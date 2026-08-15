import type { ChatExportInput } from "../schema";

/** Seed chat for a new workspace — one archived sample session that doubles
 *  as documentation of a good export. Pure content, no I/O; `service-seed.ts`
 *  runs it through the ordinary `exportChat` path. `sessionDate` is omitted so
 *  the sample dates to the workspace's creation day. */

/** Stable idempotency handle for the seeded sample chat. */
export const SEED_CHAT_SESSION_ID = "dopl-seed-getting-started";

export function buildChatSeed(): ChatExportInput {
  return {
    title: "Getting started with Dopl",
    overview:
      "A first session on a new Dopl workspace: how to orient with dopl_map, where different kinds of memory belong, and how to leave a trail. A worked example of a clean export.",
    source: "claude-code",
    clientSessionId: SEED_CHAT_SESSION_ID,
    // Public so every member sees the example; real exports default private.
    visibility: "public",
    deliverables: [
      { label: "Read the Dopl Guide — “Start here” entry", done: true },
      { label: "Ran dopl_map to orient before acting", done: true },
    ],
    learnings: [
      "Open every session with dopl_map and close it with a dopl_chats export — that habit is what makes the workspace compound.",
    ],
    messages: [
      {
        role: "user",
        summary:
          "Asked how to get started on the new Dopl workspace and what the agent should do first.",
        verbatim: null,
      },
      {
        role: "agent",
        summary:
          "Explained the session ritual: call dopl_map first to orient on what the workspace already knows, then act. Pointed at the Dopl Guide knowledge base as the manual.",
        verbatim: null,
      },
      {
        role: "user",
        summary:
          "Asked where a durable learning should live versus a one-off session note.",
        verbatim: null,
      },
      {
        role: "agent",
        summary:
          "Clarified the split — facts to Knowledge, procedures to Skills, things and their connections to the Ontology, session records to Chats — and offered to file the learning as a KB entry so it outlives the session.",
        verbatim: null,
      },
    ],
  };
}
