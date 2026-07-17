/**
 * MCP tools for the chat archive.
 *
 * Chats are agent-exported conversation records: per-message summaries
 * under an agent-filled session header (what was done, learnings).
 * Private to their owner by default; the owner can share one with the
 * workspace. Consolidated into two `op`-dispatched tools:
 *   - `dopl_chats`       — reads + non-destructive writes.
 *   - `dopl_chats_admin` — DESTRUCTIVE delete, split out on purpose.
 */

import { z } from "zod";
import type { Chat, ChatDetail, DoplClient } from "@dopl/client";
import { err, ok, missingParams, type RegisterTool, type ToolResponse } from "./respond";

function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}

const EXPORT_GUIDE = `## Exporting conversations into Dopl — the rules

**What the archive is for.** The user stores finished (or ongoing) agent
sessions in Dopl so future sessions can recall them. Write every export
for a future agent that has zero context: it should be able to read the
header and know whether the transcript is worth loading.

**Message style — summarize, don't transcribe.**
- One entry per message, in order, keeping the user/agent alternation.
- Each summary: 1–3 sentences, concrete and specific. Keep decisions,
  numbers, names, file paths, error strings. Drop pleasantries, false
  starts, and anything a future reader can't act on.
- Verbatim text ONLY when the user explicitly asks for it (pass the
  exact text in \`verbatim\` alongside the summary). Never export a whole
  conversation verbatim unless told to; use format="mixed" when only
  some messages carry verbatim.

**Header discipline — fill everything you can.**
- \`title\`: specific enough to disambiguate ("MCP OAuth refresh-token
  rotation bug", not "Debugging session").
- \`overview\`: one paragraph — what the session was about and how it ended.
- \`deliverables\`: what was completed/shipped, one entry each, done=false
  for agreed-but-unfinished items.
- \`learnings\`: durable facts worth recalling later (gotchas, decisions,
  constraints) — not a restatement of the deliverables.
- \`sessionDate\` (YYYY-MM-DD), \`source\` (your client), \`project\` (repo or
  project name) when known.

**Idempotency.** Always pass a stable \`clientSessionId\` (your session
id). Re-exporting the same session then updates the existing chat
instead of duplicating it. Mid-session you may export early and use
op="append" to extend the transcript.

**Folders.** Pass \`folder\` with a short name ("Dopl", "Consulting") to
file the chat; the folder is created if missing. Ask the user before
inventing a new taxonomy.

**Folder sharing is authoritative.** A folder has its own sharing scope
(private by default). Filing a chat into a folder makes the chat inherit
the folder's scope — any \`visibility\` you pass alongside \`folder\` is
superseded. Changing a folder's scope (op="update_folder") re-scopes
every chat inside it. Sharing a FILED chat directly is rejected: unfile
it first, or change the folder's scope.

**Privacy.** Exports default to private (owner-only). Only set
visibility="public" when the user explicitly says to share it with the
workspace.`;

const CHATS_DESCRIPTION = `The user's chat archive — exported conversation records this and future sessions can recall. Set \`op\` to one of:
- "export" — save the current (or a finished) conversation into the archive. Requires: title, messages (array of {role: "user"|"agent", summary, verbatim?}). Strongly recommended: client_session_id (stable session id — makes re-export update instead of duplicate), overview, deliverables, learnings, session_date, source, project, folder. Read op="guide" before your first export: summarize per message, verbatim only on explicit request.
- "append" — add messages to an already-exported chat (mid-session incremental export). Requires: chat_id, messages.
- "update" — update a chat's header (title, overview, project, session_date, deliverables, learnings, folder, pinned) or share/unshare it (visibility). Owner-only. Requires: chat_id plus the fields to change. NOTE: a chat filed in a folder inherits the folder's sharing — moving it into a folder re-scopes it, and setting visibility on a filed chat is rejected (unfile first or use op="update_folder").
- "list" — list chats the user can read (their own + workspace-shared), newest first, with id/title/date/source/visibility/owner. Optional: scope ("private" = the user's unshared chats | "shared" = workspace-public ones | "all", default "all"), query (case-insensitive title/overview filter).
- "get" — read one chat in full: header, deliverables, learnings, and the summarized transcript. Requires: chat_id. Use this to pull past-session context the user references.
- "folders" — list the user's chat folders with their sharing scope.
- "create_folder" — create a chat folder (private by default). Requires: name.
- "update_folder" — rename a folder and/or change its sharing (visibility "private"|"public" = whole workspace). Changing sharing re-scopes EVERY chat in the folder — confirm with the user first. Team-scoped folder sharing is web-UI only. Requires: folder_id plus name and/or visibility.
- "guide" — the export etiquette guide (message style, header discipline, idempotency, privacy). Read before your first export of a session.

Destructive delete lives in the separate \`dopl_chats_admin\` tool.`;

