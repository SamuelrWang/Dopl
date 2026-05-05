import "server-only";
import { z } from "zod";
import type { IntegrationObject, IntegrationProvider } from "../types";
import { ProviderNotConfiguredError } from "./errors";

/**
 * Per-provider config. Each entry pins:
 *   - `composioAuthConfigEnv` — the env var that holds the Composio
 *     auth-config id, which references our own OAuth app credentials
 *     with the provider. This is what makes the consent screen say
 *     "Dopl wants access" instead of the broker's name.
 *   - `listActionSlug` / `fetchActionSlug` — Composio action slugs.
 *     Real slugs verified via COMPOSIO_SEARCH_TOOLS, not guessed.
 *   - `buildListArgs` / `parseListResponse` — provider-specific input
 *     shaping (Notion uses `start_cursor` + `page_size`, Gmail uses
 *     `page_token` + `max_results`) and output normalization into
 *     our common `IntegrationObject` shape.
 *   - `buildFetchArgs` / `parseFetchResponse` — same, for fetching one
 *     object's body.
 *   - `sourcePlatform` / `sourceType` — the strings we record on the
 *     `entries` and `sources` rows so downstream search/filtering
 *     works.
 *   - `urlBuilder` — turns a remote object id into a stable URL.
 *
 * Adding a provider = one entry here + a Composio dashboard entry.
 * No code changes elsewhere.
 */

export type ProviderListInput = {
  query?: string;
  cursor?: string;
  limit: number;
};

export type ProviderFetchInput = {
  objectId: string;
};

export type ActionParamSpec = {
  type: "string" | "number" | "boolean";
  description: string;
  required: boolean;
};

export type ActionResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

export type ProviderActionConfig = {
  name: string;
  summary: string;
  paramsSchema: z.ZodTypeAny;
  paramsDescription: Record<string, ActionParamSpec>;
  composioSlug: string;
  buildArgs: (params: Record<string, unknown>) => Record<string, unknown>;
  parseResponse: (raw: Record<string, unknown>) => ActionResult;
};

