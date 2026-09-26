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

The screen tools are described below. Each write tool needs the `dopl.write` scope. Read-only calls work without it: `get_answer`, `status`, `capabilities`, `list_templates`, and `render`/`use_template` with `validate_only`.

All text is sanitized before the byte check: curly quotes become straight, en/em dashes become `-`,
and emoji and non-BMP characters are stripped. The G2 fails silently on any of those. An over-limit
field returns a tool error such as `question is 121 bytes; max 120. Shorten it.`

### Agent-built screens (`glasses_capabilities`, `glasses_render`, `glasses_update`, templates)

Code: `src/features/glasses/screen-*.ts`. Layout is measured server-side with
`@evenrealities/pretext`, the G2 firmware's own glyph table, which runs in Node.

- `glasses_capabilities()` returns the screen size, limits, block types, and the box model the
  compiler assumes.
- `glasses_render({screen_id?, blocks, layout?='stack'|'absolute', wait_for_input?, timeout_sec?=120, ttl_sec?=600, validate_only?})`.
  - **Blocks:**
    - `text{content, lines?, brightness? 0-4, border?}`
    - `list{items[], selectable?=true}`, with at most one selectable list per screen
    - `progress{value 0-1, label?}`, which becomes a text line such as `label ██████▒▒▒▒ 62%`
    - `divider{}`, which becomes a line of `─`
    - `spacer{lines?=1}`, which is empty space and creates no container
    - In `absolute` layout, blocks also take `x`, `y` (required) and `w`, `h` (optional).
  - **Invalid specs** get a tool error `{ok:false, errors:[{block, code, message}]}`. Codes are
    `too_many_blocks`, `text_too_long`, `overflow`, `out_of_bounds`, `multiple_selectable`,
    `list_too_long`, `item_too_long` and `bad_value`. Nothing is truncated silently.
  - **Overflow:** a stack that is too tall is an error. The one exception is a list, which scrolls
    on the glasses and so may shrink to 2 visible rows first.
  - **`validate_only:true`** returns `{ok, screen_id, compiled, preview}` and sends nothing. The
    preview is a 64x16 ASCII mock: `[id]` marks each block, `[id*]` marks the block that takes
    input, and `#`/`.`/`-` stand in for the bar and divider glyphs.
  - **Sending:** otherwise a `kind:'screen'` row is stored with `card_id = screen_id`. An id of
    `s-xxxxxxxx` is generated if none is given. Rendering the same `screen_id` again replaces the
    screen in place, clears any earlier tap and re-delivers it.
  - **Waiting for input:** with `wait_for_input`, the call holds for up to 200s and returns
    `{id, screen_id, status:'answered', input:{block_id, choice, index, at}}`.
    - If the wearer doesn't tap in time, it returns `status:'timeout'`. The screen **stays up**;
      its own ttl decides when it expires.
    - If `timeout_sec` is over 200, it returns `status:'pending'`; read the tap later with
      `glasses_get_answer`.
- `glasses_update({screen_id, patches:[{id, content?|items?|value?|label?}]})` merges the patches
  into the stored spec, re-compiles, and re-delivers the screen with status `pending`.
- **Templates:** `glasses_save_template({name, blocks, layout?})`, `glasses_list_templates()`,
  `glasses_use_template({name, data, screen_id?, wait_for_input?, timeout_sec?, ttl_sec?, validate_only?})`.
  - Placeholders `{{var}}` are filled inside strings.
  - A field that is exactly `"{{var}}"` takes the value's own type, so `value:"{{pct}}"` becomes a
    number.
  - A list item that is exactly `"{{var}}"` with an array value is spread into the list.
  - Any missing variable is an error that names it.
  - Names are lowercased, 1-64 characters of `a-z 0-9 _ -`.

**Wire payload for `kind:'screen'`** (inbox):
`{screen_id, spec_version:1, containers:[{block_id, kind:'text'|'list', x, y, w, h, content?, items?, brightness?, border?, capture}]}`.
- Containers are already sanitized, byte-checked and positioned. There are at most 8.
- Exactly one container has `capture:true`: the selectable list, otherwise the last text
  container, otherwise the last container.
- **Box model the compiler assumes (the plugin must render the same way):**
  - `paddingLength: 4` on every container, plus `borderWidth: 2` when `border` is true.
  - 27px per line; a list row is 27px.
  - A text container's height is `lines*27 + 8`, plus `4` with a border.

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
- `Message = {id, kind:'notify'|'show'|'ask'|'screen', card_id, payload, status, answer, created_at, updated_at, expires_at}`.
  - The payload is `{title, body}` for notify, `{title, lines}` for show, or `{question, options}`
    for ask. For screen it is the wire payload described above.
- `POST /answer {id, choice, index, block_id?}` returns `{ok:true}`.
  - **Screens:** a tap on a `kind:'screen'` row is stored as its answer
    `{choice, index, at, block_id}` with status `answered`, whether or not the agent is waiting.
    Later taps overwrite it until the screen expires.
  - `block_id` defaults to the capture container.
  - On a list, a missing or out-of-range `index` is found from `choice`. On text, `choice`
    defaults to `'click'` and `index` to 0.
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
migrations `20261025120000_glasses_messages.sql` and `20261026120000_glasses_screens_templates.sql` are applied there.

## Run

```sh
npm run dev -- -p 3100
```

## Connect Claude Code

### Local connect (header token) — use this

Browser OAuth does not complete against a local server: `/oauth/authorize` sends a signed-out
browser through `/login` → `/authenticate`, and the sign-in ends on the `/get-started` download page
instead of returning to the consent screen (see "Why browser OAuth fails locally"). Connect with a
pre-minted Dopl access token in a header instead:

```sh
claude mcp add --transport http dopl-glasses http://localhost:3100/api/mcp/glasses \
  --header "Authorization: Bearer $(cat <path-to-token-file>)"
```

The token is an ordinary `mcp_tokens` row (`dopl_at_…`, scopes `dopl.read dopl.write`, labelled
`glasses-local-dev`), minted with the same row shape as `shared/auth/mcp-oauth.ts › issueDeviceToken`.
Revoke it by setting `revoked_at` on that row. Writes (`notify`/`show`/`ask`) need `dopl.write`.

### Why browser OAuth fails locally (not fixed)

`src/app/oauth/authorize/page.tsx` redirects a signed-out visitor to
`/login?redirectTo=/oauth/authorize?…` and `/login` 307s to `/authenticate`, which keeps the
target. The OAuth sign-in's return URL comes from `src/features/auth/hooks/use-login.ts ›
authOrigin`, which is `window.location.origin` (`http://localhost:3100`) in dev. Most likely the
Supabase Auth redirect allow-list does not include `http://localhost:3100/auth/callback`, so Supabase
falls back to the project Site URL (production). Production's callback then has no `redirectTo`, and
`shared/lib/url/post-auth-landing.ts › webPostAuthDestination` sends it to
`WEB_POST_AUTH_LANDING` (`/get-started`), the download page. Unverified: this needs a look at the
Supabase dashboard's redirect URLs. Fix options: allow-list the localhost callback, or keep using
header tokens.

## Smoke test

```sh
T=$GLASSES_DEVICE_TOKEN
curl -s "http://localhost:3100/api/glasses/device/inbox?wait=0"                             # 401
curl -s -H "Authorization: Bearer $T" "http://localhost:3100/api/glasses/device/inbox?wait=5"
```