const CHATS_ADMIN_DESCRIPTION = `DESTRUCTIVE chat-archive operations — separated from \`dopl_chats\` on purpose. Confirm with the user before calling. Set \`op\` to one of:
- "delete" — permanently delete a chat and its transcript. Owner-only. Requires: chat_id.
- "delete_folder" — delete a chat folder. Chats inside survive and become unfiled. Requires: folder_id.`;

const MessageShape = z.object({
  role: z.enum(["user", "agent"]),
  summary: z.string().min(1).max(4000),
  verbatim: z.string().min(1).max(20000).optional(),
});

const DeliverableShape = z.object({
  label: z.string().min(1).max(300),
  done: z.boolean(),
});

export function registerChatTools(
  register: RegisterTool,
  client: DoplClient,
): void {
  register(
    "dopl_chats",
    CHATS_DESCRIPTION,
    {
      op: z
        .enum(["export", "append", "update", "list", "get", "folders", "create_folder", "update_folder", "guide"])
        .describe("Operation to perform."),
      chat_id: z.string().optional().describe("Chat id. Required for append, update, get."),
      title: z.string().min(1).max(200).optional().describe("op=export (required) / op=update: chat title — specific enough to disambiguate later."),
      overview: z.string().max(2000).optional().describe("op=export / op=update: one-paragraph framing of what the session was about."),
      messages: z.array(MessageShape).max(500).optional().describe("op=export (required) / op=append: ordered transcript entries. Summarize each message concisely; verbatim only when the user asked."),
      deliverables: z.array(DeliverableShape).max(50).optional().describe("op=export / op=update: what was completed (done=true) or agreed but unfinished (done=false)."),
      learnings: z.array(z.string().min(1).max(1000)).max(50).optional().describe("op=export / op=update: durable facts worth recalling in future sessions."),
      client_session_id: z.string().min(1).max(200).optional().describe("op=export: your stable session id — idempotency key so re-exports update instead of duplicate. Always pass one."),
      session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("op=export / op=update: date the session happened (YYYY-MM-DD)."),
      source: z.enum(["claude-code", "claude-desktop", "cursor", "other"]).optional().describe("op=export: which client the session ran in."),
      project: z.string().max(120).optional().describe("op=export / op=update: repo or project name the session worked on. op=update: pass empty string to clear it."),
      folder: z.string().max(80).optional().describe("op=export / op=update: folder NAME to file the chat under (created if missing). Filing makes the chat INHERIT the folder's sharing scope. op=update: pass empty string to unfile."),
      visibility: z.enum(["private", "public"]).optional().describe("op=update / op=update_folder: share ('public') or unshare ('private') with the workspace. Rejected on a chat that sits in a folder — the folder's scope is authoritative. op=export: defaults to private — only set public when the user explicitly says so (superseded when folder is passed)."),
      pinned: z.boolean().optional().describe("op=update: pin/unpin the chat."),
      scope: z.enum(["private", "shared", "all"]).optional().describe("op=list: which chats to list (default all)."),
      query: z.string().max(200).optional().describe("op=list: case-insensitive title/overview filter."),
      name: z.string().min(1).max(80).optional().describe("op=create_folder (required) / op=update_folder: folder name."),
      folder_id: z.string().optional().describe("op=update_folder (required): folder id."),
    },
    async (args): Promise<ToolResponse> => {
      switch (args.op) {
        case "guide":
          return ok(EXPORT_GUIDE);
        case "export": {
          const miss = missingParams("export", args, ["title", "messages"]);
          if (miss) return miss;
          if ((args.messages ?? []).length === 0) {
            return err(`op="export" got an empty messages array — summarize the conversation's messages and pass at least one entry.`);
          }
          return opExport(client, args);
        }
        case "append": {
          const miss = missingParams("append", args, ["chat_id", "messages"]);
          if (miss) return miss;
          if ((args.messages ?? []).length === 0) {
            return err(`op="append" got an empty messages array — pass at least one entry.`);
          }
          return opAppend(client, args.chat_id as string, args.messages ?? []);
        }
        case "update": {
          const miss = missingParams("update", args, ["chat_id"]);
          if (miss) return miss;
          return opUpdate(client, args.chat_id as string, args);
        }
        case "list":
          return opList(client, args.scope ?? "all", args.query);
        case "get": {
          const miss = missingParams("get", args, ["chat_id"]);
          if (miss) return miss;
          return opGet(client, args.chat_id as string);
        }
        case "folders":
          return opFolders(client);
        case "create_folder": {
          const miss = missingParams("create_folder", args, ["name"]);
          if (miss) return miss;
          return opCreateFolder(client, args.name as string);
        }
        case "update_folder": {
          const miss = missingParams("update_folder", args, ["folder_id"]);
          if (miss) return miss;
          if (args.name === undefined && args.visibility === undefined) {
            return err(`op="update_folder" needs name and/or visibility to change.`);
          }
          return opUpdateFolder(client, args.folder_id as string, {
            name: args.name,
            visibility: args.visibility,
          });
        }
      }
    },
  );

  register(
    "dopl_chats_admin",
    CHATS_ADMIN_DESCRIPTION,
    {
      op: z.enum(["delete", "delete_folder"]).describe("DESTRUCTIVE operation to perform."),
      chat_id: z.string().optional().describe("op=delete (required): chat id."),
      folder_id: z.string().optional().describe("op=delete_folder (required): folder id."),
    },
    async (args): Promise<ToolResponse> => {
      switch (args.op) {
        case "delete": {
          const miss = missingParams("delete", args, ["chat_id"]);
          if (miss) return miss;
          try {
            await client.deleteChat(args.chat_id as string);
            return ok(`Deleted chat \`${args.chat_id}\` and its transcript.`);
          } catch (e) {
            return err(`Delete failed: ${errorMessage(e)}`);
          }
        }
        case "delete_folder": {
          const miss = missingParams("delete_folder", args, ["folder_id"]);
          if (miss) return miss;
          try {
            await client.deleteChatFolder(args.folder_id as string);
            return ok(`Deleted folder \`${args.folder_id}\`. Its chats are now unfiled.`);
          } catch (e) {
            return err(`Delete failed: ${errorMessage(e)}`);
          }
        }
      }
    },
  );
}

