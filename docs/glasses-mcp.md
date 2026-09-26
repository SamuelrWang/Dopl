# Glasses MCP

Agents send messages, questions and custom screens to a user's Even G2 glasses through Dopl's MCP.
The glasses plugin long-polls Dopl, renders what arrives and posts taps back. Voice from the
glasses goes into a Dopl channel as the user, and the channel's agent replies come back to the
lens. Code: `src/features/glasses/`.

## Production model (2026-09-26)

### Pairing and devices

Each pair of glasses is a row in `glasses_device_links` (`20261028120000_glasses_device_links_pairings.sql`).
- **Credentials are hashes only.** A device token (`glsdt_…`) and a Hey Even key (`glshe_…`) are
  stored as SHA-256 hex and returned in plaintext exactly once.
- **Pairing flow:**
  1. The glasses call `POST /api/glasses/device/pair/start` (no auth, 10 per minute per IP).
     They get `{pair_id, code, poll_secret, expires_at}`: a 6-character code from `A-Z2-9`
     without `I`/`O`, valid for 10 minutes.
  2. The user enters the code in Dopl, which calls `POST /api/glasses/pair/claim`.
  3. The glasses poll `GET /api/glasses/device/pair/status?pair_id=…`.
     - Send the poll secret as `Authorization: Bearer <poll_secret>`. `&poll_secret=` also works,
       but a query string lands in access logs.
     - The answer is `{status:'pending'}`, `{status:'expired'}`, or
       `{status:'claimed', device_id, device_token}`.
- **No token is stored at claim time.** The first poll after the claim mints the token, stores its
  hash and returns it. Every later poll answers `{status:'claimed', device_id}` with no token. A
  lost response means pairing again.
- **Revoking** clears both credential hashes, so a revoked device returns 401 everywhere.
- **Online** means the device made an authenticated request in the last 60s (`last_seen`).
- **One queue per user.** Messages stay per user: every active device of the user receives
  everything queued for them.

### User API (Dopl session or `dopl_at_` token, via `withUserAuth`)

| Route | Body | Returns |
|---|---|---|
| `POST /api/glasses/pair/claim` | `{code, name?, channel_id?}` | 201 `{device}`. Limited to 10 per minute per user. |
| `GET /api/glasses/devices` | none | `{devices:[{id, name, platform, created_at, last_seen, online, linked_channel:{id,name}\|null, has_hey_even_key}]}` |
| `PATCH /api/glasses/devices/:id` | `{name?, channel_id? (uuid or null)}` | `{device}`. Changing the channel restarts the reply mirror at that channel's head. |
| `DELETE /api/glasses/devices/:id` | none | `{ok:true}` (revoke) |
| `POST /api/glasses/devices/:id/hey-even-key` | none | `{key, url}`, returned once. Rotating replaces the old key. |

- **Channel rule:** a device can be linked only to a live channel its owner is a member of. The
  claim and PATCH both check this and return 404 `CHANNEL_NOT_FOUND` otherwise. Posting re-checks
  membership.
- **The Hey Even `url`** uses the origin the request arrived on, so it points where the key works.

### MCP exposure and metering

- **Where the tools appear:** the tools have one implementation (`tools.ts ›
  registerGlassesTools`).
  - `/api/mcp/glasses` always lists them.
  - The main `/api/mcp` adds all 11 glasses tools **only when the caller has at least one paired
    device** (`mcp-exposure.ts › maybeRegisterGlassesTools`). The check is cached per process for
    30s.
- **Metering:** each call costs one credit through `consumeMcpCredits`, charged to the caller's
  home container, with rule B's channel hint taken from `X-Dopl-Session-Id`. It fails open on an
  error, like the registrar.

### Security

- **Bearer-only device routes.** The device and Hey Even routes authenticate only by bearer
  credentials looked up by hash. They are in `SELF_AUTH_ROUTES`, so a browser preflight is not
  session-gated.
- **CORS is defense in depth:** `GLASSES_PLUGIN_ORIGINS` is a comma-separated list of exact
  origins, or `*`. When unset it allows `http://127.0.0.1:5180` and `http://localhost:5180`.
- **No credential values in logs:** the Hey Even header log redacts `authorization`, `cookie` and
  any `*token*`/`*api-key*` header.

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

- **Auth:** `Authorization: Bearer <device token>` from pairing. A missing, unknown or revoked
  token gets 401.
- **CORS:** `OPTIONS` answers 204. `Access-Control-Allow-Origin` echoes an origin from
  `GLASSES_PLUGIN_ORIGINS` (see Security).
- `GET /inbox?after=<ISO>&wait=<0-25, default 25>` returns `{messages: Message[], server_time}`.
  - Every authenticated device call stamps that device's `last_seen`.
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

## Voice: glasses to Dopl channel to agent, replies back to the glasses

