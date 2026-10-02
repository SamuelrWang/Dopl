# @dopl/client

Typed HTTP client for the Dopl API. Internal workspace package (`private`, not
published to npm). Consumed by [`@dopl/mcp-server`](../mcp-server) and by the
Next.js app's loopback calls (e.g. `src/shared/api/loopback-client.ts`).

## What's inside

- **`DoplClient`** — one class whose methods are split across `src/client-<domain>.ts`
  (workspaces, knowledge, ontology, chats, members, channels, skills, agent
  identities, home, billing); the chain order is written in `src/client-base.ts`.
- **`DoplTransport`** (`src/transport.ts`) — retries with jittered exponential
  backoff (`src/retry.ts`, honours `Retry-After`), structured error parsing, and
  the `dopl:client` debug namespace.
- **Typed errors** (`src/errors.ts`) — `DoplApiError` (parsed `code` / `apiMessage` /
  `details` from the `{ error: { code, message, details } }` body), `DoplAuthError`,
  `DoplNetworkError`, `DoplTimeoutError`, `DoplAbortError`.

## Usage

```ts
import { DoplClient } from "@dopl/client";

// The second argument is a bearer token (sent as `Authorization: Bearer …`);
// in practice an OAuth or loopback token, never a user API key.
const client = new DoplClient(baseUrl, token, { clientIdentifier: "my-app@1.0.0" });

const { workspaces } = await client.listWorkspaces();
```

`clientIdentifier` is sent as `X-Dopl-Client` on every request.

## Build

The app loads the committed `dist/` (`next.config.ts › serverExternalPackages`),
so after editing `src/` run `npm run build:packages` at the repo root and commit
`dist/` — CI fails if it is not the build of `src/` (CLAUDE.md, gate 9).

```sh
npm run build -w @dopl/client
npm test -w @dopl/client
```

## Debug

```sh
DEBUG=dopl:client node my-script.js
```

Logs each request as `METHOD /path → status in Nms`. The Authorization header is
never logged.

See [CHANGELOG.md](./CHANGELOG.md) for history. MIT License.