// ─── Op handlers ────────────────────────────────────────────────────

type ExportArgs = {
  title?: string;
  overview?: string;
  messages?: Array<{ role: "user" | "agent"; summary: string; verbatim?: string }>;
  deliverables?: Array<{ label: string; done: boolean }>;
  learnings?: string[];
  client_session_id?: string;
  session_date?: string;
  source?: "claude-code" | "claude-desktop" | "cursor" | "other";
  project?: string;
  folder?: string;
  visibility?: "private" | "public";
  pinned?: boolean;
};

async function opExport(client: DoplClient, args: ExportArgs): Promise<ToolResponse> {
  try {
    const chat = await client.exportChat({
      title: args.title as string,
      overview: args.overview,
      messages: args.messages ?? [],
      deliverables: args.deliverables,
      learnings: args.learnings,
      clientSessionId: args.client_session_id,
      sessionDate: args.session_date,
      source: args.source,
      project: args.project || undefined,
      folder: args.folder || undefined,
      visibility: args.visibility,
    });
    const idempotency = args.client_session_id
      ? `Re-exporting with client_session_id \`${args.client_session_id}\` updates this chat.`
      : `No client_session_id passed — a re-export would create a duplicate. Pass one next time.`;
    return ok(
      [
        `Exported **${chat.title}** (\`${chat.id}\`) — ${chat.messageCount} messages, ${chat.visibility}.`,
        idempotency,
      ].join("\n"),
    );
  } catch (e) {
    return err(`Export failed: ${errorMessage(e)}`);
  }
}

