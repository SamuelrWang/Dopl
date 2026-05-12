import "server-only";
import { z } from "zod";
import type { IntegrationObject, IntegrationProvider } from "../types";
import { ProviderNotConfiguredError } from "./errors";

/**
 * §2 file-size exception: this module is a per-provider configuration
 * table with tightly-coupled parsers — splitting per-provider would
 * fragment a cohesive domain model (every entry shares the same
 * `ProviderConfig` shape; helper functions like `asString`/`asArray`
 * are shared across all parsers). Tracked as a future split candidate
 * in REFACTOR-FINDINGS.md when the broader integrations refactor lands.
 *
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
  /**
   * Optional Composio action slug to call right after OAuth completes
   * to derive a real account email + label for the connection. Without
   * this, the alias falls back to a broker-id slug like
   * `account:vch1dWNe` — usable but ugly. With it, the user sees
   * `alice@example.com` in the integrations list. Skip for providers
   * that don't expose a clean profile action (Slack, Notion).
   */
  profileActionSlug?: string;
  /**
   * Optional argument-builder for the profile lookup call. Most
   * providers' profile slugs take zero args (default empty object),
   * but some (e.g. `GOOGLECALENDAR_GET_CALENDAR` needs
   * `calendarId: "primary"`) require fixed parameters.
   */
  buildProfileArgs?: () => Record<string, unknown>;
  parseProfileResponse?: (raw: Record<string, unknown>) => {
    email: string | null;
    label: string | null;
    /**
     * Real provider avatar URL (Slack image_192, GitHub avatar_url,
     * Google photoLink, Notion avatar_url). Persisted on
     * `oauth_connections.account_avatar_url` so the UI can render the
     * actual user picture instead of the Gravatar fallback.
     */
    avatarUrl: string | null;
  };
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
  profileActionSlug: "NOTION_GET_ABOUT_ME",
  parseProfileResponse: (raw) => {
    // Notion's `users.me` returns `{ object: 'user', id, name, type,
    // person: { email }, avatar_url }`. Some Composio envelopes nest
    // the payload under `response_data`.
    const root = (raw.response_data as Record<string, unknown> | undefined) ?? raw;
    const person = root.person as Record<string, unknown> | undefined;
    return {
      email: person ? asString(person.email) : null,
      label: asString(root.name),
      avatarUrl: asString(root.avatar_url),
    };
  },
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
  profileActionSlug: "GMAIL_GET_PROFILE",
  parseProfileResponse: (raw) => {
    // GMAIL_GET_PROFILE returns `{ emailAddress, messagesTotal, ... }`
    // with no avatar field; Google's profile picture lives on the OIDC
    // userinfo endpoint, which Composio doesn't surface here. Avatar
    // stays null — the connections route falls back to Gravatar.
    const root = (raw.response_data as Record<string, unknown> | undefined) ?? raw;
    return {
      email: asString(root.emailAddress) ?? asString(root.email),
      label: null,
      avatarUrl: asString(root.picture),
    };
  },
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
  profileActionSlug: "GOOGLEDRIVE_GOOGLE_DRIVE_GET_ABOUT",
  parseProfileResponse: (raw) => {
    // Drive's `about.get` returns `{ user: { emailAddress, displayName,
    // photoLink } }`. `photoLink` is the actual Google profile picture
    // URL — what we want to render in the connections card.
    const root = (raw.response_data as Record<string, unknown> | undefined) ?? raw;
    const user = root.user as Record<string, unknown> | undefined;
    return {
      email: user ? asString(user.emailAddress) : null,
      label: user ? asString(user.displayName) : null,
      avatarUrl: user ? asString(user.photoLink) : null,
    };
  },
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
  profileActionSlug: "GITHUB_GET_THE_AUTHENTICATED_USER",
  parseProfileResponse: (raw) => {
    const root = (raw.response_data as Record<string, unknown> | undefined) ?? raw;
    return {
      email: asString(root.email),
      label: asString(root.login) ?? asString(root.name),
      avatarUrl: asString(root.avatar_url),
    };
  },
  sourcePlatform: "github",
  sourceType: "github_repo",
  urlBuilder: (id) => `https://github.com/${id}`,
  // Read path: list repos the authenticated user has access to + fetch
  // each repo's README as the body. The README is the most useful
  // single artifact for ingestion since it usually summarizes the
  // project. Issues/PRs/code search are reachable via the auto-mapped
  // catalog when an agent needs them.
  listActionSlug: "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER",
  buildListArgs: ({ cursor, limit }) => {
    // GitHub's /user/repos doesn't accept a text query — clients filter
    // post-fetch. Pagination is page-numbered (1-based).
    const args: Record<string, unknown> = {
      per_page: Math.min(Math.max(limit, 1), 100),
      sort: "updated",
    };
    if (cursor) {
      const page = Number(cursor);
      if (Number.isFinite(page) && page >= 1) args.page = page;
    }
    return args;
  },
  parseListResponse: (data) => {
    const root = (data.response_data as Record<string, unknown> | undefined) ?? data;
    const items = asArray(
      (root.repositories as unknown[]) ?? (root as Record<string, unknown>).items ?? root
    ) as Array<Record<string, unknown>>;
    const objects: IntegrationObject[] = items.map((r) => ({
      id: (asString(r.full_name) ?? asString(r.name) ?? "") as string,
      title: (asString(r.full_name) ?? asString(r.name) ?? "(unnamed repo)") as string,
      url: asString(r.html_url),
      lastModified: asString(r.updated_at) ?? asString(r.pushed_at),
    }));
    return { objects, nextCursor: null };
  },
  fetchActionSlug: "GITHUB_GET_A_REPOSITORY_README",
  buildFetchArgs: ({ objectId }) => {
    const [owner, repo] = objectId.split("/");
    return { owner, repo };
  },
  parseFetchResponse: (data) => {
    const root = (data.response_data as Record<string, unknown> | undefined) ?? data;
    const name = asString(root.name) ?? "README";
    // The raw GitHub /readme endpoint returns base64-encoded content.
    // Composio may or may not pre-decode depending on accept header
    // it uses internally. Prefer an explicitly-decoded field; fall
    // back to detecting and decoding base64 ourselves.
    const decoded = asString(root.decoded_content);
    const content = asString(root.content);
    let body = decoded ?? "";
    if (!body && content) {
      const stripped = content.replace(/\s+/g, "");
      if (/^[A-Za-z0-9+/]+=*$/.test(stripped) && stripped.length > 8) {
        try {
          body = Buffer.from(stripped, "base64").toString("utf8");
        } catch {
          body = content;
        }
      } else {
        body = content;
      }
    }
    return {
      title: name,
      url: asString(root.html_url),
      body,
      lastModified: null,
    };
  },
  actions: [],
};

