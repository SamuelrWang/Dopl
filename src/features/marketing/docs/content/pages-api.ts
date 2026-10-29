import { API, curl, DEVICE_ID, EXAMPLE_DEVICE, json } from "./shared";
import REFERENCE from "./openapi-reference.generated.json";
import type { RefOperation, RefParam } from "./openapi-reference";
import type { DocBlock, DocPage, DocParam } from "./types";

/**
 * The API Reference tab. ⚠ STRUCTURE IS GENERATED: method, path, auth, every parameter and body
 * field with its type and required flag, and the response codes come from
 * `openapi-reference.generated.json`, which `openapi-reference.test.ts` keeps equal to
 * `docs/specs/device-sdk/openapi.yaml`. This file adds only what a spec does not say well: a slug,
 * a title, prose per parameter NAME (`describe`, falling back to the spec's description), notes,
 * and request/response examples taken from the built routes (`src/app/api/v1/*`). The same test
 * fails when `describe` names a parameter the operation does not have, or a parameter ends up with
 * no description. ⚠ Deployed in 1.43.0 (2026-10-27) for design partners: every page is `beta`.
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

/** Prose for the parameters many routes share, by name. */
const IDEMPOTENCY =
  "Optional. When sent it must equal the body's `idempotency_key`, or the request fails with `invalid_request`. A retry with the same key and body returns the first response; the same key with a different body returns `idempotency_conflict`.";
const IDEMPOTENCY_ACCEPTED = "Optional and accepted for consistency. This route does not replay responses.";
const IDEMPOTENCY_KEY_BODY =
  "1 to 255 characters, unique per request within the environment. The TypeScript SDK fills one when you pass none.";
const EXTERNAL_USER_ID = "Your own ID for the end user, 1 to 255 characters. End users never need a Dopl account.";

const errorExample = (label: string, type: string, code: string, message: string, retryable = false) => ({
  label,
  code: json({
    error: { type, code, message, retryable, doc_url: `https://www.usedopl.com/docs/errors/${code.replace(/_/g, "-")}` },
  }),
});

const ERROR_404 = errorExample("404", "invalid_request_error", "not_found", "No end user usr_123 in this project.");

const DELIVERY_ID = "4f7e2a10-6c1b-4d9e-8a35-0b2c7d9e1f42";

const GROUP: Record<string, string> = {
  connect: "Connect",
  context: "Context",
  actions: "Actions",
  devices: "Devices",
  events: "Events",
};

export interface EndpointSpec {
  /** The spec's `operationId`; method, path, auth and parameters come from it. */
  op: string;
  slug: string;
  title: string;
  description: string;
  examplePath: string;
  /** Prose per parameter name; overrides the spec's own description. */
  describe?: Record<string, string>;
  requestBody?: string;
  /** Prose between the endpoint line and the parameters. */
  notes?: string[];
  response: string;
  /** The error example in the aside; a 404 unless the route has a likelier one. */
  error?: { label: string; code: string };
}

const OPS = REFERENCE as RefOperation[];

export function referenceOf(op: string): RefOperation {
  const ref = OPS.find((o) => o.operationId === op);
  if (!ref) throw new Error(`pages-api: no operation ${op} in openapi.yaml`);
  return ref;
}

/** The description a generated parameter shows: the page's prose, else the spec's. */
export function paramDescription(e: EndpointSpec, p: RefParam): string | null {
  return e.describe?.[p.name] ?? p.description;
}

function docParam(e: EndpointSpec, p: RefParam): DocParam {
  return {
    name: p.name,
    type: p.type,
    required: p.required || undefined,
    location: p.in === "body" ? undefined : p.in,
    description: paramDescription(e, p) ?? "",
  };
}