async function opAppend(
  client: DoplClient,
  chatId: string,
  messages: Array<{ role: "user" | "agent"; summary: string; verbatim?: string }>,
): Promise<ToolResponse> {
  try {
    const chat = await client.appendChatMessages(chatId, messages);
    return ok(`Appended ${messages.length} message${messages.length === 1 ? "" : "s"} to **${chat.title}** — transcript is now ${chat.messageCount} messages.`);
  } catch (e) {
    return err(`Append failed: ${errorMessage(e)}`);
  }
}

async function opUpdate(
  client: DoplClient,
  chatId: string,
  args: ExportArgs,
): Promise<ToolResponse> {
  const patch = {
    title: args.title,
    overview: args.overview,
    sessionDate: args.session_date,
    deliverables: args.deliverables,
    learnings: args.learnings,
    visibility: args.visibility,
    pinned: args.pinned,
    ...(args.project !== undefined
      ? { project: args.project === "" ? null : args.project }
      : {}),
    ...(args.folder !== undefined
      ? { folder: args.folder === "" ? null : args.folder }
      : {}),
  };
  if (Object.values(patch).every((v) => v === undefined)) {
    return err(
      `op="update" needs at least one field to change: title, overview, project, session_date, deliverables, learnings, folder, visibility, pinned.`,
    );
  }
  try {
    const chat = await client.updateChat(chatId, patch);
    return ok(`Updated **${chat.title}** (\`${chat.id}\`) — ${chat.visibility}${chat.pinned ? ", pinned" : ""}.`);
  } catch (e) {
    return err(`Update failed: ${errorMessage(e)}`);
  }
}

function hiddenNote(hiddenCount: number): string {
  return (
    `_${hiddenCount} older chat${hiddenCount === 1 ? " is" : "s are"} hidden by ` +
    `this workspace's free-plan history window — nothing is deleted. ` +
    `Upgrade to Pro to see full history._`
  );
}

