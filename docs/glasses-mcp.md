# Glasses MCP (prototype, local only)

An agent calls glasses tools on a local Dopl MCP endpoint; the Even G2 plugin long-polls Dopl for
messages, renders them, and posts answers back. Code: `src/features/glasses/`. Nothing here is
deployed.

## Endpoints

### Agent side: `POST /api/mcp/glasses` (MCP, streamable HTTP, stateless)

Auth is the same as `/api/mcp`: a Dopl OAuth access token (`Authorization: Bearer dopl_at_…`). A
missing or bad token gets a 401 with the `WWW-Authenticate` challenge, so MCP clients run the normal
OAuth login.

| Tool | Args | Returns |
|---|---|---|
| `glasses_notify` | `title` (≤64 B), `body` (≤400 B), `ttl_sec?`=60 | `{id, status}` |
| `glasses_show` | `title` (≤64 B), `lines` (1-4, each ≤100 B), `card_id?`, `ttl_sec?`=600 | `{id, card_id, status}`. The same active `card_id` is updated in place and re-delivered. |
| `glasses_ask` | `question` (≤120 B), `options` (2-4, each ≤40 B), `timeout_sec?`=120 | Holds up to 200s. `{id, status:'answered', answer:{choice,index,at}}`, `{id, status:'timeout', answer:null}`, `{id, status:'dismissed', answer:null}`, or `{id, status:'pending'}` when `timeout_sec` > 200 (then call `glasses_get_answer`). |
| `glasses_get_answer` | `id` | `{id, status, answer}` |
| `glasses_status` | none | `{online (polled in the last 60s), last_seen, active_count}` |

All text is sanitized before the byte check: curly quotes become straight, en/em dashes become `-`,
and emoji and non-BMP characters are stripped. The G2 fails silently on any of those. An over-limit
field returns a tool error such as `question is 121 bytes; max 120. Shorten it.`

### Device side: `/api/glasses/device/*` (the plugin contract)

- **Auth:** `Authorization: Bearer $GLASSES_DEVICE_TOKEN`. The token maps to `$GLASSES_DEVICE_USER_ID`.
  Anything else gets a 401.
- **CORS:** `OPTIONS` answers 204. `Access-Control-Allow-Origin` echoes `http://127.0.0.1:5180` or
  `http://localhost:5180`.
- `GET /inbox?after=<ISO>&wait=<0-25, default 25>` returns `{messages: Message[], server_time}`.
  - Each call stamps `last_seen`.
  - Returns rows that are pending or delivered and not expired, with `updated_at > after`, ordered
    by `updated_at` ascending. Returned rows are marked `delivered`.
  - When nothing matches, it polls once a second for up to `wait` seconds, then returns `[]`.
  - **Cursor:** pass the last received message's `updated_at` back as `after`, URL-encoded. An
    unencoded `+00:00` is tolerated. Delivery does not change `updated_at`. A `glasses_show`
    update does change it, so an updated card comes back.
  - Omit `after` on open, or after `FOREGROUND_ENTER`, to get the whole active queue.
- `Message = {id, kind:'notify'|'show'|'ask', card_id, payload, status, answer, created_at, updated_at, expires_at}`.
  - The payload is `{title, body}` for notify, `{title, lines}` for show, or `{question, options}`
    for ask.
- `POST /answer {id, choice, index}` returns `{ok:true}`.
  - It returns 409 if the ask is already answered, dismissed or expired, and 404 if the id is not
    an ask belonging to this user.
  - The stored `choice` is `options[index]`. If `index` is missing or out of range, the server
    finds it by looking up `choice`.
- `POST /dismiss {id}` returns `{ok:true}`. It returns 404 if the id is unknown.

## Env vars (`.env.local`)

The repo's `.gitignore` ignores `.env*`, so no `.env.example` is committed. Set these by hand:

```
GLASSES_DEVICE_TOKEN=<random hex, e.g. openssl rand -hex 32>
GLASSES_DEVICE_USER_ID=<the Dopl auth.users id the device acts as>
```

Everything else comes from the normal Dopl `.env.local`. It points at the project's Supabase, and
migration `20261025120000_glasses_messages.sql` is applied there.

## Run

```sh
npm run dev -- -p 3100
```

## Connect Claude Code

```sh
claude mcp add --transport http dopl-glasses http://localhost:3100/api/mcp/glasses
```

Then run `/mcp` → `dopl-glasses` → Authenticate. A browser opens the local Dopl OAuth consent page,
where you sign in at `localhost:3100` if asked. To skip OAuth with a Dopl access token you already
have:

```sh
claude mcp add --transport http dopl-glasses http://localhost:3100/api/mcp/glasses \
  --header "Authorization: Bearer dopl_at_..."
```

## Smoke test

```sh
T=$GLASSES_DEVICE_TOKEN
curl -s "http://localhost:3100/api/glasses/device/inbox?wait=0"                             # 401
curl -s -H "Authorization: Bearer $T" "http://localhost:3100/api/glasses/device/inbox?wait=5"
```