const GOOGLE_CALENDAR: ProviderConfig = {
  composioAuthConfigEnv: "INTEGRATIONS_GOOGLE_CALENDAR_AUTH_CONFIG_ID",
  composioToolkit: "GOOGLECALENDAR",
  // `GOOGLECALENDAR_GET_ABOUT` doesn't exist; verified via Composio
  // docs. Fall back to `GOOGLECALENDAR_GET_CALENDAR` with the
  // `primary` calendarId — its `id` field is the user's email for the
  // primary calendar. No avatar is returned by this endpoint, so the
  // UI Gravatar fallback (driven by the captured email) handles the
  // avatar.
  profileActionSlug: "GOOGLECALENDAR_GET_CALENDAR",
  buildProfileArgs: () => ({ calendarId: "primary" }),
  parseProfileResponse: (raw) => {
    const root = (raw.response_data as Record<string, unknown> | undefined) ?? raw;
    // For the primary calendar, `id` is the user's email; `summary` is
    // the human-readable calendar name (often also the email).
    const id = asString(root.id);
    const summary = asString(root.summary);
    const email = id && id.includes("@") ? id : null;
    return {
      email,
      label: summary,
      avatarUrl: null,
    };
  },
  sourcePlatform: "google_calendar",
  sourceType: "google_calendar_event",
  urlBuilder: (id) =>
    `https://calendar.google.com/calendar/u/0/r/eventedit/${id}`,
  listActionSlug: "GOOGLECALENDAR_EVENTS_LIST",
  buildListArgs: ({ query, cursor, limit }) => {
    const args: Record<string, unknown> = {
      calendarId: "primary",
      maxResults: Math.min(Math.max(limit, 1), 100),
      orderBy: "startTime",
      singleEvents: true,
      // Default to a useful window for demo flows: a month back through
      // a month forward. Agents can override via query.
      timeMin: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
      timeMax: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    };
    if (query) args.q = query;
    if (cursor) args.pageToken = cursor;
    return args;
  },
  parseListResponse: (data) => {
    const root = (data.response_data as Record<string, unknown> | undefined) ?? data;
    const items = asArray(root.items) as Array<Record<string, unknown>>;
    const objects: IntegrationObject[] = items.map((e) => {
      const start = e.start as Record<string, unknown> | undefined;
      const startWhen =
        (start ? asString(start.dateTime) ?? asString(start.date) : null) ?? "";
      const title = asString(e.summary) ?? "(no title)";
      return {
        id: (asString(e.id) ?? "") as string,
        title: startWhen ? `${title} — ${startWhen}` : title,
        url: asString(e.htmlLink),
        lastModified: asString(e.updated),
      };
    });
    return { objects, nextCursor: asString(root.nextPageToken) };
  },
  fetchActionSlug: "GOOGLECALENDAR_EVENTS_GET",
  buildFetchArgs: ({ objectId }) => ({
    calendarId: "primary",
    eventId: objectId,
  }),
  parseFetchResponse: (data) => {
    const root = (data.response_data as Record<string, unknown> | undefined) ?? data;
    const start = root.start as Record<string, unknown> | undefined;
    const end = root.end as Record<string, unknown> | undefined;
    const startWhen = start ? asString(start.dateTime) ?? asString(start.date) : null;
    const endWhen = end ? asString(end.dateTime) ?? asString(end.date) : null;
    const attendees = asArray(root.attendees) as Array<Record<string, unknown>>;
    const attendeeLines = attendees
      .map((a) => {
        const email = asString(a.email);
        const name = asString(a.displayName);
        return email ? `- ${name ? `${name} <${email}>` : email}` : null;
      })
      .filter((line): line is string => line !== null);
    const lines: string[] = [];
    if (startWhen) lines.push(`**When:** ${startWhen}${endWhen ? ` → ${endWhen}` : ""}`);
    const location = asString(root.location);
    if (location) lines.push(`**Where:** ${location}`);
    if (attendeeLines.length > 0) {
      lines.push("", "**Attendees:**", ...attendeeLines);
    }
    const description = asString(root.description);
    if (description) lines.push("", description);
    return {
      title: (asString(root.summary) ?? "(no title)") as string,
      url: asString(root.htmlLink),
      body: lines.join("\n"),
      lastModified: asString(root.updated),
    };
  },
  actions: [],
};

