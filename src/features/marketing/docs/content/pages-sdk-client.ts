import { json, PLANNED } from "./shared";
import type { DocBlock } from "./types";

/**
 * The bodies of the TypeScript SDK and Project MCP pages (their `DocPage` entries are in
 * `pages-sdks.ts`). ⚠ They restate `packages/sdk` as built: method names from `client.ts ›
 * ROUTES` plus the `show` / `notify` / `ask` helpers, and the three tools of `mcp/server.ts ›
 * PROJECT_MCP_TOOLS`; `content.test.ts` holds both lists to those files. `@dopl/sdk` is PRIVATE
 * (not on npm) until Samuel says publish, so no page may tell a reader to install it from npm.
 */

/** [method, route] in `client.ts › ROUTES` order, then the helpers. */
export const SDK_METHOD_ROWS: [method: string, route: string][] = [
  ["connectSessions.create(body)", "`POST /connect_sessions`"],
  ["connections.exchange({ public_token })", "`POST /connections/exchange`"],
  ["connections.list(externalUserId)", "`GET /users/{external_user_id}/connections`"],
  ["connections.revoke(connectionId)", "`DELETE /connections/{id}`"],
  ["users.context(externalUserId)", "`GET /users/{external_user_id}/context`"],
  ["users.deliver(externalUserId, body)", "`POST /users/{external_user_id}/deliver`"],
  ["devices.action(deviceId, capability, args)", "`POST /devices/{device_id}/actions/{capability}`"],
  ["devices.get(deviceId)", "`GET /devices/{id}`"],
  ["actions.get(actionId)", "`GET /actions/{id}`"],
  ["events.list({ cursor, limit, ...filters })", "`GET /events`"],
  ["show(externalUserId, { text, blocks })", "Deliver with the `display` intent"],
  ["notify(externalUserId, { text })", "Deliver with the `notify` intent"],
  ["ask(externalUserId, { question, options })", "Deliver with the `ask` intent, then poll the action for the answer"],
];

/** [tool, inputs, what it does] — `mcp/server.ts`. */
export const MCP_TOOL_ROWS: [tool: string, inputs: string, what: string][] = [
  [
    "deliver",
    "`external_user_id`, `intent`, `text`, `blocks`, `options`, `urgency`, `target`, `idempotency_key`",
    "Deliver by intent, routed by Dopl, like [Deliver](/docs/api-reference/deliver). The result carries the delivery and the user's context",
  ],
  ["context", "`external_user_id`", "Read a user's active device, posture, available devices and profile, like [Get context](/docs/api-reference/context)"],
  [
    "actions",
    "`action_id`, or `device_id`, `capability`, `args` and `idempotency_key`",
    "Read an action by ID, or run one capability on one device like [Run a device action](/docs/api-reference/device-actions)",
  ],
];

const p = (text: string): DocBlock => ({ type: "p", text });
const ts = (code: string[]): DocBlock => ({ type: "code", tabs: [{ label: "TypeScript", code: code.join("\n") }] });

