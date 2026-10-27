import type { DocPage, DocParam, HttpMethod } from "./types";

/**
 * The API Reference tab. ⚠ The `/v1` REST surface is PLANNED (frozen contract
 * `docs/specs/device-sdk/openapi.yaml`, not built): every page here is `coming_soon`, its
 * copy says so, and paths, fields and status codes match that file exactly. The only live
 * interface is the hosted MCP server.
 */

/** The planned host (`openapi.yaml › servers`). Not live yet. */
const API = "https://api.usedopl.com/v1";

const PLANNED: { type: "quote"; text: string } = {
  type: "quote",
  text: "Planned. This endpoint is part of the Device SDK contract and is not live yet. Today, agents reach devices through the [hosted MCP server](/docs/api-reference#hosted-mcp).",
};

const AUTH: DocParam = {
  name: "Authorization",
  type: "string",
  location: "header",
  required: true,
  description:
    "A project secret key (`sk_test_…` or `sk_live_…`) sent as `Authorization: Bearer <key>`. Server to server only.",
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

const ERROR_404 =
  '{\n  "error": {\n    "type": "invalid_request_error",\n    "code": "not_found",\n    "message": "No such user.",\n    "retryable": false,\n    "doc_url": "…"\n  }\n}';

function curl(method: HttpMethod, path: string, body?: string): string {
  const lines = [
    `curl --request ${method} \\`,
    `  --url ${API}${path} \\`,
    `  --header 'Authorization: Bearer sk_test_…'${body ? " \\" : ""}`,
  ];
  if (body) lines.push(`  --header 'Content-Type: application/json' \\`, `  --data '${body}'`);
  return lines.join("\n");
}

interface EndpointSpec {
  slug: string;
  group: "Actions" | "Connect";
  title: string;
  description: string;
  method: HttpMethod;
  path: string;
  examplePath: string;
  pathParams: DocParam[];
  headers?: DocParam[];
  body?: DocParam[];
  requestBody?: string;
  status: string;
  response: string;
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
      { type: "params", title: "Authorizations", params: [AUTH, ...(e.headers ?? [])] },
      ...(e.pathParams.length > 0 ? [{ type: "params" as const, title: "Path parameters", params: e.pathParams }] : []),
      ...(e.body && e.body.length > 0 ? [{ type: "params" as const, title: "Body", params: e.body }] : []),
    ],
    aside: {
      title: e.title,
      request: [{ label: "cURL", code: curl(e.method, e.examplePath, e.requestBody) }],
      responses: [
        { label: e.status, code: e.response },
        { label: "404", code: ERROR_404 },
      ],
    },
  };
}