export type ProviderConfig = {
  composioAuthConfigEnv: string;
  sourcePlatform: string;
  sourceType: string;
  urlBuilder: (objectId: string) => string;

  listActionSlug: string;
  buildListArgs: (input: ProviderListInput) => Record<string, unknown>;
  parseListResponse: (data: Record<string, unknown>) => {
    objects: IntegrationObject[];
    nextCursor: string | null;
  };

  fetchActionSlug: string;
  buildFetchArgs: (input: ProviderFetchInput) => Record<string, unknown>;
  parseFetchResponse: (data: Record<string, unknown>) => {
    title: string;
    url: string | null;
    body: string;
    lastModified: string | null;
  };

  actions: ProviderActionConfig[];
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function notionTitleOf(item: Record<string, unknown>): string {
  // Database pages: properties is a record; the entry whose `type`
  // is "title" carries the readable title in `title[].plain_text`.
  const props = item.properties as Record<string, unknown> | undefined;
  if (props) {
    for (const prop of Object.values(props)) {
      const p = prop as Record<string, unknown>;
      if (p?.type === "title") {
        const arr = asArray(p.title) as Array<Record<string, unknown>>;
        const text = arr
          .map((t) => (typeof t.plain_text === "string" ? t.plain_text : ""))
          .join("")
          .trim();
        if (text) return text;
      }
    }
  }
  // Top-level pages: a single title string is sometimes returned at the
  // root.
  return (asString(item.title) ?? "(untitled)") as string;
}

const NOTION: ProviderConfig = {
  composioAuthConfigEnv: "INTEGRATIONS_NOTION_AUTH_CONFIG_ID",
  sourcePlatform: "notion",
  sourceType: "notion_page",
  urlBuilder: (id) => `https://www.notion.so/${id.replace(/-/g, "")}`,
  listActionSlug: "NOTION_SEARCH_NOTION_PAGE",
  buildListArgs: ({ query, cursor, limit }) => {
    const args: Record<string, unknown> = {
      query: query ?? "",
      page_size: Math.min(Math.max(limit, 1), 100),
      filter_value: "page",
    };
    if (cursor) args.start_cursor = cursor;
    return args;
  },
  parseListResponse: (data) => {
    const results = asArray(data.results) as Array<Record<string, unknown>>;
    const objects: IntegrationObject[] = results.map((item) => ({
      id: (item.id as string) ?? "",
      title: notionTitleOf(item),
      url: asString(item.url),
      lastModified: asString(item.last_edited_time),
    }));
    const nextCursor =
      data.has_more === true ? asString(data.next_cursor) : null;
    return { objects, nextCursor };
  },
  fetchActionSlug: "NOTION_GET_PAGE_MARKDOWN",
  buildFetchArgs: ({ objectId }) => ({ page_id: objectId }),
  parseFetchResponse: (data) => ({
    title: (asString(data.title) ?? "(untitled)") as string,
    url: asString(data.url),
    body: (asString(data.markdown) ?? "") as string,
    lastModified: asString(data.last_edited_time),
  }),
  actions: [],
};

const GMAIL: ProviderConfig = {
  composioAuthConfigEnv: "INTEGRATIONS_GMAIL_AUTH_CONFIG_ID",
  sourcePlatform: "gmail",
  sourceType: "gmail_thread",
  urlBuilder: (id) => `https://mail.google.com/mail/u/0/#inbox/${id}`,
  listActionSlug: "GMAIL_LIST_THREADS",
  buildListArgs: ({ query, cursor, limit }) => {
    const args: Record<string, unknown> = {
      query: query ?? "",
      max_results: Math.min(Math.max(limit, 1), 500),
      verbose: false,
    };
    if (cursor) args.page_token = cursor;
    return args;
  },
  parseListResponse: (data) => {
    const threads = asArray(data.threads) as Array<Record<string, unknown>>;
    const objects: IntegrationObject[] = threads.map((t) => ({
      id: (t.id as string) ?? "",
      title: (asString(t.snippet) ?? "(no preview)") as string,
      url: null,
      lastModified: asString(t.historyId),
    }));
    const nextCursor = asString(data.nextPageToken);
    return { objects, nextCursor };
  },
  fetchActionSlug: "GMAIL_FETCH_MESSAGE_BY_THREAD_ID",
  buildFetchArgs: ({ objectId }) => ({ thread_id: objectId }),
  parseFetchResponse: (data) => {
    const messages = asArray(data.messages) as Array<Record<string, unknown>>;
    const ordered = [...messages].sort((a, b) => {
      const at = (a.internalDate as string) ?? "";
      const bt = (b.internalDate as string) ?? "";
      return at.localeCompare(bt);
    });
    const subject = ordered.length > 0 ? gmailSubject(ordered[0]) : null;
    const body = ordered
      .map((m) => `# ${gmailHeader(m, "From") ?? "(unknown sender)"} — ${gmailHeader(m, "Date") ?? ""}\n\n${gmailBody(m)}`)
      .join("\n\n---\n\n");
    return {
      title: (subject ?? "(no subject)") as string,
      url: null,
      body,
      lastModified:
        ordered.length > 0 ? asString(ordered[ordered.length - 1].internalDate) : null,
    };
  },
  actions: gmailActions(),
};

function gmailActions(): ProviderActionConfig[] {
  const SendEmail = z.object({
    to: z.string().min(1).max(500),
    subject: z.string().min(0).max(500),
    body: z.string().min(0).max(50_000),
    cc: z.string().max(500).optional(),
    bcc: z.string().max(500).optional(),
  });
  const ReplyToThread = z.object({
    thread_id: z.string().min(1).max(500),
    body: z.string().min(0).max(50_000),
  });
  return [
    {
      name: "send_email",
      summary:
        "Send a new Gmail message from the connected account. Use for fresh outbound mail; for replying within an existing thread, use `reply_to_thread`.",
      paramsSchema: SendEmail,
      paramsDescription: {
        to: { type: "string", description: "Recipient address (or comma-separated list).", required: true },
        subject: { type: "string", description: "Subject line.", required: true },
        body: { type: "string", description: "Plain-text message body.", required: true },
        cc: { type: "string", description: "Optional CC address(es).", required: false },
        bcc: { type: "string", description: "Optional BCC address(es).", required: false },
      },
      composioSlug: "GMAIL_SEND_EMAIL",
      buildArgs: (params) => {
        const p = SendEmail.parse(params);
        const args: Record<string, unknown> = {
          recipient_email: p.to,
          subject: p.subject,
          body: p.body,
        };
        if (p.cc) args.cc = [p.cc];
        if (p.bcc) args.bcc = [p.bcc];
        return args;
      },
      parseResponse: (raw) => {
        const id = asString(raw.id) ?? asString((raw.response_data as Record<string, unknown> | undefined)?.id);
        const threadId = asString(raw.threadId) ?? asString((raw.response_data as Record<string, unknown> | undefined)?.threadId);
        return { ok: true, data: { id, thread_id: threadId } };
      },
    },
    {
      name: "reply_to_thread",
      summary:
        "Reply to an existing Gmail thread (uses the thread id returned from `list_integration_objects` or a previous `send_email`). The reply is appended to the thread; the subject and recipients are inferred from the thread's first message.",
      paramsSchema: ReplyToThread,
      paramsDescription: {
        thread_id: { type: "string", description: "Gmail thread id from list_integration_objects or send_email response.", required: true },
        body: { type: "string", description: "Plain-text reply body.", required: true },
      },
      composioSlug: "GMAIL_REPLY_TO_THREAD",
      buildArgs: (params) => {
        const p = ReplyToThread.parse(params);
        return {
          thread_id: p.thread_id,
          message_body: p.body,
        };
      },
      parseResponse: (raw) => {
        const id = asString(raw.id) ?? asString((raw.response_data as Record<string, unknown> | undefined)?.id);
        const threadId = asString(raw.threadId) ?? asString((raw.response_data as Record<string, unknown> | undefined)?.threadId);
        return { ok: true, data: { id, thread_id: threadId } };
      },
    },
  ];
}

function gmailSubject(message: Record<string, unknown>): string | null {
  return gmailHeader(message, "Subject");
}

function gmailHeader(
  message: Record<string, unknown>,
  name: string
): string | null {
  const payload = message.payload as Record<string, unknown> | undefined;
  const headers = asArray(payload?.headers) as Array<Record<string, unknown>>;
  const found = headers.find(
    (h) => typeof h.name === "string" && h.name.toLowerCase() === name.toLowerCase()
  );
  return found ? asString(found.value) : null;
}

function gmailBody(message: Record<string, unknown>): string {
  const direct = asString(message.messageText);
  if (direct) return direct;
  const snippet = asString(message.snippet);
  return snippet ?? "";
}

const GOOGLE_DRIVE: ProviderConfig = {
  composioAuthConfigEnv: "INTEGRATIONS_GOOGLE_DRIVE_AUTH_CONFIG_ID",
  sourcePlatform: "google_drive",
  sourceType: "google_drive_file",
  urlBuilder: (id) => `https://drive.google.com/file/d/${id}/view`,
  listActionSlug: "GOOGLEDRIVE_LIST_FILES",
  buildListArgs: ({ query, cursor, limit }) => {
    const args: Record<string, unknown> = {
      page_size: Math.min(Math.max(limit, 1), 100),
    };
    if (query) args.query = query;
    if (cursor) args.page_token = cursor;
    return args;
  },
  parseListResponse: (data) => {
    const files = asArray(data.files) as Array<Record<string, unknown>>;
    const objects: IntegrationObject[] = files.map((f) => ({
      id: (f.id as string) ?? "",
      title: (asString(f.name) ?? "(untitled)") as string,
      url: asString(f.webViewLink),
      lastModified: asString(f.modifiedTime),
    }));
    return { objects, nextCursor: asString(data.nextPageToken) };
  },
  fetchActionSlug: "GOOGLEDRIVE_GET_FILE_CONTENT",
  buildFetchArgs: ({ objectId }) => ({ file_id: objectId }),
  parseFetchResponse: (data) => ({
    title: (asString(data.name) ?? "(untitled)") as string,
    url: asString(data.webViewLink),
    body: (asString(data.content) ?? "") as string,
    lastModified: asString(data.modifiedTime),
  }),
  actions: [],
};

const CONFIGS: Record<IntegrationProvider, ProviderConfig> = {
  notion: NOTION,
  gmail: GMAIL,
  google_drive: GOOGLE_DRIVE,
};

export function getProviderConfig(provider: IntegrationProvider): ProviderConfig {
  return CONFIGS[provider];
}

export function resolveAuthConfigId(provider: IntegrationProvider): string {
  const cfg = getProviderConfig(provider);
  const value = process.env[cfg.composioAuthConfigEnv];
  if (!value) throw new ProviderNotConfiguredError(provider);
  return value;
}

export function findAction(
  provider: IntegrationProvider,
  name: string
): ProviderActionConfig | null {
  return getProviderConfig(provider).actions.find((a) => a.name === name) ?? null;
}