export const TYPESCRIPT_SDK: DocBlock[] = [
  PLANNED,
  p(
    "`@dopl/sdk` is a typed client for every route in the [API reference](/docs/api-reference), with request and response types taken from the same contract. It runs on Node 18.17 or later and anywhere with a global `fetch`."
  ),
  { type: "h2", text: "Access" },
  p(
    "The package is private while the Device SDK is in testing and is not on npm. It is available to design partners on request from [sales@usedopl.com](mailto:sales@usedopl.com), and the [Quickstart](/docs/quickstart) walks through it end to end."
  ),
  { type: "h2", text: "Create a client" },
  ts([
    `import { Dopl } from "@dopl/sdk";`,
    ``,
    `const dopl = new Dopl({ apiKey: process.env.DOPL_SECRET_KEY! });`,
  ]),
  p(
    "`new Dopl({ apiKey, baseUrl, fetch, headers })` takes a secret key, or a publishable `pk_` key that can only call `connectSessions.create`; the client refuses every other call with a `pk_` key before sending anything. The key is never logged or kept as a property on the client."
  ),
  { type: "h2", text: "Methods" },
  {
    type: "table",
    columns: ["Method", "Route"],
    rows: SDK_METHOD_ROWS.map(([method, route]) => [`\`${method}\``, route]),
  },
  p(
    "`show`, `notify` and `ask` are methods, not routes, so the API keeps one way to deliver. Each takes the Deliver options too: `urgency`, `target`, `profile` and `idempotencyKey`."
  ),
  { type: "h2", text: "Asking" },
  ts([
    `const answer = await dopl.ask("usr_123", { question: "Ship it?", options: ["Yes", "No"], timeoutMs: 60_000 });`,
    ``,
    `if (answer.status === "answered") console.log(answer.answer);`,
  ]),
  p(
    "`ask` delivers the question, then polls `actions.get` with the `delivery_id` every second until the action is done or fails, or until `timeoutMs` passes, 200 seconds by default. An answer resolves with `status: \"answered\"`, a timeout resolves with `status: \"timeout\"`, and a failed action throws."
  ),
  { type: "h2", text: "Idempotency" },
  p(
    "Every POST takes `{ idempotencyKey }`, which the SDK sends as the `Idempotency-Key` header and in the body. When you pass none it creates a fresh key per call, so pass your own to make a retry safe: the same key returns the first result instead of acting twice."
  ),
  { type: "h2", text: "Errors" },
  p(
    "Every failure throws a `DoplError` with the fields of the [error shape](/docs/api-reference/errors) (`code`, `type`, `message`, `retryable`, `docUrl`, `deviceKind`) plus the HTTP `status` and the `requestId` from the `Request-Id` header. When no error body came back, `code` is one the SDK sets itself: `network_error`, `unexpected_response` or `publishable_key_not_allowed`."
  ),
  ts([
    `import { DoplError } from "@dopl/sdk";`,
    ``,
    `try {`,
    `  await dopl.notify("usr_123", { text: "Build done" });`,
    `} catch (err) {`,
    `  if (err instanceof DoplError && err.retryable) {`,
    `    // retry later with the same idempotencyKey`,
    `  }`,
    `}`,
  ]),
  p("A Python SDK is planned after TypeScript."),
];

export const PROJECT_MCP: DocBlock[] = [
  PLANNED,
  p(
    "The project MCP server ships with `@dopl/sdk` and runs over stdio with one project secret key, so an agent connected to it acts for your product and your end users rather than for one Dopl account."
  ),
  { type: "h2", text: "Tools" },
  {
    type: "table",
    columns: ["Tool", "Inputs", "What it does"],
    rows: MCP_TOOL_ROWS.map(([tool, inputs, what]) => [`\`${tool}\``, inputs, what]),
  },
  p(
    "Three tools instead of one per device or capability keep the tool definitions small, so connecting Dopl costs your agent very little context. Because `deliver` returns the user's context with every result, the agent always knows which device it just wrote for. A failed call returns the [error shape](/docs/api-reference/errors) as a tool error."
  ),
  { type: "h2", text: "Run it" },
  p(
    "Set `DOPL_API_KEY` to a secret key, and optionally `DOPL_BASE_URL`. The `dopl-sdk-mcp` command refuses to start without a key or with a publishable one. In a project where `@dopl/sdk` is installed, add it to your MCP host:"
  ),
  {
    type: "code",
    tabs: [
      {
        label: "mcp.json",
        code: json({
          mcpServers: {
            dopl: { command: "npx", args: ["dopl-sdk-mcp"], env: { DOPL_API_KEY: "sk_test_…" } },
          },
        }),
      },
    ],
  },
  p("To run it inside your own process instead, pass a client to `createProjectMcpServer`:"),
  ts([
    `import { Dopl } from "@dopl/sdk";`,
    `import { createProjectMcpServer } from "@dopl/sdk/mcp";`,
    ``,
    `const server = createProjectMcpServer(new Dopl({ apiKey: process.env.DOPL_API_KEY! }));`,
  ]),
  p("The [hosted MCP server](/docs/sdks/hosted-mcp) for individual Dopl users is a separate server and stays as it is."),
];