async function opList(
  client: DoplClient,
  scope: "private" | "shared" | "all",
  query: string | undefined,
): Promise<ToolResponse> {
  const { chats: all, hiddenCount } = await client.listChats();
  const q = query?.trim().toLowerCase();
  const chats = all.filter((c) => {
    if (scope === "private" && c.visibility !== "private") return false;
    if (scope === "shared" && c.visibility !== "public") return false;
    if (q && !c.title.toLowerCase().includes(q) && !c.overview.toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });

  if (chats.length === 0) {
    const empty =
      query || scope !== "all"
        ? "No chats match that filter."
        : "The archive is empty — no chats exported yet. Use op=\"export\" to save this session.";
    return ok(hiddenCount > 0 ? `${empty}\n\n${hiddenNote(hiddenCount)}` : empty);
  }

  const lines: string[] = [];
  lines.push(`## Chat archive — ${chats.length} chat${chats.length === 1 ? "" : "s"}\n`);
  for (const c of chats) {
    lines.push(formatChatLine(c));
  }
  if (hiddenCount > 0) {
    lines.push(`\n${hiddenNote(hiddenCount)}`);
  }
  lines.push(`\nUse dopl_chats(op="get", chat_id=...) to read a transcript.`);
  return ok(lines.join("\n"));
}

async function opGet(client: DoplClient, chatId: string): Promise<ToolResponse> {
  let chat: ChatDetail;
  try {
    chat = await client.getChat(chatId);
  } catch (e) {
    return err(`Chat not found or failed to load: ${chatId}. ${errorMessage(e)}`);
  }

  const lines: string[] = [];
  lines.push(`# ${chat.title}`);
  lines.push(``);
  lines.push(chat.overview || "(no overview)");
  lines.push(``);
  lines.push(`- id: \`${chat.id}\``);
  lines.push(`- session: ${chat.sessionDate} · ${chat.source}${chat.project ? ` · ${chat.project}` : ""}`);
  lines.push(`- visibility: ${chat.visibility} · owner: ${chat.owner.name}`);
  if (chat.deliverables.length > 0) {
    lines.push(``);
    lines.push(`## What was done`);
    for (const d of chat.deliverables) {
      lines.push(`- [${d.done ? "x" : " "}] ${d.label}`);
    }
  }
  if (chat.learnings.length > 0) {
    lines.push(``);
    lines.push(`## Learnings`);
    for (const l of chat.learnings) lines.push(`- ${l}`);
  }
  lines.push(``);
  lines.push(`## Transcript — ${chat.messageCount} messages`);
  for (const m of chat.messages) {
    lines.push(``);
    lines.push(`**${m.role === "user" ? "User" : "Agent"} #${m.index}** — ${m.summary}`);
    if (m.verbatim) {
      lines.push(`> verbatim:`);
      for (const line of m.verbatim.split("\n")) lines.push(`> ${line}`);
    }
  }
  return ok(lines.join("\n"));
}

function folderScopeLabel(f: { visibility: string; accessMode: string }): string {
  if (f.visibility === "private") return "private";
  return f.accessMode === "teams" ? "team-shared" : "workspace-shared";
}

async function opFolders(client: DoplClient): Promise<ToolResponse> {
  const folders = await client.listChatFolders();
  if (folders.length === 0) {
    return ok(`No chat folders yet. Pass folder="<name>" on export (or op="create_folder") to create one.`);
  }
  const lines = folders.map(
    (f) => `- **${f.name}** \`${f.id}\` — ${folderScopeLabel(f)}`,
  );
  return ok(
    `## Chat folders — ${folders.length}\n\n${lines.join("\n")}\n\nA folder's scope is authoritative: chats filed in it inherit its sharing.`,
  );
}

async function opCreateFolder(client: DoplClient, name: string): Promise<ToolResponse> {
  try {
    const folder = await client.createChatFolder(name);
    return ok(`Created folder **${folder.name}** (\`${folder.id}\`) — private.`);
  } catch (e) {
    return err(`Folder create failed: ${errorMessage(e)}`);
  }
}

async function opUpdateFolder(
  client: DoplClient,
  folderId: string,
  patch: { name?: string; visibility?: "private" | "public" },
): Promise<ToolResponse> {
  try {
    const folder = await client.updateChatFolder(folderId, patch);
    const scopeNote =
      patch.visibility !== undefined
        ? ` Every chat in the folder now inherits this scope.`
        : "";
    return ok(
      `Updated folder **${folder.name}** (\`${folder.id}\`) — ${folderScopeLabel(folder)}.${scopeNote}`,
    );
  } catch (e) {
    return err(`Folder update failed: ${errorMessage(e)}`);
  }
}

function formatChatLine(c: Chat): string {
  const bits = [
    c.sessionDate,
    c.source,
    `${c.messageCount} msgs`,
    c.visibility === "public" ? `shared by ${c.owner.name}` : "private",
  ];
  if (c.project) bits.splice(2, 0, c.project);
  return `- **${c.title}** \`${c.id}\` — ${bits.join(" · ")}${c.pinned ? " · 📌" : ""}`;
}