const GOOGLE_DOCS: ProviderConfig = {
  composioAuthConfigEnv: "INTEGRATIONS_GOOGLE_DOCS_AUTH_CONFIG_ID",
  composioToolkit: "GOOGLEDOCS",
  sourcePlatform: "google_docs",
  sourceType: "google_doc",
  urlBuilder: (id) => `https://docs.google.com/document/d/${id}/edit`,
  // Verified slugs against Composio Docs toolkit reference:
  // - `GOOGLEDOCS_SEARCH_DOCUMENTS` for list (Drive-style files[])
  // - `GOOGLEDOCS_GET_DOCUMENT_PLAINTEXT` for fetch (simpler than
  //   the structured `GET_DOCUMENT_BY_ID` body parsing path).
  listActionSlug: "GOOGLEDOCS_SEARCH_DOCUMENTS",
  buildListArgs: ({ query, cursor, limit }) => {
    const args: Record<string, unknown> = {
      pageSize: Math.min(Math.max(limit, 1), 100),
    };
    if (query) args.q = query;
    if (cursor) args.pageToken = cursor;
    return args;
  },
  parseListResponse: (data) => {
    const root = (data.response_data as Record<string, unknown> | undefined) ?? data;
    const items = asArray(root.files ?? root.documents) as Array<Record<string, unknown>>;
    const objects: IntegrationObject[] = items.map((f) => ({
      id: (asString(f.id) ?? asString(f.documentId) ?? "") as string,
      title: (asString(f.name) ?? asString(f.title) ?? "(untitled)") as string,
      url: asString(f.webViewLink),
      lastModified: asString(f.modifiedTime) ?? asString(f.modifiedDate),
    }));
    return { objects, nextCursor: asString(root.nextPageToken) };
  },
  fetchActionSlug: "GOOGLEDOCS_GET_DOCUMENT_PLAINTEXT",
  buildFetchArgs: ({ objectId }) => ({ documentId: objectId }),
  parseFetchResponse: (data) => {
    const root = (data.response_data as Record<string, unknown> | undefined) ?? data;
    // PLAINTEXT returns the rendered text under one of several keys
    // depending on Composio's envelope: `plaintext`, `text`, `content`,
    // or the generic `data`. Probe in priority order.
    const body =
      asString(root.plaintext) ??
      asString(root.text) ??
      asString(root.content) ??
      asString(root.data) ??
      "";
    return {
      title: (asString(root.title) ?? asString(root.documentId) ?? "(untitled)") as string,
      url: null,
      body,
      lastModified: null,
    };
  },
  actions: [],
};