function endpoint(e: EndpointSpec): DocPage {
  const ref = referenceOf(e.op);
  const of = (where: RefParam["in"]) => ref.params.filter((p) => p.in === where).map((p) => docParam(e, p));
  const groups: Array<[string, DocParam[]]> = [
    ["Authorizations", [ref.auth === "publishable" ? AUTH_PUBLISHABLE : AUTH, ...of("header")]],
    ["Path parameters", of("path")],
    ["Query parameters", of("query")],
    ["Body", of("body")],
  ];
  const ok = ref.responses.find((r) => r.status.startsWith("2"));
  const errors = ref.responses.filter((r) => !r.status.startsWith("2")).map((r) => r.status);
  return {
    slug: `api-reference/${e.slug}`,
    section: "api",
    group: GROUP[ref.tag] ?? "API",
    title: e.title,
    description: e.description,
    status: "beta",
    blocks: [
      PLANNED,
      { type: "endpoint", method: ref.method, path: `/v1${ref.path}` },
      ...(e.notes ?? []).map((text): DocBlock => ({ type: "p", text })),
      ...groups
        .filter(([, params]) => params.length > 0)
        .map(([title, params]): DocBlock => ({ type: "params", title, params })),
      {
        type: "table",
        columns: ["Status", "Body"],
        rows: [
          ...(ok ? [[`\`${ok.status}\``, ok.schema ? `\`${ok.schema}\`` : "None"]] : []),
          ...(errors.length > 0 ? [[errors.map((s) => `\`${s}\``).join(", "), "[Error](/docs/api-reference/errors)"]] : []),
        ],
      },
    ],
    aside: {
      title: e.title,
      request: [{ label: "cURL", code: curl(ref.method, e.examplePath, e.requestBody) }],
      responses: [{ label: ok?.status ?? "200", code: e.response }, e.error ?? ERROR_404],
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

/** One page per spec operation (`openapi-reference.test.ts` checks the set). */
export const ENDPOINTS: EndpointSpec[] = [
  {
    op: "createConnectSession",
    slug: "connect-sessions",
    title: "Create a Connect session",
    description: "Start the hosted page your user follows to pair a device and approve scopes",
    examplePath: "/connect_sessions",
    notes: [
      "Creates the end user the first time it sees the `external_user_id`. The returned `url` opens the hosted page for 30 minutes; when the user finishes, the page redirects to `redirect_uri` with a `public_token` query parameter. Key scope `connect`.",
    ],
    describe: {
      "Idempotency-Key": IDEMPOTENCY_ACCEPTED,
      external_user_id: "Your own ID for the end user.",
      requested_scopes: "Capability IDs or whole families such as `present.*`. At least one.",
      allowed_kinds: "Limit the devices offered, for example `glasses`. Defaults to every kind.",
      redirect_uri: "An http or https URL the page returns to with the `public_token`.",
      branding: "`display_name`, `logo_url` and `accent_color` (`#RRGGBB`), over your project's saved branding.",
    },
    requestBody: '{"external_user_id":"usr_123","requested_scopes":["present.*","ask.*"],"redirect_uri":"https://example.com/connected"}',
    response: json({ connect_token: "ct_…", url: "https://www.usedopl.com/connect/ct_…", expires_at: "2026-10-27T17:32:11Z" }),
    error: errorExample("400", "invalid_request_error", "invalid_request", "requested_scopes: Too small: expected array to have >=1 items"),
  },
  {
    op: "exchangePublicToken",
    slug: "connections-exchange",
    title: "Exchange a public token",
    description: "Turn the token the hosted page returns into a durable connection",
    examplePath: "/connections/exchange",
    notes: ["A public token exchanges once, within 30 minutes of the user finishing. Secret key, scope `connect`."],
    describe: {
      "Idempotency-Key": IDEMPOTENCY_ACCEPTED,
      public_token: "The `public_token` the hosted page added to your `redirect_uri`.",
    },
    requestBody: '{"public_token":"public-test-…"}',
    response: json({ connection_id: CONNECTION.id, device: EXAMPLE_DEVICE }),
    error: errorExample("400", "invalid_request_error", "invalid_request", "public_token is invalid, expired or already exchanged."),
  },
  {
    op: "listConnections",
    slug: "connections",
    title: "List connections",
    description: "List the devices an end user has connected and the scopes they granted",
    examplePath: "/users/usr_123/connections",
    notes: ["Revoked connections are included with the status `revoked`. Secret key, scope `connect`."],
    describe: { external_user_id: EXTERNAL_USER_ID },
    response: json({ data: [CONNECTION] }),
  },
  {
    op: "revokeConnection",
    slug: "revoke-connection",
    title: "Revoke a connection",
    description: "Stop your agent reaching a device, effective immediately",
    examplePath: `/connections/${CONNECTION.id}`,
    notes: ["Safe to repeat: revoking a revoked connection returns it unchanged. Secret key, scope `connect`."],
    describe: { id: "The connection to revoke." },
    response: json({ ...CONNECTION, status: "revoked", revoked_at: "2026-10-28T09:00:00Z" }),
  },
  {
    op: "getContext",
    slug: "context",
    title: "Get context",
    description: "The user's active device, posture, available devices and matched profile",
    examplePath: "/users/usr_123/context",
    notes: [
      "`available` lists online devices only, and `profile` is the one that applies to the active device. [Context profiles and routing](/docs/concepts/context-profiles-and-routing) explains each field. Secret key, scope `devices:read`.",
    ],
    describe: { external_user_id: EXTERNAL_USER_ID },
    response: json({
      active_device: { id: DEVICE_ID, kind: "glasses", model: "simulated_glasses", last_seen_s: 4 },
      posture: "glanceable",
      available: [{ kind: "glasses", id: DEVICE_ID, capabilities: ["presence.read", "present.notify", "present.display", "ask.choice"] }],
      profile: { id: "glasses-default", prompt_append: "They are on glasses: …", output: { max_lines: 5, max_chars: 300, format: "plain", markdown: false } },
      source_of_last_message: null,
    }),
  },
  {
    op: "deliver",
    slug: "deliver",
    title: "Deliver",
    description: "Deliver content by intent and let Dopl route it to one of the user's devices",
    examplePath: "/users/usr_123/deliver",
    notes: [
      "Dopl routes the request, checks the grant and the tier, and enforces the device's limits without rewriting the content. `routed_to` says which device and why. An `ask` holds up to 200 seconds for the answer (send `Prefer: respond-async` to skip the hold); read it with [Get an action](/docs/api-reference/actions) and the `delivery_id`. With `overflow: \"callback\"` and content over the limits, nothing is delivered, `status` is `failed` and the response adds `overflow_callback`. Secret key, scope `actions:write`.",
    ],
    describe: {
      external_user_id: EXTERNAL_USER_ID,
      "Idempotency-Key": IDEMPOTENCY,
      intent: "`message`, `ask`, `notify` or `display`. The SDK's `notify`, `show` and `ask` set this for you.",
      content: "At least one of `text`, `blocks` (display blocks) or `options` (two or more choices).",
      urgency: "`low` (the active device only), `normal` (the top device) or `high` (every eligible device).",
      target: "`auto` (the default), a device kind, or a device ID.",
      profile: "One of your project's profile IDs, applied to this request only.",
      idempotency_key: IDEMPOTENCY_KEY_BODY,
    },
    requestBody:
      '{"intent":"ask","content":{"text":"Book the 9:40 flight?","options":[{"label":"Yes"},{"label":"No"}]},"urgency":"normal","idempotency_key":"req_01"}',
    response: json({
      delivery_id: DELIVERY_ID,
      routed_to: { device_id: DEVICE_ID, kind: "glasses", reason: "fallback chain" },
      status: "done",
    }),
    error: errorExample("409", "invalid_request_error", "idempotency_conflict", 'Idempotency key "req_01" was already used with a different request.'),
  },
  {
    op: "createDeviceAction",
    slug: "device-actions",
    title: "Run a device action",
    description: "Run one capability on one device",
    examplePath: `/devices/${DEVICE_ID}/actions/present.notify`,
    notes: [
      "The device must be online, publish the capability and allow it under its profile, and the user's grant must cover it. `ask.*` actions hold up to 200 seconds for the answer, unless you send `Prefer: respond-async`. T4 capabilities fail with `confirmation_denied` by default; when the profile sets a confirmation mode they return `needs_confirmation` and do not run. Secret key, scope `actions:write`.",
    ],
    describe: {
      device_id: "The device to act on.",
      capability: "A capability ID such as `present.display`, `present.notify` or `ask.choice`.",
      "Idempotency-Key": IDEMPOTENCY,
      args: "The capability's arguments, such as `{ \"body\": \"…\" }` for `present.notify`.",
      idempotency_key: IDEMPOTENCY_KEY_BODY,
    },
    requestBody: '{"args":{"body":"Build finished"},"idempotency_key":"req_02"}',
    response: json({ action_id: "9d2e4b71-0a3c-4f86-b5e1-7c9a2d4f6b08", status: "done" }),
    error: errorExample("409", "device_error", "device_offline", `Device ${DEVICE_ID} is offline.`, true),
  },
  {
    op: "getAction",
    slug: "actions",
    title: "Get an action",
    description: "Read a delivery's or device action's status and result",
    examplePath: `/actions/${DELIVERY_ID}`,
    notes: ["`result` holds the answer once an `ask` is `done`. Secret key, scope `actions:write`."],
    describe: { id: "A `delivery_id` from Deliver or an `action_id` from Run a device action." },
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
  },
  {
    op: "getDevice",
    slug: "devices",
    title: "Get a device",
    description: "A device and its capability descriptors",
    examplePath: `/devices/${DEVICE_ID}`,
    notes: [
      "`capabilities` comes from the device's adapter and `online` from when it was last seen. A device in another project or environment, or one that was revoked, returns `not_found`. Secret key, scope `devices:read`.",
    ],
    describe: { id: "The device to read." },
    response: json(EXAMPLE_DEVICE),
  },
  {
    op: "listEvents",
    slug: "events",
    title: "List events",
    description: "Your project's request log, newest first",
    examplePath: "/events?limit=2&outcome=error",
    notes: [
      "Every call your keys make is one event, and its `event_id` equals the call's `Request-Id` header. This route reads the calls of the key's own project and environment. Reading the log is not itself logged. Secret key, scope `analytics:read`. Limited to 60 requests a minute per key.",
    ],
    describe: {
      cursor: "Opaque. The `next_cursor` of the previous page, passed back unchanged.",
      limit: "1 to 100. Default 50.",
      since: "ISO date and time of the oldest event. Default 24 hours ago, at most 30 days ago.",
      outcome: "Only calls with this outcome.",
      device_kind: "Only calls that reached this kind of device.",
      capability: "Only calls for this capability, for example `present.display`.",
      intent: "Only calls with this intent.",
      route: "The routing target the call asked for: `auto`, a device kind or a device ID.",
    },
    response: json({
      data: [
        {
          event_id: "0b8f3c2e-5a41-4d7e-9c16-2f7a8e1d4b90",
          ts: "2026-10-28T17:02:11.204518Z",
          project_id: "8a1d4f2c-3b6e-4e90-a7c5-1d2e3f4a5b6c",
          env: "test",
          external_user_id: "usr_123",
          connection_id: null,
          device_id: DEVICE_ID,
          device_kind: "glasses",
          vendor: "even_realities",
          model: "even_g2",
          firmware: null,
          adapter_version: "0.3.0",
          capability: "present.display",
          intent: "display",
          route_decision: { target: "auto", reason: "only online device", candidates: [DEVICE_ID] },
          profile_id: "glasses-default",
          profile_version: 1,
          risk_tier: "T1",
          confirmation: { required: false, result: null },
          outcome: "error",
          error_code: "device_offline",
          latency_ms: { api: 41, device_delivery: null, user_response: null },
        },
      ],
      next_cursor: "MjAyNi0xMC0yOFQxNzowMjoxMS4yMDQ1MThafjBiOGYzYzJl",
      has_more: true,
    }),
    error: errorExample("429", "rate_limit_error", "rate_limited", "Too many log reads for this key. Try again in a minute.", true),
  },
];

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
        "Deliver and device actions answer `202` with a status: `queued`, `delivered`, `done`, `failed` or `needs_confirmation`. A question holds the request for up to 200 seconds while the user answers, unless you send `Prefer: respond-async`, which answers at once. If it is not answered by then, the status is still `delivered` or `queued`, and you read the answer later with [Get an action](/docs/api-reference/actions), passing the `delivery_id` or `action_id`."
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
  ...ENDPOINTS.map(endpoint),
];
