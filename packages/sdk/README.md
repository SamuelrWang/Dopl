# @dopl/sdk

The TypeScript client for the Dopl Device SDK API, plus a project MCP server with three tools.
Every method maps to one operation in `docs/specs/device-sdk/openapi.yaml`, and the request and
response types come from `@dopl/contracts/device-sdk`.

## Install

The package is private for now and is not on npm. Inside this repo it is a workspace package, so
`npm install` at the root links it. Build it once to get the `dist/` output and the MCP bin:

```sh
npm run build -w @dopl/sdk
```

## Quickstart with the simulator

Use a test secret key (`sk_test_`). Test keys only touch test data, and in test mode the Connect
flow offers simulated devices of every kind, so you need no hardware.

```ts
import { Dopl } from "@dopl/sdk";

const dopl = new Dopl({ apiKey: process.env.DOPL_SECRET_KEY! });

// 1. Connect a simulated device for one of your users.
const session = await dopl.connectSessions.create({
  external_user_id: "usr_123",
  requested_scopes: ["present.*", "ask.*"],
});
console.log(session.url); // open it and pick a simulated device

// 2. Read where the user is.
const context = await dopl.users.context("usr_123");

// 3. Deliver by intent. Dopl picks the device and says why.
const delivery = await dopl.users.deliver("usr_123", {
  intent: "message",
  content: { text: "Your build finished in 4m 12s" },
  target: "auto",
});
console.log(delivery.routed_to); // { device_id, kind, reason }

// 4. The helpers: show, notify and ask all call deliver with the matching intent.
await dopl.show("usr_123", { blocks: [{ id: "h", type: "heading", text: "Deploy ready" }] });
await dopl.notify("usr_123", { text: "Build done", urgency: "high" });

const answer = await dopl.ask("usr_123", { question: "Ship it?", options: ["Yes", "No"] });
if (answer.status === "answered") console.log(answer.answer);
```

`ask` delivers the question, then polls `actions.get` until the action is done, fails, or the
timeout passes (200 seconds by default, `timeoutMs` to change it). A timeout resolves with
`status: "timeout"`; a failed action throws.

The simulator also has device ids that force a failure, such as `sim_device_offline` and
`sim_confirm_denied`, so you can test your error handling.

## Methods

| Method | Route |
|---|---|
| `connectSessions.create(body)` | `POST /connect_sessions` |
| `connections.exchange({ public_token })` | `POST /connections/exchange` |
| `connections.list(externalUserId)` | `GET /users/{external_user_id}/connections` |
| `connections.revoke(connectionId)` | `DELETE /connections/{id}` |
| `users.context(externalUserId)` | `GET /users/{external_user_id}/context` |
| `users.deliver(externalUserId, body)` | `POST /users/{external_user_id}/deliver` |
| `devices.get(deviceId)` | `GET /devices/{id}` |
| `devices.action(deviceId, capability, args)` | `POST /devices/{device_id}/actions/{capability}` |
| `actions.get(actionId)` | `GET /actions/{id}` |
| `show`, `notify`, `ask` | helpers over `users.deliver` |

## Options

`new Dopl({ apiKey, baseUrl?, fetch?, headers? })`. The base URL defaults to
`https://www.usedopl.com/api/v1`; point it at `http://localhost:3000/api/v1` for local work.

Every POST takes `{ idempotencyKey }`. It is sent as the `Idempotency-Key` header and, where the
body carries `idempotency_key`, fills that too. When you pass none, the SDK makes a fresh one per
call. Pass your own to make retries safe: a retry with the same key returns the first result
instead of delivering twice.

## Errors

Every failure throws a `DoplError` with the C10 fields: `code`, `type`, `message`, `retryable`,
`docUrl`, `deviceKind`, plus the HTTP `status` and the server's `requestId`. When no C10 body
came back, `code` is one the SDK sets itself: `network_error`, `unexpected_response` or
`publishable_key_not_allowed`.

## Keys

Secret keys (`sk_test_`, `sk_live_`) belong on your server. A publishable key (`pk_`) can only
create Connect sessions; the SDK refuses every other call with a `pk_` key before any request is
sent. The SDK never logs your key and does not keep it as a property on the client.

## Project MCP server

A small stdio MCP server for agents that act for your product. It uses a secret key from
`DOPL_API_KEY` (and an optional `DOPL_BASE_URL`) and exposes three tools, which keeps the context
cost of connecting it low:

| Tool | What it does |
|---|---|
| `deliver` | Deliver content to a user's device by intent; the result also carries the user's context |
| `context` | Read a user's active device, posture, available devices and profile |
| `actions` | Read an action by `action_id`, or run one with `device_id`, `capability` and `args` |

```json
{
  "mcpServers": {
    "dopl": {
      "command": "node",
      "args": ["packages/sdk/dist/mcp/bin.js"],
      "env": { "DOPL_API_KEY": "sk_test_..." }
    }
  }
}
```

To embed it in your own process, use `createProjectMcpServer(new Dopl({ apiKey }))` from
`@dopl/sdk/mcp`. The hosted MCP server for individual Dopl users is a different server and is
unchanged.

## Tests

```sh
npm test -w @dopl/sdk
```

The suite uses a mocked fetch. `openapi-drift.test.ts` reads the spec and fails if it gains an
operation the client does not cover.