export const API_PAGES: DocPage[] = [
  {
    slug: "api-reference",
    tab: "api",
    group: "Overview",
    title: "About the Dopl API",
    description: "The hosted MCP server that is live today, and the planned Device SDK API",
    status: "coming_soon",
    blocks: [
      {
        type: "p",
        text: "Agents reach Dopl today through the hosted MCP server. The Device SDK adds a REST API, typed SDKs and an embeddable Connect widget on top of the same platform; those interfaces are in development and the reference pages in this tab describe their planned contract.",
      },
      { type: "h2", text: "Interfaces" },
      { type: "h3", text: "Hosted MCP" },
      {
        type: "p",
        text: "**Live.** Connect any MCP host to `https://www.usedopl.com/api/mcp` and sign in with OAuth. Once a user has paired Even Realities G2 glasses, the server adds the glasses tools (`glasses_show`, `glasses_ask`, `glasses_notify` and the screen tools) to that user's connection.",
      },
      { type: "h3", text: "REST" },
      {
        type: "p",
        text: `**Planned.** JSON over HTTPS at \`${API}\`, authenticated with project secret keys. An agent delivers by intent with [Deliver](/docs/api-reference/deliver) and Dopl routes it to a device, or it calls one capability on one device with [Run a device action](/docs/api-reference/device-actions).`,
      },
      { type: "h3", text: "SDKs" },
      {
        type: "p",
        text: "**Planned.** A TypeScript SDK first, then Python. Each wraps the REST API and adds `show`, `ask` and `notify` as helper methods that call Deliver with the matching intent.",
      },
      { type: "h3", text: "Connect widget" },
      {
        type: "p",
        text: "**Planned.** A white-label flow your users open from your product to pair a device and approve the scopes your agent requests. It starts from a [Connect session](/docs/api-reference/connect-sessions).",
      },
    ],
  },
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
    response:
      '{\n  "delivery_id": "dlv_8f2c",\n  "routed_to": {\n    "device_id": "dev_g2_01",\n    "kind": "glasses",\n    "reason": "last message came from this device"\n  },\n  "status": "delivered"\n}',
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
          "A capability ID such as `present.display`, `present.notify` or `ask.choice`. `ask.*` actions hold for up to 200 seconds.",
      },
    ],
    headers: [IDEMPOTENCY],
    body: [
      { name: "args", type: "object", required: true, description: "The capability's arguments." },
      { name: "idempotency_key", type: "string", required: true, description: "Up to 255 characters." },
    ],
    requestBody: '{"args":{"text":"Build finished"},"idempotency_key":"req_02"}',
    status: "202",
    response: '{\n  "action_id": "act_41ab",\n  "status": "queued"\n}',
  }),
  endpoint({
    slug: "actions",
    group: "Actions",
    title: "Get an action",
    description: "Read an action's status and result",
    method: "GET",
    path: "/actions/{id}",
    examplePath: "/actions/act_41ab",
    pathParams: [
      { name: "id", type: "string", location: "path", required: true, description: "The `action_id` to read." },
    ],
    status: "200",
    response:
      '{\n  "action_id": "act_41ab",\n  "device_id": "dev_g2_01",\n  "capability": "ask.choice",\n  "status": "done",\n  "result": { "choice": "Yes" },\n  "error": null,\n  "created_at": "2026-10-27T17:02:11Z",\n  "updated_at": "2026-10-27T17:02:19Z"\n}',
  }),
  endpoint({
    slug: "connect-sessions",
    group: "Connect",
    title: "Create a Connect session",
    description: "Start the flow your user follows to pair a device and approve scopes",
    method: "POST",
    path: "/connect_sessions",
    examplePath: "/connect_sessions",
    pathParams: [],
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
    response:
      '{\n  "connect_token": "ct_9d1e",\n  "url": "https://…",\n  "expires_at": "2026-10-27T17:32:11Z"\n}',
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
    response: JSON.stringify(
      {
        data: [
          {
            id: "con_7a20",
            external_user_id: "usr_123",
            status: "active",
            device: {
              id: "dev_g2_01",
              kind: "glasses",
              vendor: "even_realities",
              model: "g2",
              firmware: null,
              adapter_id: "even_g2",
              adapter_version: "0.3",
              capabilities: [],
              online: true,
              last_seen_at: "2026-10-27T17:02:19Z",
            },
            grants: [{ scope: "present.*", granted_at: "2026-10-27T17:01:02Z", expires_at: null }],
            created_at: "2026-10-27T17:01:02Z",
            revoked_at: null,
          },
        ],
      },
      null,
      2
    ),
  }),
];

export const CHANGELOG_PAGES: DocPage[] = [
  {
    slug: "changelog",
    tab: "changelog",
    group: "Product updates",
    title: "Changelog",
    description: "",
    status: "live",
    blocks: [
      {
        type: "changelog",
        entries: [
          {
            date: "October 27",
            title: "Status labels",
            description:
              "Every page now says whether it is live, in beta or coming soon. The API reference describes the planned Device SDK contract",
          },
          {
            date: "October 20",
            title: "Developer docs",
            description: "Start here, use cases, devices and the API reference",
          },
        ],
      },
    ],
  },
];
