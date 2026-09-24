# @dopl/client

Shared HTTP client for the Dopl API. Consumed by [`@dopl/cli`](../cli) and [`@dopl/mcp-server`](../mcp-server) — extracted into its own package so behavior never drifts between the two channels.

Most users want one of those packages, not this one directly.

## What's inside

- **`DoplClient`** — typed HTTP client with methods across workspaces, knowledge bases, skills, the ontology, channels and agent identities.
- **`DoplTransport`** — internal transport with retries (jittered exponential backoff for idempotent methods, `Retry-After` honored on 429), structured error parsing, and a `debug` namespace.
- **Typed errors** — `DoplApiError` (with parsed `code` / `apiMessage` / `details` from the canonical `{ error: { code, message, details } }` body shape), `DoplAuthError`, `DoplNetworkError`, `DoplTimeoutError`.

## Usage (advanced)

```ts
import { DoplClient } from "@dopl/client";

const client = new DoplClient("https://www.usedopl.com", process.env.DOPL_API_KEY!, {
  clientIdentifier: "my-app@1.0.0",
});

const { packs } = await client.listPacks();
```

The `clientIdentifier` is sent as `X-Dopl-Client` on every request and used for server-side adoption analytics.

## Debug

```sh
DEBUG=dopl:client node my-script.js
```

Logs each request as `METHOD /path → status in Nms`. The Authorization header is never logged.

## Related

- [`@dopl/cli`](../cli) — `dopl` shell binary built on this client.
- [`@dopl/mcp-server`](../mcp-server) — MCP server built on this client.
- [CHANGELOG.md](./CHANGELOG.md) — release history.

MIT License.
