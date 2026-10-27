import { API, curl, EXAMPLE_DEVICE, json } from "./shared";
import type { DocPage, DocParam, HttpMethod } from "./types";

/**
 * The API Reference tab, hand written from `docs/specs/device-sdk/openapi.yaml` until a
 * generator is picked. ⚠ The `/v1` REST surface is PLANNED: every page here is `coming_soon`,
 * its copy says so, and paths, fields and status codes match that file exactly
 * (`content.test.ts` parses the file and checks every path).
 */

const PLANNED: { type: "quote"; text: string } = {
  type: "quote",
  text: "Planned. This endpoint is part of the Device SDK contract and is not live yet. Today, agents reach devices through the [hosted MCP server](/docs/sdks/hosted-mcp).",
};

const AUTH: DocParam = {
  name: "Authorization",
  type: "string",
  location: "header",
  required: true,
  description:
    "A project secret key (`sk_test_…` or `sk_live_…`) sent as `Authorization: Bearer <key>`. Server to server only.",
};

const AUTH_PUBLISHABLE: DocParam = {
  ...AUTH,
  description:
    "A project secret key, or a publishable `pk_…` key from your app, sent as `Authorization: Bearer <key>`. This is the only route a publishable key may call.",
};

const IDEMPOTENCY: DocParam = {
  name: "Idempotency-Key",
  type: "string",
  location: "header",
  description:
    "Optional on every POST. When the body also carries `idempotency_key`, both must match; reusing a key with a different body returns `idempotency_conflict`.",
};

const EXTERNAL_USER_ID: DocParam = {
  name: "external_user_id",
  type: "string",
  location: "path",
  required: true,
  description: "Your own ID for the end user. End users never need a Dopl account.",
};

const pathId = (description: string): DocParam => ({ name: "id", type: "string", location: "path", required: true, description });

const ERROR_404 = {
  label: "404",
  code: json({
    error: { type: "invalid_request_error", code: "not_found", message: "No such user.", retryable: false, doc_url: "…" },
  }),
};

/** `POST /connect_sessions` has no 404 in the contract; show its 400 instead. */
const ERROR_400 = {
  label: "400",
  code: json({
    error: {
      type: "invalid_request_error",
      code: "invalid_request",
      message: "requested_scopes must not be empty.",
      retryable: false,
      doc_url: "…",
    },
  }),
};

interface EndpointSpec {
  slug: string;
  group: "Connect" | "Context" | "Actions" | "Devices";
  title: string;
  description: string;
  method: HttpMethod;
  path: string;
  examplePath: string;
  pathParams: DocParam[];
  auth?: DocParam;
  headers?: DocParam[];
  body?: DocParam[];
  requestBody?: string;
  status: string;
  response: string;
  /** The error example in the aside; a 404 unless the route has none. */
  error?: { label: string; code: string };
}

function endpoint(e: EndpointSpec): DocPage {
  return {
    slug: `api-reference/${e.slug}`,
    tab: "api",
    group: e.group,
    title: e.title,
    description: e.description,
    status: "coming_soon",
    blocks: [
      PLANNED,
      { type: "endpoint", method: e.method, path: `/v1${e.path}` },
      { type: "params", title: "Authorizations", params: [e.auth ?? AUTH, ...(e.headers ?? [])] },
      ...(e.pathParams.length > 0 ? [{ type: "params" as const, title: "Path parameters", params: e.pathParams }] : []),
      ...(e.body && e.body.length > 0 ? [{ type: "params" as const, title: "Body", params: e.body }] : []),
    ],
    aside: {
      title: e.title,
      request: [{ label: "cURL", code: curl(e.method, e.examplePath, e.requestBody) }],
      responses: [{ label: e.status, code: e.response }, e.error ?? ERROR_404],
    },
  };
}