const GOOGLE_SHEETS: ProviderConfig = {
  composioAuthConfigEnv: "INTEGRATIONS_GOOGLE_SHEETS_AUTH_CONFIG_ID",
  composioToolkit: "GOOGLESHEETS",
  sourcePlatform: "google_sheets",
  sourceType: "google_sheet",
  urlBuilder: (id) => `https://docs.google.com/spreadsheets/d/${id}/edit`,
  // Verified slugs against Composio Sheets toolkit reference:
  // - `GOOGLESHEETS_SEARCH_SPREADSHEETS` for list (Drive-style files[])
  // - `GOOGLESHEETS_GET_SPREADSHEET_INFO` for fetch (metadata + sheets)
  // For per-cell values, agents fall through to the auto-mapped
  // catalog (e.g. `GOOGLESHEETS_BATCH_GET`).
  listActionSlug: "GOOGLESHEETS_SEARCH_SPREADSHEETS",
  buildListArgs: ({ query, cursor, limit }) => {
    const args: Record<string, unknown> = {
      pageSize: Math.min(Math.max(limit, 1), 100),
    };
    if (query) args.q = query;
    if (cursor) args.pageToken = cursor;
    return args;
  },
  parseListResponse: (data) => {
    const root = (data.response_data as Record<string, unknown> | undefined) ?? data;
    const items = asArray(root.files ?? root.spreadsheets) as Array<Record<string, unknown>>;
    const objects: IntegrationObject[] = items.map((f) => ({
      id: (asString(f.id) ?? asString(f.spreadsheetId) ?? "") as string,
      title: (asString(f.name) ?? asString(f.title) ?? "(untitled)") as string,
      url: asString(f.webViewLink),
      lastModified: asString(f.modifiedTime),
    }));
    return { objects, nextCursor: asString(root.nextPageToken) };
  },
  fetchActionSlug: "GOOGLESHEETS_GET_SPREADSHEET_INFO",
  buildFetchArgs: ({ objectId }) => ({ spreadsheetId: objectId }),
  parseFetchResponse: (data) => {
    const root = (data.response_data as Record<string, unknown> | undefined) ?? data;
    const props = root.properties as Record<string, unknown> | undefined;
    const title = asString(props?.title) ?? asString(root.title) ?? "(untitled sheet)";
    const sheets = asArray(root.sheets) as Array<Record<string, unknown>>;
    // Best-effort body — list each tab's title + dimensions. Full
    // values fetching requires a separate range request; for the
    // demo, surfacing structure is sufficient and an agent can drill
    // in via `execute_integration_action`.
    const lines = sheets
      .map((s) => {
        const sp = s.properties as Record<string, unknown> | undefined;
        const tabTitle = asString(sp?.title);
        const grid = sp?.gridProperties as Record<string, unknown> | undefined;
        const rows = grid?.rowCount;
        const cols = grid?.columnCount;
        return tabTitle
          ? `- **${tabTitle}** (${rows ?? "?"} rows × ${cols ?? "?"} cols)`
          : null;
      })
      .filter((line): line is string => line !== null);
    return {
      title,
      url: asString(root.spreadsheetUrl),
      body: lines.length > 0 ? `# ${title}\n\n## Sheets\n\n${lines.join("\n")}` : title,
      lastModified: null,
    };
  },
  actions: [],
};

