import { API, curl, DEVICE_ID, EXAMPLE_DEVICE, json } from "./shared";
import type { DocBlock, DocPage, DocParam, HttpMethod } from "./types";

/**
 * The API Reference tab, hand written from `docs/specs/device-sdk/openapi.yaml` until a generator
 * is picked, with behaviour taken from the built routes (`src/app/api/v1/*`). ⚠ Deployed in 1.43.0
 * (2026-10-27) for design partners: every page here is `beta`. Paths, fields and status codes match the
 * contract exactly (`content.test.ts` parses the file and checks every path). `GET /devices/{id}`
 * was served in A9.
 */

const PLANNED: DocBlock = {
  type: "quote",
  text: "Beta. This endpoint is live for design partners, with keys that Dopl issues while the developer portal is being built.",
};

const AUTH: DocParam = {
  name: "Authorization",
  type: "string",
  location: "header",
  required: true,
  description: "A project secret key (`sk_test_…` or `sk_live_…`) sent as `Authorization: Bearer <key>`. Server to server only.",
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
    "Optional. When sent it must equal the body's `idempotency_key`, or the request fails with `invalid_request`. A retry with the same key and body returns the first response; the same key with a different body returns `idempotency_conflict`.",
};

const IDEMPOTENCY_ACCEPTED: DocParam = {
  ...IDEMPOTENCY,
  description: "Optional and accepted for consistency. This route does not replay responses.",
};

const IDEMPOTENCY_KEY_BODY: DocParam = {
  name: "idempotency_key",
  type: "string",
  required: true,
  description: "1 to 255 characters, unique per request within the environment. The TypeScript SDK fills one when you pass none.",
};

const EXTERNAL_USER_ID: DocParam = {
  name: "external_user_id",
  type: "string",
  location: "path",
  required: true,
  description: "Your own ID for the end user, 1 to 255 characters. End users never need a Dopl account.",
};

const pathId = (description: string): DocParam => ({ name: "id", type: "string", location: "path", required: true, description });

const errorExample = (label: string, type: string, code: string, message: string, retryable = false) => ({
  label,
  code: json({
    error: { type, code, message, retryable, doc_url: `https://www.usedopl.com/docs/errors/${code.replace(/_/g, "-")}` },
  }),
});

const ERROR_404 = errorExample("404", "invalid_request_error", "not_found", "No end user usr_123 in this project.");

const DELIVERY_ID = "4f7e2a10-6c1b-4d9e-8a35-0b2c7d9e1f42";

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
  /** Prose between the endpoint line and the parameters. */
  notes?: string[];
  status: string;
  response: string;
  /** The error example in the aside; a 404 unless the route has a likelier one. */
  error?: { label: string; code: string };
}