/** C10 (`errors.ts › ERROR_CODE_INFO`): code, HTTP status, type, retryable, meaning. */
export const ERROR_ROWS: [code: string, status: number, type: string, retryable: boolean, meaning: string][] = [
  ["device_offline", 409, "device_error", true, "The device has not been seen recently"],
  ["capability_unsupported", 422, "invalid_request_error", false, "The device does not publish this capability"],
  ["grant_missing", 403, "permission_error", false, "The user has not granted this capability"],
  ["grant_expired", 403, "permission_error", false, "The grant has expired"],
  ["confirmation_denied", 403, "permission_error", false, "The user declined, or the profile denies this tier"],
  ["rate_limited", 429, "rate_limit_error", true, "Too many requests for this project"],
  ["vendor_error", 502, "device_error", true, "The vendor's service failed"],
  ["needs_reauth", 409, "permission_error", false, "The user must sign in to the vendor again"],
  ["invalid_request", 400, "invalid_request_error", false, "The request does not match the contract"],
  ["unauthenticated", 401, "authentication_error", false, "The key is missing, unknown or revoked"],
  ["insufficient_scope", 403, "permission_error", false, "The key's scopes do not cover this route"],
  ["not_found", 404, "invalid_request_error", false, "No such user, device, connection or action"],
  ["idempotency_conflict", 409, "invalid_request_error", false, "The idempotency key was reused with a different body"],
];

const CONNECTION = {
  id: "con_7a20",
  external_user_id: "usr_123",
  status: "active",
  device: EXAMPLE_DEVICE,
  grants: [{ scope: "present.*", granted_at: "2026-10-27T17:01:02Z", expires_at: null }],
  created_at: "2026-10-27T17:01:02Z",
  revoked_at: null,
};