const SLACK: ProviderConfig = {
  composioAuthConfigEnv: "INTEGRATIONS_SLACK_AUTH_CONFIG_ID",
  composioToolkit: "SLACK",
  // Verified against Composio's Slack toolkit docs: wraps Slack's
  // `users.profile.get` and defaults to the authenticated user when
  // `user` id is omitted. Response is `{ ok, profile: { email,
  // image_192, real_name, display_name, ... } }`.
  profileActionSlug: "SLACK_FETCH_USER_PROFILE",
  parseProfileResponse: (raw) => {
    const root = (raw.response_data as Record<string, unknown> | undefined) ?? raw;
    const user = (root.user as Record<string, unknown> | undefined) ?? root;
    const profile = user.profile as Record<string, unknown> | undefined;
    const email =
      (profile ? asString(profile.email) : null) ?? asString(user.email);
    const displayName =
      (profile ? asString(profile.real_name) ?? asString(profile.display_name) : null) ??
      asString(user.real_name) ??
      asString(user.name);
    // Prefer the largest image Slack returns so the avatar doesn't
    // look pixelated in the connections card.
    const avatarUrl =
      (profile
        ? asString(profile.image_192) ??
          asString(profile.image_72) ??
          asString(profile.image_48) ??
          asString(profile.image_24)
        : null) ?? null;
    return { email, label: displayName, avatarUrl };
  },
  sourcePlatform: "slack",
  sourceType: "slack_message",
  // Slack message URLs need workspace + channel context that we don't
  // store at config time; return a generic deep link. The agent will
  // typically rely on Slack's own response payloads for permalinks.
  urlBuilder: (id) => `https://app.slack.com/client/${id}`,
  // Read path: list the public/private conversations the user is in,
  // and fetch a window of message history per channel. Verified
  // slugs against Composio's Slack toolkit docs.
  listActionSlug: "SLACK_LIST_CONVERSATIONS",
  buildListArgs: ({ cursor, limit }) => {
    // conversations.list doesn't accept a text query — agents that
    // need to find a specific channel paginate or pass channel ids
    // directly to read_integration_object.
    const args: Record<string, unknown> = {
      limit: Math.min(Math.max(limit, 1), 200),
      exclude_archived: true,
      types: "public_channel,private_channel",
    };
    if (cursor) args.cursor = cursor;
    return args;
  },
  parseListResponse: (data) => {
    const root = (data.response_data as Record<string, unknown> | undefined) ?? data;
    const channels = asArray(root.channels) as Array<Record<string, unknown>>;
    const objects: IntegrationObject[] = channels.map((c) => ({
      id: (asString(c.id) ?? "") as string,
      title: (asString(c.name)
        ? `#${asString(c.name)}`
        : (asString(c.name_normalized) ?? "(no name)")) as string,
      url: null,
      lastModified: null,
    }));
    const meta = root.response_metadata as Record<string, unknown> | undefined;
    return { objects, nextCursor: meta ? asString(meta.next_cursor) : null };
  },
  fetchActionSlug: "SLACK_FETCH_CONVERSATION_HISTORY",
  buildFetchArgs: ({ objectId }) => ({
    channel: objectId,
    limit: 50,
  }),
  parseFetchResponse: (data) => {
    const root = (data.response_data as Record<string, unknown> | undefined) ?? data;
    const messages = asArray(root.messages) as Array<Record<string, unknown>>;
    // Composio's response orders newest-first; reverse so the body
    // reads in chronological order.
    const ordered = [...messages].reverse();
    const lines = ordered.map((m) => {
      const user = asString(m.user) ?? asString(m.username) ?? "unknown";
      const ts = asString(m.ts);
      const text = asString(m.text) ?? "";
      return `**${user}**${ts ? ` _(ts ${ts})_` : ""}: ${text}`;
    });
    return {
      title: `Slack conversation ${asString((root as Record<string, unknown>).channel_name) ?? ""}`.trim(),
      url: null,
      body: lines.join("\n\n"),
      lastModified: null,
    };
  },
  actions: [],
};