function endpoint(e: EndpointSpec): DocPage {
  return {
    slug: `api-reference/${e.slug}`,
    section: "api",
    group: e.group,
    title: e.title,
    description: e.description,
    status: "beta",
    blocks: [
      PLANNED,
      { type: "endpoint", method: e.method, path: `/v1${e.path}` },
      ...(e.notes ?? []).map((text): DocBlock => ({ type: "p", text })),
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
  ["device_offline", 409, "device_error", true, "No target device is online"],
  ["capability_unsupported", 422, "invalid_request_error", false, "The device does not publish this capability, or its profile does not allow it"],
  ["grant_missing", 403, "permission_error", false, "The user has not granted this capability at this tier"],
  ["grant_expired", 403, "permission_error", false, "The grant has expired"],
  ["confirmation_denied", 403, "permission_error", false, "The profile denies this tier, which is the default for T4"],
  ["rate_limited", 429, "rate_limit_error", true, "Too many requests for this project and environment"],
  ["vendor_error", 502, "device_error", true, "The vendor's service failed, or delivery to this kind of device is not available yet"],
  ["needs_reauth", 409, "permission_error", false, "The user must reconnect the device"],
  ["invalid_request", 400, "invalid_request_error", false, "The request does not match the contract, or a token is invalid or used"],
  ["unauthenticated", 401, "authentication_error", false, "The key is missing, unknown, revoked or expired"],
  ["insufficient_scope", 403, "permission_error", false, "The key's scopes do not cover this route, or a publishable key called a secret key route"],
  ["not_found", 404, "invalid_request_error", false, "No such user, device, connection or action"],
  ["idempotency_conflict", 409, "invalid_request_error", false, "The idempotency key was already used with a different body"],
];

const CONNECTION = {
  id: "c3a9e0d4-1f27-4b8e-9d6a-5e8f2c1b7a90",
  external_user_id: "usr_123",
  status: "active",
  device: EXAMPLE_DEVICE,
  grants: [
    { scope: "present.*", granted_at: "2026-10-27T17:01:02Z", expires_at: null },
    { scope: "ask.*", granted_at: "2026-10-27T17:01:02Z", expires_at: null },
  ],
  created_at: "2026-10-27T17:01:02Z",
  revoked_at: null,
};

const p = (text: string): DocBlock => ({ type: "p", text });

export const API_PAGES: DocPage[] = [
  {
    slug: "api-reference",
    section: "api",
    group: "Overview",
    title: "About the Dopl API",
    description: "The REST API of the Device SDK",
    status: "beta",
    blocks: [
      p(
        "Agents reach Dopl today through the [hosted MCP server](/docs/sdks/hosted-mcp). The Device SDK adds a REST API for your own product and your own users, with a TypeScript SDK and a project MCP server on top of it. It is live for design partners: Dopl issues your project's keys while the developer portal is being built, and `@dopl/sdk` is available on request."
      ),
      { type: "h2", text: "Base URL" },
      p(`JSON over HTTPS at \`${API}\`.`),
      { type: "h2", text: "Authentication" },
      p(
        "Send a project secret key as `Authorization: Bearer sk_test_…` or `sk_live_…` from your server. Publishable `pk_…` keys may only create Connect sessions. Each key carries scopes that decide which routes it can call. See [Projects, environments and keys](/docs/concepts/projects-and-keys)."
      ),
      { type: "h2", text: "Idempotency" },
      p(
        "Deliver and device actions take an `idempotency_key` in the body, and optionally the same value in an `Idempotency-Key` header; when both are sent they must match. A retry with the same key and the same body returns the first response, status included, without acting twice. The same key with a different body fails with `idempotency_conflict`."
      ),
      { type: "h2", text: "Asynchronous actions" },
      p(
        "Deliver and device actions answer `202` with a status: `queued`, `delivered`, `done`, `failed` or `needs_confirmation`. A question holds the request for up to 200 seconds while the user answers. If it is not answered by then, the status is still `delivered` or `queued`, and you read the answer later with [Get an action](/docs/api-reference/actions), passing the `delivery_id` or `action_id`."
      ),
      { type: "h2", text: "Request IDs" },
      p("Every response carries a `Request-Id` header, which is the ID of the event Dopl recorded for the call."),
      { type: "h2", text: "Errors" },
      p("Every error has the same shape, with a stable `code` and a `retryable` flag. See [Errors](/docs/api-reference/errors)."),
      { type: "h2", text: "Versions" },
      p("The API is versioned by date and each project is pinned to one version. The current version is `2026-10-27`."),
    ],
  },
  {
    slug: "api-reference/errors",
    section: "api",
    group: "Overview",
    title: "Errors",
    description: "One error shape on every route",
    status: "beta",
    blocks: [
      PLANNED,
      {
        type: "code",
        tabs: [
          {
            label: "409",
            code: json({
              error: {
                type: "device_error",
                code: "device_offline",
                message: "No target device is online.",
                retryable: true,
                doc_url: "https://www.usedopl.com/docs/errors/device-offline",
              },
            }),
          },
        ],
      },
      p(
        "`device_kind` appears when one device is involved. Retry only when `retryable` is true, with the same idempotency key. The `Request-Id` header identifies the call."
      ),
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
    description: "Start the hosted page your user follows to pair a device and approve scopes",
    method: "POST",
    path: "/connect_sessions",
    examplePath: "/connect_sessions",
    pathParams: [],
    auth: AUTH_PUBLISHABLE,
    headers: [IDEMPOTENCY_ACCEPTED],
    notes: [
      "Creates the end user the first time it sees the `external_user_id`. The returned `url` opens the hosted page for 30 minutes; when the user finishes, the page redirects to `redirect_uri` with a `public_token` query parameter. Key scope `connect`.",
    ],
    body: [
      { name: "external_user_id", type: "string", required: true, description: "Your own ID for the end user." },
      { name: "requested_scopes", type: "string[]", required: true, description: "Capability IDs or whole families such as `present.*`. At least one." },
      { name: "allowed_kinds", type: "string[]", description: "Limit the devices offered, for example `glasses`. Defaults to every kind." },
      { name: "redirect_uri", type: "string", description: "An http or https URL the page returns to with the `public_token`." },
      { name: "branding", type: "object", description: "`display_name`, `logo_url` and `accent_color` (`#RRGGBB`), over your project's saved branding." },
    ],
    requestBody: '{"external_user_id":"usr_123","requested_scopes":["present.*","ask.*"],"redirect_uri":"https://example.com/connected"}',
    status: "201",
    response: json({ connect_token: "ct_…", url: "https://www.usedopl.com/connect/ct_…", expires_at: "2026-10-27T17:32:11Z" }),
    error: errorExample("400", "invalid_request_error", "invalid_request", "requested_scopes: Too small: expected array to have >=1 items"),
  }),
  endpoint({
    slug: "connections-exchange",
    group: "Connect",
    title: "Exchange a public token",
    description: "Turn the token the hosted page returns into a durable connection",
    method: "POST",
    path: "/connections/exchange",
    examplePath: "/connections/exchange",
    pathParams: [],
    headers: [IDEMPOTENCY_ACCEPTED],
    notes: ["A public token exchanges once, within 30 minutes of the user finishing. Secret key, scope `connect`."],
    body: [{ name: "public_token", type: "string", required: true, description: "The `public_token` the hosted page added to your `redirect_uri`." }],
    requestBody: '{"public_token":"public-test-…"}',
    status: "200",
    response: json({ connection_id: CONNECTION.id, device: EXAMPLE_DEVICE }),
    error: errorExample("400", "invalid_request_error", "invalid_request", "public_token is invalid, expired or already exchanged."),
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
    notes: ["Revoked connections are included with the status `revoked`. Secret key, scope `connect`."],
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
    examplePath: `/connections/${CONNECTION.id}`,
    pathParams: [pathId("The connection to revoke.")],
    notes: ["Safe to repeat: revoking a revoked connection returns it unchanged. Secret key, scope `connect`."],
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
    notes: [
      "`available` lists online devices only, and `profile` is the one that applies to the active device. [Context profiles and routing](/docs/concepts/context-profiles-and-routing) explains each field. Secret key, scope `devices:read`.",
    ],
    status: "200",
    response: json({
      active_device: { id: DEVICE_ID, kind: "glasses", model: "simulated_glasses", last_seen_s: 4 },
      posture: "glanceable",
      available: [{ kind: "glasses", id: DEVICE_ID, capabilities: ["presence.read", "present.notify", "present.display", "ask.choice"] }],
      profile: { id: "glasses-default", prompt_append: "They are on glasses: …", output: { max_lines: 5, max_chars: 300, format: "plain", markdown: false } },
      source_of_last_message: null,
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
    notes: [
      "Dopl routes the request, checks the grant and the tier, and enforces the device's limits without rewriting the content. `routed_to` says which device and why. An `ask` holds up to 200 seconds for the answer; read it with [Get an action](/docs/api-reference/actions) and the `delivery_id`. With `overflow: \"callback\"` and content over the limits, nothing is delivered, `status` is `failed` and the response adds `overflow_callback`. Secret key, scope `actions:write`.",
    ],
    body: [
      { name: "intent", type: "string", required: true, description: "`message`, `ask`, `notify` or `display`. The SDK's `notify`, `show` and `ask` set this for you." },
      { name: "content", type: "object", required: true, description: "At least one of `text`, `blocks` (display blocks) or `options` (two or more choices)." },
      { name: "urgency", type: "string", required: true, description: "`low` (the active device only), `normal` (the top device) or `high` (every eligible device)." },
      { name: "target", type: "string", description: "`auto` (the default), a device kind, or a device ID." },
      { name: "profile", type: "string", description: "One of your project's profile IDs, applied to this request only." },
      IDEMPOTENCY_KEY_BODY,
    ],
    requestBody:
      '{"intent":"ask","content":{"text":"Book the 9:40 flight?","options":[{"label":"Yes"},{"label":"No"}]},"urgency":"normal","idempotency_key":"req_01"}',
    status: "202",
    response: json({
      delivery_id: DELIVERY_ID,
      routed_to: { device_id: DEVICE_ID, kind: "glasses", reason: "fallback chain" },
      status: "done",
    }),
    error: errorExample("409", "invalid_request_error", "idempotency_conflict", 'Idempotency key "req_01" was already used with a different request.'),
  }),
  endpoint({
    slug: "device-actions",
    group: "Actions",
    title: "Run a device action",
    description: "Run one capability on one device",
    method: "POST",
    path: "/devices/{device_id}/actions/{capability}",
    examplePath: `/devices/${DEVICE_ID}/actions/present.notify`,
    pathParams: [
      { name: "device_id", type: "string", location: "path", required: true, description: "The device to act on." },
      {
        name: "capability",
        type: "string",
        location: "path",
        required: true,
        description: "A capability ID such as `present.display`, `present.notify` or `ask.choice`.",
      },
    ],
    headers: [IDEMPOTENCY],
    notes: [
      "The device must be online, publish the capability and allow it under its profile, and the user's grant must cover it. `ask.*` actions hold up to 200 seconds for the answer. T4 capabilities fail with `confirmation_denied` by default; when the profile sets a confirmation mode they return `needs_confirmation` and do not run. Secret key, scope `actions:write`.",
    ],
    body: [
      { name: "args", type: "object", required: true, description: "The capability's arguments, such as `{ \"body\": \"…\" }` for `present.notify`." },
      IDEMPOTENCY_KEY_BODY,
    ],
    requestBody: '{"args":{"body":"Build finished"},"idempotency_key":"req_02"}',
    status: "202",
    response: json({ action_id: "9d2e4b71-0a3c-4f86-b5e1-7c9a2d4f6b08", status: "done" }),
    error: errorExample("409", "device_error", "device_offline", `Device ${DEVICE_ID} is offline.`, true),
  }),
  endpoint({
    slug: "actions",
    group: "Actions",
    title: "Get an action",
    description: "Read a delivery's or device action's status and result",
    method: "GET",
    path: "/actions/{id}",
    examplePath: `/actions/${DELIVERY_ID}`,
    pathParams: [pathId("A `delivery_id` from Deliver or an `action_id` from Run a device action.")],
    notes: ["`result` holds the answer once an `ask` is `done`. Secret key, scope `actions:write`."],
    status: "200",
    response: json({
      action_id: DELIVERY_ID,
      device_id: DEVICE_ID,
      capability: "ask.choice",
      status: "done",
      result: { simulated: true, index: 0, label: "Yes" },
      error: null,
      created_at: "2026-10-27T17:02:11Z",
      updated_at: "2026-10-27T17:02:11Z",
    }),
  }),
  endpoint({
    slug: "devices",
    group: "Devices",
    title: "Get a device",
    description: "A device and its capability descriptors",
    method: "GET",
    path: "/devices/{id}",
    examplePath: `/devices/${DEVICE_ID}`,
    pathParams: [pathId("The device to read.")],
    notes: [
      "`capabilities` comes from the device's adapter and `online` from when it was last seen. A device in another project or environment, or one that was revoked, returns `not_found`. Secret key, scope `devices:read`.",
    ],
    status: "200",
    response: json(EXAMPLE_DEVICE),
  }),
];