export const API_PAGES: DocPage[] = [
  {
    slug: "api-reference",
    tab: "api",
    group: "Overview",
    title: "About the Dopl API",
    description: "The planned REST API of the Device SDK",
    status: "coming_soon",
    blocks: [
      {
        type: "p",
        text: "Agents reach Dopl today through the [hosted MCP server](/docs/sdks/hosted-mcp). The Device SDK adds a REST API, typed SDKs and an embeddable Connect widget on top of the same platform; those interfaces are in development and the pages in this tab describe their planned contract.",
      },
      { type: "h2", text: "Base URL" },
      { type: "p", text: `JSON over HTTPS at \`${API}\`.` },
      { type: "h2", text: "Authentication" },
      {
        type: "p",
        text: "Send a project secret key as `Authorization: Bearer sk_test_…` or `sk_live_…` from your server. Publishable `pk_…` keys may only create Connect sessions. See [Projects, environments and keys](/docs/concepts/projects-and-keys).",
      },
      { type: "h2", text: "Requests" },
      {
        type: "p",
        text: "Every action is asynchronous and idempotent. Each POST takes an `idempotency_key` in the body, and optionally the same value in an `Idempotency-Key` header. Deliver by intent with [Deliver](/docs/api-reference/deliver) and let Dopl route it, or call one capability on one device with [Run a device action](/docs/api-reference/device-actions).",
      },
      { type: "h2", text: "Errors" },
      {
        type: "p",
        text: "Every error has the same shape, with a stable `code` and a `retryable` flag. See [Errors](/docs/api-reference/errors).",
      },
      { type: "h2", text: "Versions" },
      { type: "p", text: "The API is versioned by date and each project is pinned to one version. The current version is `2026-10-27`." },
    ],
  },
  {
    slug: "api-reference/errors",
    tab: "api",
    group: "Overview",
    title: "Errors",
    description: "One error shape on every route",
    status: "coming_soon",
    blocks: [
      PLANNED,
      {
        type: "code",
        tabs: [
          {
            label: "Error",
            code: json({
              error: {
                type: "device_error",
                code: "device_offline",
                message: "The device has not been seen recently.",
                device_kind: "glasses",
                retryable: true,
                doc_url: "https://www.usedopl.com/docs/errors/device-offline",
              },
            }),
          },
        ],
      },
      {
        type: "p",
        text: "`device_kind` appears when a device is involved. Retry only when `retryable` is true, with the same idempotency key.",
      },
      { type: "h2", text: "Codes" },
      {
        type: "table",
        columns: ["Code", "HTTP", "Type", "Retryable", "Meaning"],
        rows: ERROR_ROWS.map(([code, status, type, retryable, meaning]) => [
          `\`${code}\``,
          String(status),
          `\`${type}\``,
          retryable ? "Yes" : "No",
          meaning,
        ]),
      },
    ],
  },
  endpoint({
    slug: "connect-sessions",
    group: "Connect",
    title: "Create a Connect session",
    description: "Start the flow your user follows to pair a device and approve scopes",
    method: "POST",
    path: "/connect_sessions",
    examplePath: "/connect_sessions",
    pathParams: [],
    auth: AUTH_PUBLISHABLE,
    headers: [IDEMPOTENCY],
    body: [
      { name: "external_user_id", type: "string", required: true, description: "Your own ID for the end user." },
      {
        name: "requested_scopes",
        type: "string[]",
        required: true,
        description: "Capability IDs or whole families such as `present.*`.",
      },
      { name: "allowed_kinds", type: "string[]", description: "Limit the devices offered, for example `glasses`." },
      { name: "redirect_uri", type: "string", description: "Where the hosted flow returns when it finishes." },
      { name: "branding", type: "object", description: "`display_name`, `logo_url` and `accent_color`." },
    ],
    requestBody: '{"external_user_id":"usr_123","requested_scopes":["present.*","ask.*"]}',
    status: "201",
    response: json({ connect_token: "ct_9d1e", url: "https://…", expires_at: "2026-10-27T17:32:11Z" }),
    error: ERROR_400,
  }),
  endpoint({
    slug: "connections-exchange",
    group: "Connect",
    title: "Exchange a public token",
    description: "Turn the token the Connect flow returns into a durable connection",
    method: "POST",
    path: "/connections/exchange",
    examplePath: "/connections/exchange",
    pathParams: [],
    headers: [IDEMPOTENCY],
    body: [{ name: "public_token", type: "string", required: true, description: "The token the Connect flow returned." }],
    requestBody: '{"public_token":"pt_51c0"}',
    status: "200",
    response: json({ connection_id: "con_7a20", device: EXAMPLE_DEVICE }),
  }),
  endpoint({
    slug: "connections",
    group: "Connect",
    title: "List connections",
    description: "List the devices an end user has connected and the scopes they granted",
    method: "GET",
    path: "/users/{external_user_id}/connections",
    examplePath: "/users/usr_123/connections",
    pathParams: [EXTERNAL_USER_ID],
    status: "200",
    response: json({ data: [CONNECTION] }),
  }),
  endpoint({
    slug: "revoke-connection",
    group: "Connect",
    title: "Revoke a connection",
    description: "Stop your agent reaching a device, effective immediately",
    method: "DELETE",
    path: "/connections/{id}",
    examplePath: "/connections/con_7a20",
    pathParams: [pathId("The connection to revoke.")],
    status: "200",
    response: json({ ...CONNECTION, status: "revoked", revoked_at: "2026-10-28T09:00:00Z" }),
  }),
  endpoint({
    slug: "context",
    group: "Context",
    title: "Get context",
    description: "The user's active device, posture, available devices and matched profile",
    method: "GET",
    path: "/users/{external_user_id}/context",
    examplePath: "/users/usr_123/context",
    pathParams: [EXTERNAL_USER_ID],
    status: "200",
    response: json({
      active_device: { id: "dev_g2_01", kind: "glasses", model: "g2", last_seen_s: 4 },
      posture: "glanceable",
      available: [{ kind: "glasses", id: "dev_g2_01", capabilities: ["present.display", "ask.choice"] }],
      profile: { id: "ar-glasses", prompt_append: "…", output: { max_lines: 3, format: "plain" } },
      source_of_last_message: "glasses",
    }),
  }),
  endpoint({
    slug: "deliver",
    group: "Actions",
    title: "Deliver",
    description: "Deliver content by intent and let Dopl route it to one of the user's devices",
    method: "POST",
    path: "/users/{external_user_id}/deliver",
    examplePath: "/users/usr_123/deliver",
    pathParams: [EXTERNAL_USER_ID],
    headers: [IDEMPOTENCY],
    body: [
      {
        name: "intent",
        type: "string",
        required: true,
        description:
          "`message`, `ask`, `notify` or `display`. The SDK helpers `show`, `ask` and `notify` set this for you.",
      },
      {
        name: "content",
        type: "object",
        required: true,
        description: "At least one of `text`, `blocks` (display blocks) or `options` (two or more choices).",
      },
      { name: "urgency", type: "string", required: true, description: "`low`, `normal` or `high`." },
      { name: "target", type: "string", description: "`auto`, a device kind, or a device ID." },
      { name: "profile", type: "string", description: "A context profile ID to apply instead of the matched one." },
      { name: "idempotency_key", type: "string", required: true, description: "Up to 255 characters." },
    ],
    requestBody:
      '{"intent":"ask","content":{"text":"Book the 9:40 flight?","options":[{"label":"Yes"},{"label":"No"}]},"urgency":"normal","idempotency_key":"req_01"}',
    status: "202",
    response: json({
      delivery_id: "dlv_8f2c",
      routed_to: { device_id: "dev_g2_01", kind: "glasses", reason: "last message came from this device" },
      status: "delivered",
    }),
  }),
  endpoint({
    slug: "device-actions",
    group: "Actions",
    title: "Run a device action",
    description: "Run one capability on one device",
    method: "POST",
    path: "/devices/{device_id}/actions/{capability}",
    examplePath: "/devices/dev_g2_01/actions/present.notify",
    pathParams: [
      { name: "device_id", type: "string", location: "path", required: true, description: "The device to act on." },
      {
        name: "capability",
        type: "string",
        location: "path",
        required: true,
        description:
          "A capability ID such as `present.display`, `present.notify` or `ask.choice`. `ask.*` actions hold for up to 200 seconds, and T4 capabilities return `needs_confirmation` first.",
      },
    ],
    headers: [IDEMPOTENCY],
    body: [
      { name: "args", type: "object", required: true, description: "The capability's arguments." },
      { name: "idempotency_key", type: "string", required: true, description: "Up to 255 characters." },
    ],
    requestBody: '{"args":{"text":"Build finished"},"idempotency_key":"req_02"}',
    status: "202",
    response: json({ action_id: "act_41ab", status: "queued" }),
  }),
  endpoint({
    slug: "actions",
    group: "Actions",
    title: "Get an action",
    description: "Read an action's status and result",
    method: "GET",
    path: "/actions/{id}",
    examplePath: "/actions/act_41ab",
    pathParams: [pathId("The `action_id` to read.")],
    status: "200",
    response: json({
      action_id: "act_41ab",
      device_id: "dev_g2_01",
      capability: "ask.choice",
      status: "done",
      result: { choice: "Yes" },
      error: null,
      created_at: "2026-10-27T17:02:11Z",
      updated_at: "2026-10-27T17:02:19Z",
    }),
  }),
  endpoint({
    slug: "devices",
    group: "Devices",
    title: "Get a device",
    description: "A device and its capability descriptors",
    method: "GET",
    path: "/devices/{id}",
    examplePath: "/devices/dev_g2_01",
    pathParams: [pathId("The device to read.")],
    status: "200",
    response: json({
      ...EXAMPLE_DEVICE,
      capabilities: [
        {
          capability: "present.notify",
          limits: { title_bytes: 64, body_bytes: 400 },
          latency_class: "interactive",
          risk_tier: "T1",
          since_adapter: "even_g2@0.1.0",
        },
      ],
    }),
  }),
];