What the wearer says is posted into the **device's linked channel** as the device owner's own
message. An unlinked device gets 409.
- **Handler:** `voice-utterance.ts › handleGlassesUtterance`, using the channels service's
  `postMessage`. That is the same write the app and `dopl_send_message` use, so the server stores
  the normal wake verdict.
- **Addressing:** if exactly one agent session is live, the post is addressed `to: @agent-<id>`.
  Otherwise it is unaddressed, and the server's rule for an unaddressed person-authored post
  (RR3) wakes the room's agent.
- **Waking:** the owner's installed Dopl desktop wakes the agent off that stored row.
- **Short reply hold, capped:** the handler waits for the agent's first reply for up to
  `GLASSES_REPLY_HOLD_MS` (default 6000, capped at 6000).
  - The clock starts before the post, so posting plus waiting stays under the roughly 10s an
    Even client waits.
  - It returns `replied` with `reply`, `reply_message_id` and `agent` if a reply arrives in time.
  - Otherwise it returns `sent`, or `offline` (immediately) when no agent session was live and
    the post woke nobody.
  - A slower reply still reaches the glasses through the reply mirror below.
- **Duplicates:** the mirror also queues a reply that was returned inline, as card
  `reply-<reply_message_id>`. The plugin should skip that card if it already showed the reply.

**Reply mirror** (`reply-mirror.ts`):
- Each device inbox long-poll also reads agent `message` rows in the linked channel past a
  per-device cursor (`glasses_device_links.reply_cursor_seq`). A fresh cursor starts at the
  channel's head.
- Each reply becomes a glasses message with `card_id = reply-<channel message id>`. The partial
  unique index `glasses_messages_reply_card_uidx` stops duplicates.
- Every reply becomes a `show {title: agent display name, lines}` card, never a `notify`. A notify
  is auto-dismissed after a few seconds; a show card stays until the wearer taps it or it
  expires.
- The lines are wrapped to the G2 width: up to 4 lines, each at most 100 bytes, with the last
  line ending in `…` when cut. Markdown is flattened first.
- Replies expire after 600s.

**Endpoints** (CORS as above):
- `POST /api/glasses/device/voice` (device token)
  - The body is raw PCM (signed 16-bit little-endian, 16 kHz, mono) with
    `Content-Type: application/octet-stream`, up to about 60s. Larger bodies get a 413.
  - It is wrapped as a WAV and transcribed by the first STT key present: `OPENAI_API_KEY` (model
    `gpt-4o-mini-transcribe`), otherwise `GROQ_API_KEY` (`whisper-large-v3`).
  - It returns `{transcript, status:'replied'|'sent'|'offline'|'empty', channel_message_id, addressed_to, addressed_name, reply?, reply_message_id?, agent?}`.
    It uses the same capped hold; transcription time is counted separately.
  - Audio shorter than 300ms or with RMS below 150 is `empty`, and STT is not called.
- `POST /api/glasses/hey-even/v1/chat/completions` (also `POST /api/glasses/hey-even`)
  - Auth is `Authorization: Bearer <Hey Even key>`, the device's rotated key (the device token
    does not work here).
  - OpenAI chat-completions shape. It takes the last `user` message.
  - The answer is the agent's reply if it lands inside the hold. Otherwise it is
    `Sent to <agent display name>. Reply coming to your glasses.`, falling back to `@agent-<id>`,
    then to "your Dopl channel", when there is no display name.
  - `stream:true` returns one SSE chunk, a finish chunk, then `[DONE]`.
  - Every request's headers are logged with credentials redacted (`[glasses] hey-even request …`).
- `GET /api/glasses/hey-even/v1/models` (Hey Even key) returns `dopl-glasses`.

## Env vars

No per-user data lives in env; devices, links and keys are rows. Server-wide settings:

```
OPENAI_API_KEY=<speech-to-text; otherwise GROQ_API_KEY>
GLASSES_PLUGIN_ORIGINS=<optional; comma-separated plugin WebView origins, or *>
GLASSES_REPLY_HOLD_MS=<optional; default 6000, max 6000>
```

Migrations applied to the project (matched by NAME):
- `20261025120000_glasses_messages`
- `20261026120000_glasses_screens_templates`
- `20261027120000_glasses_voice_reply_mirror`
- `20261028120000_glasses_device_links_pairings`

The prototype's `glasses_devices` table is no longer read.

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

## Local dev: pair through the real flow

`scripts/glasses-dev-seed.mjs` takes a file holding a Dopl user credential (a `dopl_at_…` token or
a Supabase access JWT) for the account that will own the device. Secrets go only to files (mode
600).

```sh
# Claim the code the plugin/simulator is showing:
node scripts/glasses-dev-seed.mjs --user-token-file <file> --code ABC234 --channel <channel uuid>

# Or pair a headless device end to end, saving its token (and optionally a Hey Even key):
node scripts/glasses-dev-seed.mjs --user-token-file <file> --out <token file> --channel <uuid> --hey-even <key file>
```

`--base` defaults to `http://127.0.0.1:3100`.
