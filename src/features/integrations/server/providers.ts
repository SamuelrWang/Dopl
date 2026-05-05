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

export type ActionResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

export type ProviderActionConfig = {
  name: string;
  summary: string;
  paramsSchema: z.ZodTypeAny;
  paramsJsonSchema: Record<string, unknown>;
  composioSlug: string;
  buildArgs: (params: Record<string, unknown>) => Record<string, unknown>;
  parseResponse: (raw: Record<string, unknown>) => ActionResult;
};

export type ProviderConfig = {
  composioAuthConfigEnv: string;
  /**
   * Composio toolkit slug for auto-generating action descriptors from
   * the broker's catalog (e.g. "GMAIL", "NOTION", "GOOGLEDRIVE"). When
   * set, every Composio tool under this toolkit becomes available
   * through `execute_integration_action` automatically. Hand-curated
   * `actions` entries override auto-generated ones by normalized name.
   */
  composioToolkit?: string;
  sourcePlatform: string;
  sourceType: string;
  urlBuilder: (objectId: string) => string;

  /**
   * Read-path config (list + fetch + ingest). Optional — providers
   * primarily used for write actions (Slack, Calendar, etc.) can omit
   * these. When omitted, `list_integration_objects`,
   * `read_integration_object`, and `ingest_from_integration` throw
   * `IntegrationReadNotSupportedError` for that provider; write
   * actions still work via the auto-mapped catalog.
   */
  listActionSlug?: string;
  buildListArgs?: (input: ProviderListInput) => Record<string, unknown>;
  parseListResponse?: (data: Record<string, unknown>) => {
    objects: IntegrationObject[];
    nextCursor: string | null;
  };

  fetchActionSlug?: string;
  buildFetchArgs?: (input: ProviderFetchInput) => Record<string, unknown>;
  parseFetchResponse?: (data: Record<string, unknown>) => {
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
  composioToolkit: "NOTION",
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
  composioToolkit: "GMAIL",
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
    to: z.string().min(1).max(500),
    body: z.string().min(0).max(50_000),
  });
  return [
    {
      name: "send_email",
      summary:
        "Send a new Gmail message from the connected account. Use for fresh outbound mail; for replying within an existing thread, use `reply_to_thread`.",
      paramsSchema: SendEmail,
      paramsJsonSchema: {
        type: "object",
        required: ["to", "subject", "body"],
        properties: {
          to: { type: "string", description: "Recipient address; multiple addresses may be comma-separated." },
          subject: { type: "string", description: "Subject line." },
          body: { type: "string", description: "Plain-text message body." },
          cc: { type: "string", description: "Optional CC address(es); comma-separated for multiple." },
          bcc: { type: "string", description: "Optional BCC address(es); comma-separated for multiple." },
        },
      },
      composioSlug: "GMAIL_SEND_EMAIL",
      buildArgs: (params) => {
        const p = SendEmail.parse(params);
        const [primary, ...extras] = splitAddresses(p.to);
        const args: Record<string, unknown> = {
          recipient_email: primary,
          subject: p.subject,
          body: p.body,
        };
        if (extras.length > 0) args.extra_recipients = extras;
        if (p.cc) args.cc = splitAddresses(p.cc);
        if (p.bcc) args.bcc = splitAddresses(p.bcc);
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
        "Reply to an existing Gmail thread (use the thread id returned from `list_integration_objects` or a previous `send_email`). The reply is appended to the thread; you must pass `to` because Gmail's reply API doesn't auto-derive it. If you don't know the recipient, call `read_integration_object` on the thread first to inspect the From header.",
      paramsSchema: ReplyToThread,
      paramsJsonSchema: {
        type: "object",
        required: ["thread_id", "to", "body"],
        properties: {
          thread_id: { type: "string", description: "Gmail thread id from list_integration_objects or send_email response." },
          to: { type: "string", description: "Recipient address — typically the original From of the thread." },
          body: { type: "string", description: "Plain-text reply body." },
        },
      },
      composioSlug: "GMAIL_REPLY_TO_THREAD",
      buildArgs: (params) => {
        const p = ReplyToThread.parse(params);
        return {
          thread_id: p.thread_id,
          recipient_email: p.to,
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

function splitAddresses(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
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
  composioToolkit: "GOOGLEDRIVE",
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

/**
 * Write-action-only providers. No `listActionSlug`/`fetchActionSlug` —
 * read paths can be added later once we identify the right Composio
 * list+fetch pair for each toolkit. Every Composio action under each
 * toolkit becomes available through `execute_integration_action` via
 * the auto-mapper in `service-actions.ts`.
 */
const GITHUB: ProviderConfig = {
  composioAuthConfigEnv: "INTEGRATIONS_GITHUB_AUTH_CONFIG_ID",
  composioToolkit: "GITHUB",
  sourcePlatform: "github",
  sourceType: "github_repo",
  urlBuilder: (id) => `https://github.com/${id}`,
  actions: [],
};

const GOOGLE_CALENDAR: ProviderConfig = {
  composioAuthConfigEnv: "INTEGRATIONS_GOOGLE_CALENDAR_AUTH_CONFIG_ID",
  composioToolkit: "GOOGLECALENDAR",
  sourcePlatform: "google_calendar",
  sourceType: "google_calendar_event",
  urlBuilder: (id) => `https://calendar.google.com/calendar/u/0/r/eventedit/${id}`,
  actions: [],
};

const GOOGLE_DOCS: ProviderConfig = {
  composioAuthConfigEnv: "INTEGRATIONS_GOOGLE_DOCS_AUTH_CONFIG_ID",
  composioToolkit: "GOOGLEDOCS",
  sourcePlatform: "google_docs",
  sourceType: "google_doc",
  urlBuilder: (id) => `https://docs.google.com/document/d/${id}/edit`,
  actions: [],
};

const GOOGLE_SHEETS: ProviderConfig = {
  composioAuthConfigEnv: "INTEGRATIONS_GOOGLE_SHEETS_AUTH_CONFIG_ID",
  composioToolkit: "GOOGLESHEETS",
  sourcePlatform: "google_sheets",
  sourceType: "google_sheet",
  urlBuilder: (id) => `https://docs.google.com/spreadsheets/d/${id}/edit`,
  actions: [],
};

const SLACK: ProviderConfig = {
  composioAuthConfigEnv: "INTEGRATIONS_SLACK_AUTH_CONFIG_ID",
  composioToolkit: "SLACK",
  sourcePlatform: "slack",
  sourceType: "slack_message",
  // Slack message URLs need workspace + channel context that we don't
  // store at config time; return a generic deep link. The agent will
  // typically rely on Slack's own response payloads for permalinks.
  urlBuilder: (id) => `https://app.slack.com/client/${id}`,
  actions: [],
};

const CONFIGS: Record<IntegrationProvider, ProviderConfig> = {
  notion: NOTION,
  gmail: GMAIL,
  google_drive: GOOGLE_DRIVE,
  github: GITHUB,
  google_calendar: GOOGLE_CALENDAR,
  google_docs: GOOGLE_DOCS,
  google_sheets: GOOGLE_SHEETS,
  slack: SLACK,
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

/**
 * Normalize a Composio tool slug into the agent-facing action name we
 * expose. Strips the toolkit prefix (`GMAIL_`, `GOOGLEDRIVE_`, …) and
 * lowercases. `GMAIL_CREATE_FILTER` → `create_filter`. If the slug
 * doesn't carry the expected prefix, just lowercases.
 */
export function actionNameForSlug(slug: string, toolkitSlug: string): string {
  const prefix = `${toolkitSlug.toUpperCase()}_`;
  const trimmed = slug.toUpperCase().startsWith(prefix)
    ? slug.slice(prefix.length)
    : slug;
  return trimmed.toLowerCase();
}