const ATTIO: ProviderConfig = {
  composioAuthConfigEnv: "INTEGRATIONS_ATTIO_AUTH_CONFIG_ID",
  composioToolkit: "ATTIO",
  // Verified slugs via Composio's Attio toolkit docs.
  // ATTIO_GET_SELF returns metadata about the access token + linked
  // workspace; no avatar / email surfaced, but the workspace label
  // is useful for the connections card.
  profileActionSlug: "ATTIO_GET_SELF",
  parseProfileResponse: (raw) => {
    const root = (raw.response_data as Record<string, unknown> | undefined) ?? raw;
    const data = (root.data as Record<string, unknown> | undefined) ?? root;
    const workspaceName =
      asString(data.workspace_name) ??
      asString(data.workspace_slug) ??
      asString(data.active_workspace_id);
    return {
      email: null,
      label: workspaceName,
      avatarUrl: null,
    };
  },
  sourcePlatform: "attio",
  sourceType: "attio_record",
  // Attio record URLs include the workspace slug, which we don't
  // have at config time; return a generic app-relative URL and let
  // the agent fall back to Attio's own response payloads when it
  // needs a permalink.
  urlBuilder: (id) => `https://app.attio.com/records/${id}`,
  // Read path: list records (default object type "companies") and
  // fetch a single record's structured field values. Pass `query`
  // to list a different object type (e.g. "people", "deals").
  listActionSlug: "ATTIO_LIST_RECORDS",
  buildListArgs: ({ query, cursor, limit }) => {
    const objectSlug = query?.trim() || "companies";
    const args: Record<string, unknown> = {
      object_type: objectSlug,
      limit: Math.min(Math.max(limit, 1), 100),
    };
    if (cursor) {
      const offset = Number(cursor);
      if (Number.isFinite(offset) && offset >= 0) args.offset = offset;
    }
    return args;
  },
  parseListResponse: (data) => {
    const root = (data.response_data as Record<string, unknown> | undefined) ?? data;
    const records = asArray(
      ((root.data as Record<string, unknown> | undefined)?.data as unknown[]) ??
        root.data ??
        root.records
    ) as Array<Record<string, unknown>>;
    const objects: IntegrationObject[] = records.map((r) => {
      const idHolder = (r.id as Record<string, unknown> | undefined) ?? r;
      const recordId =
        asString(idHolder.record_id) ??
        asString(idHolder.id) ??
        asString(r.record_id) ??
        "";
      const values = r.values as Record<string, unknown> | undefined;
      const title = pickAttioDisplayName(values) ?? recordId;
      return {
        id: recordId,
        title: title || "(unnamed)",
        url: null,
        lastModified: asString(r.updated_at) ?? asString(r.created_at),
      };
    });
    const hasMore = root.has_more === true;
    return { objects, nextCursor: hasMore ? String(records.length) : null };
  },
  fetchActionSlug: "ATTIO_FIND_RECORD",
  buildFetchArgs: ({ objectId }) => ({
    object_id: "companies",
    record_id: objectId,
  }),
  parseFetchResponse: (data) => {
    const root = (data.response_data as Record<string, unknown> | undefined) ?? data;
    const record = (root.data as Record<string, unknown> | undefined) ?? root;
    const idHolder = (record.id as Record<string, unknown> | undefined) ?? record;
    const recordId =
      asString(idHolder.record_id) ?? asString(idHolder.id) ?? "(record)";
    const values = record.values as Record<string, unknown> | undefined;
    const title = pickAttioDisplayName(values) ?? recordId;
    const lines: string[] = [`# ${title}`, ""];
    if (values) {
      for (const [field, vals] of Object.entries(values)) {
        const arr = Array.isArray(vals)
          ? (vals as Array<Record<string, unknown>>)
          : [];
        const texts = arr
          .map(
            (v) =>
              asString(v.value) ??
              asString(v.full_name) ??
              asString(v.domain) ??
              asString(v.email_address) ??
              null
          )
          .filter((t): t is string => t !== null);
        if (texts.length > 0) {
          lines.push(`**${field}:** ${texts.join(", ")}`);
        }
      }
    }
    return {
      title,
      url: null,
      body: lines.join("\n"),
      lastModified: asString(record.updated_at) ?? asString(record.created_at),
    };
  },
  actions: [],
};

function pickAttioDisplayName(
  values: Record<string, unknown> | undefined
): string | null {
  if (!values) return null;
  // Attio attribute values are time-bounded arrays; the current value
  // is the first item (most-recent active interval). Try the common
  // name-bearing attribute keys in priority order.
  const keys = ["name", "full_name", "domains", "title", "primary_email_address"];
  for (const key of keys) {
    const arr = values[key];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const first = arr[0] as Record<string, unknown>;
    const candidate =
      asString(first.value) ??
      asString(first.full_name) ??
      asString(first.domain) ??
      asString(first.email_address);
    if (candidate) return candidate;
  }
  return null;
}

const CONFIGS: Record<IntegrationProvider, ProviderConfig> = {
  notion: NOTION,
  gmail: GMAIL,
  google_drive: GOOGLE_DRIVE,
  github: GITHUB,
  google_calendar: GOOGLE_CALENDAR,
  google_docs: GOOGLE_DOCS,
  google_sheets: GOOGLE_SHEETS,
  slack: SLACK,
  attio: ATTIO,
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
