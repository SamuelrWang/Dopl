# Glasses MCP

Agents send messages, questions and custom screens to a user's Even G2 glasses through Dopl's MCP.
The glasses plugin long-polls Dopl, renders what arrives and posts taps back. Voice from the
glasses goes into a Dopl channel as the user, and the channel's agent replies come back to the
lens. Code: `src/features/glasses/` (layout below).

## Code layout (2026-09-28)

- `core/`: platform-neutral. `devices/` (pairing, credentials, channel access, the User API), `messages/`
  (the queue, inbox long-poll, answer/dismiss, reply mirror), `screens/` (the block vocabulary,
  validation, templates, render/update), `mcp/` (the one tool registration and its two
  exposures), `voice/` (push-to-talk, STT, target routing, the channel gateway), `menu/` (menu +
  read mode, live activity). `glasses-runtime.ts` wires the real stores; route files import only it.
- `platforms/`: one `GlassesPlatform` per device platform (`platforms/types.ts ›
  GlassesPlatform`: capabilities, screen limits, `compileScreen`, `compileChatDisplay`, `previewScreen`,
  `sanitizeText`, `wrapCardLines`). Core reaches an implementation only through
  `platforms/registry.ts › glassesPlatform`, keyed by `glasses_device_links.platform`; user-scoped
  work (MCP cards and screens, queued for every device of the user) uses `DEFAULT_PLATFORM`.
  `platforms/info.ts › platformInfo` holds the client-safe facts (label, assistant setup copy) the
  settings UI reads.
- `platforms/even-g2/`: everything G2-specific: the 576x288 display and container box model
  (`display.ts`), the compiler and ASCII preview, `@evenrealities/pretext` metrics, the G2 glyph
  sanitizer and card wrapping (`text.ts`), and the Hey Even OpenAI-compatible shim and key
  rotation (`hey-even.ts`).
- A new platform adds a folder under `platforms/`, one registry entry and one `info.ts` entry;
  the device API paths and JSON shapes stay the same.

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
  3. The glasses poll `GET /api/glasses/device/pair/status?pair_id=…` with
     `Authorization: Bearer <poll_secret>`.
     - The secret is accepted **only** in that header. A query string lands in access logs.
     - The answer is `{status:'pending'}`, `{status:'expired'}`, or
       `{status:'claimed', device_id, device_token}`.
- **No token is stored at claim time.** The first poll after the claim mints the token, stores its
  hash and returns it. Every later poll answers a bare `{status:'claimed'}`, which is the device's
  cue to pair again.
- **Unclaimed devices are hidden.** A device whose token was never collected is not listed or
  counted.
- **Pairing housekeeping:**
  - A code collision frees an expired holder and redraws.
  - Pairings are deleted 24h after they expire.
- **Revoking** clears both credential hashes, so a revoked device returns 401 everywhere.
- **The device can unpair itself** with `POST /api/glasses/device/unpair` (device token), which
  revokes it. The plugin calls this before forgetting its token.
- **Online** means the device made an authenticated request in the last 60s (`last_seen`).
- **One queue per user.** Messages stay per user: every active device of the user receives
  everything queued for them.

### User API (`withUserAuth`)

- **Session only:** claim, PATCH, DELETE and the Hey Even key are **session-only**
  (`core/devices/session-policy.ts › glassesSessionOnly`). A `dopl_at_` agent token gets 403
  `SESSION_REQUIRED`, so a prompt-injected agent cannot mint glasses credentials.
- **List is open:** `GET /devices` accepts either.
- **Dev-only escape:** `GLASSES_DEV_AGENT_TOKENS=1` on a non-production server lets the dev seed
  script claim with a `dopl_at_` token.

| Route | Body | Returns |
|---|---|---|
| `POST /api/glasses/pair/claim` | `{code, name?}` | 201 `{device}`. Limited to 10 per minute per user. A legacy `channel_id` is accepted and ignored. |
| `GET /api/glasses/devices` | none | `{devices:[{id, name, platform, created_at, last_seen, online, has_hey_even_key}]}` |
| `PATCH /api/glasses/devices/:id` | `{name?}` | `{device}`. A legacy `channel_id` is accepted (any value) and ignored. |
| `DELETE /api/glasses/devices/:id` | none | `{ok:true}` (revoke) |
| `POST /api/glasses/devices/:id/hey-even-key` | none | `{key, url}`, returned once. Rotating replaces the old key. |

- **No linked channel (2026-09-28).** A device is not scoped to a channel. Where it talks is
  picked on the glasses (see "Current target and voice routing"). Replies come back from the
  channels it is looking at or talked to (see "Reply mirror"). The old
  `glasses_device_links.linked_channel_id` / `linked_container_id` / `reply_cursor_seq` columns
  are left in place, unread (drop is a follow-up in `docs/db-cleanup-audit.md`).
- **Channel rule:** a device only ever reads or posts in a live (not archived, not deleted)
  channel its owner is a member of (`core/devices/channel-link.ts`).
  - Setting a current target checks it (404 `CHANNEL_NOT_FOUND` otherwise).
  - **Every reply-mirror pass re-checks it** for every in-scope channel, in one read. A channel
    the owner left, or that was archived or deleted, is skipped and nothing is read from it:
    leaving a channel removes access.
  - Posting re-checks membership through the channels service.
- **The Hey Even `url`** is built from `GLASSES_API_BASE_URL`, then `NEXT_PUBLIC_APP_URL` in
  production, then the server's own origin in dev. It never uses a forwarded header. Set
  `GLASSES_API_BASE_URL=https://www.usedopl.com` in production, because the apex redirects and
  clients drop `Authorization` on that hop.

### MCP exposure and metering

- **Where the tools appear:** the tools have one implementation (`core/mcp/tools.ts ›
  registerGlassesTools`).
  - `/api/mcp/glasses` lists them to any caller whose containment profile offers them.
  - The main `/api/mcp` adds all 11 **only when the caller has at least one paired device**
    (`core/mcp/exposure.ts › exposeGlassesTools`, `requireDevice: true`). The check is cached per process for 30s and
    bounded to 5k users.
- **Containment profiles:** `@dopl/mcp-server › offeredToolsFor` decides.
  - An absent header, `channel_agent` or `full` gets the glasses tools.
  - `read_only`, `dopl_only`, or an unreadable profile gets none. Glasses reach hardware outside
    Dopl, so they are not in the `dopl_only` allow list.
  - The legacy/granular tool-set claim does not apply: glasses tools are the same in both.
- **Metering (one credit per call):**
  - MCP calls charge through the same seam as the registrar (`DoplClient.consumeCredits` →
    `/api/mcp/credits/consume`). That applies the credential's container lock, rule B's session
    channel and the call tally.
  - Voice and Hey Even **utterances** each cost one credit on the device owner's home wallet,
    charged in-process because a device credential is not an MCP token. For voice the charge
    happens after the silence check and before STT.
  - An empty wallet refuses with 402 (Hey Even: `insufficient_quota`).
  - A thrown charge fails open, like the registrar.
- **OAuth discovery for `/api/mcp/glasses`:** the 401 challenge points at the root
  `/.well-known/oauth-protected-resource`, whose `resource` is `<origin>/api/mcp`. MCP clients
  accept a path-prefix resource, and `/api/mcp/glasses` sits under `/api/mcp`, so no dedicated
  metadata document is needed.

### Security

- **Bearer-only device routes.** The device and Hey Even routes authenticate only by bearer
  credentials looked up by hash. They are in `SELF_AUTH_ROUTES`, so a browser preflight is not
  session-gated.
- **CORS defaults to `Access-Control-Allow-Origin: *`.** This is safe because these routes read
  no cookie or other ambient credential, and `*` forbids credentialed requests. The Even WebView's
  production origin is undocumented, so a narrower default would block the real plugin.
  `GLASSES_PLUGIN_ORIGINS` (comma-separated exact origins) is an optional narrowing override.
- **Rate limits:**
  - Pair start: 10 per minute per IP.
  - Claim: 10 per minute per user.
  - Voice and Hey Even together: 20 per minute per device, then 429.
- **Voice uploads** are refused over about 60s of audio, first by `Content-Length` and then while
  streaming.
- **No credential values in logs.** The Hey Even header log is off unless `GLASSES_DEBUG=1`, and it
  redacts `authorization`, `cookie` and any `*token*`/`*api-key*` header.

### Load (per device)

- The inbox hold polls the DB every 2s.
- The reply mirror runs at most every 5s: one activity-row read, one membership read, and one
  message read for every in-scope channel together. A channel entering scope costs one head read.
  Cursor writes are batched into one upsert, only when a cursor moved or is 5 minutes from stale.
- `last_seen` is written at most once per 30s.
- `glasses_ask` and screen waits poll every 1.5s.
- A menu request checks membership once and resolves the channels-service context once
  (`core/menu/types.ts › MenuChannelHandle`); a read-mode long-poll or a launch hold reuses it
  every slice.
- Voice and Hey Even resolve the override and current target with one membership read, and the
  post reuses that channel row. Only when neither is usable does the most-recent fallback run
  (the account channel list, one last-message RPC, and a membership re-check of the top 5).
  A post adds one activity read and one upsert.

### Deferred (needs Samuel)

- Drop the dead prototype `glasses_devices` table and review the extra owner RLS policies. This is
  non-additive.
- Rule on the `glasses_device_links.linked_channel_id` `ON DELETE SET NULL` exemption in
  `channels/schema-sql.test.ts`. The column is retired (not read or written since 2026-09-28);
  dropping it with `linked_container_id` and `reply_cursor_seq` is non-additive, listed in
  `docs/db-cleanup-audit.md`.

## Endpoints

### Agent side: `POST /api/mcp/glasses` (MCP, streamable HTTP, stateless)

Auth is the same as `/api/mcp`: a Dopl OAuth access token (`Authorization: Bearer dopl_at_…`). A
missing or bad token gets a 401 with the `WWW-Authenticate` challenge, so MCP clients run the normal
OAuth login.

| Tool | Args | Returns |
|---|---|---|
| `glasses_notify` | `title` (≤64 B), `body` (≤400 B), `ttl_sec?`=60 | `{id, status}` |
| `glasses_show` | `title` (≤64 B), `lines` (1-4, each ≤100 B), `card_id?` (not `reply-…`, which is reserved for agent replies), `ttl_sec?`=600 | `{id, card_id, status}`. The same active `card_id` is updated in place and re-delivered. |
| `glasses_ask` | `question` (≤120 B), `options` (2-4, each ≤40 B), `timeout_sec?`=120 | Holds up to 200s. `{id, status:'answered', answer:{choice,index,at}}`, `{id, status:'timeout', answer:null}`, `{id, status:'dismissed', answer:null}`, or `{id, status:'pending'}` when `timeout_sec` > 200 (then call `glasses_get_answer`). |
| `glasses_get_answer` | `id` | `{id, status, answer}` |
| `glasses_status` | none | `{online (any device seen in the last 60s), last_seen, active_count (queued messages), devices:[{id, name, online, last_seen}]}` |

The screen tools are described below. Each write tool needs the `dopl.write` scope. Read-only calls work without it: `get_answer`, `status`, `capabilities`, `list_templates`, and `render`/`use_template` with `validate_only`.

All text is sanitized before the byte check: curly quotes become straight, en/em dashes become `-`,
and emoji and non-BMP characters are stripped. The G2 fails silently on any of those. An over-limit
field returns a tool error such as `question is 121 bytes; max 120. Shorten it.`

### Agent-built screens (`glasses_capabilities`, `glasses_render`, `glasses_update`, templates)

Code: `core/screens/` (vocabulary, validation, templates) and `platforms/even-g2/compile.ts`. Layout is measured server-side with
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

**One display door (2026-09-28, docs/specs/unified-display.md):** `glasses_render`,
`glasses_ask`, `glasses_use_template` and `glasses_update` are shortcuts over `POST /api/displays`
(`display/server/service.ts › showDisplay`) with `target:"glasses"`, called on the caller's own
loopback client — names, args and return shapes unchanged. `glasses_render` blocks are the v1
vocabulary above, read through `display/core/normalize.ts › fromV1` (a selectable list is a
`choice`). From a Dopl channel session the display is also that channel's message (a `choice`
makes it a decision; the lens row links to it by `channel_message_id`), and a tap on the lens
answers the channel decision too (`display/server/answer.ts › answerFromLens`). On `/api/mcp`
(beside `dopl_show`) their descriptions say they are its shortcuts. `glasses_show` /
`glasses_notify` stay lens notices with no channel copy. Templates are stored as `spec_version: 2`
(`display/core/template.ts`); older v1 templates are read through `fromV1`.

**Back-button band (2026-09-27):**
- Every compiled screen reserves its bottom 40px (`nav_footer: {x:0, y:248, w:576, h:40}` in the
  payload; `spec_version` stays 1). The plugin draws its context back button there: Back to
  Agent, Back to Channel or Back Home.
- Stack layouts end above the band.
- An absolute block reaching into it gets the fixable error `overlaps_nav_footer`.
- A selectable list holds at most 19 items, because the plugin appends the back item as the 20th;
  a plain list keeps 20.
- `glasses_capabilities` reports `content` (576x248), `nav_footer` and `selectable_list_items: 19`.
- The ASCII preview shows `< [back button]` in the band.
- If the wearer leaves a screen via back, the plugin calls `/dismiss`. A `wait_for_input` hold
  then returns `{status:'dismissed', input:null}` on its next poll (within 1.5s).

**Wire payload for `kind:'screen'`** (inbox):
`{screen_id, spec_version:1, containers:[{block_id, kind:'text'|'list', x, y, w, h, content?, items?, brightness?, border?, capture}], nav_footer:{x,y,w,h}}`.
- Containers are already sanitized, byte-checked and positioned. There are at most 8.
- Exactly one container has `capture:true`: the selectable list, otherwise the last text
  container, otherwise the last container.
- **Box model the compiler assumes (the plugin must render the same way):**
  - `paddingLength: 4` on every container, plus `borderWidth: 2` when `border` is true.
  - 27px per text line; a selectable list row is 40px (the firmware's row pitch; a list may
    shrink to 2 rows and scroll). An info list (`selectable:false`) is drawn as a TEXT container,
    one `─ item` line per item, so it takes 27px lines and must fit (else `overflow`).
  - A text container's height is `lines*27 + 8`, plus `4` with a border.

### Device side: `/api/glasses/device/*` (the plugin contract)

- **Auth:** `Authorization: Bearer <device token>` from pairing. A missing, unknown or revoked
  token gets 401.
- **CORS:** `OPTIONS` answers 204. `Access-Control-Allow-Origin` is `*` unless
  `GLASSES_PLUGIN_ORIGINS` narrows it (see Security).
- `GET /inbox?after=<ISO>&wait=<0-25, default 25>` returns `{messages: Message[], server_time}`.
  - Every authenticated device call stamps that device's `last_seen`.
  - Returns rows that are pending or delivered and not expired, with `updated_at > after`, ordered
    by `updated_at` ascending. Returned rows are marked `delivered`.
  - When nothing matches, it polls once a second for up to `wait` seconds, then returns `[]`.
  - **Cursor (overlap contract):** pass the newest held message's `updated_at` back as `after`,
    URL-encoded. An unencoded `+00:00` is tolerated.
    - The server answers with every row touched after `after − 15s`. That includes **terminal**
      rows (answered, dismissed, expired), so a message handled on another device clears here.
    - The device dedupes by `(id, updated_at)` and removes terminal ids.
    - The hold ends once any row is strictly newer than `after`.
    - `updated_at` comes from the database clock (trigger, `20261029120000`). Delivery does not
      change it; any other update does, so an updated card comes back.
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

## Menu and read mode (device API, 2026-09-27)

The glasses plugin's menu is Home, then channel actions,
agents, start agent, conversation and read. It is served by `core/menu/service.ts` over `core/menu/gateway.ts`,
which calls Dopl's own services:
- `listAccountChannels` for channels;
- `readTranscript` and `awaitNewMessages` for messages;
- `createLaunchDirective` and `getLaunchDirective` for launches.

All routes take the device token and answer errors as `{error:{code, message}}`. Reads (polls
included) are limited to 120 per minute per device, launches to 5 per minute.

🔒 **Visibility:** every channel-scoped call first checks that the device owner is a member of a
live channel (`core/devices/channel-link.ts`), and the channels service checks again. Leaving a channel removes
access.

| Route | Returns |
|---|---|
| `GET /api/glasses/device/home` | `{recent_agents:[{session_id, agent_name, channel:{id,name}, status, last_activity}] (max 6), channels:[{id, name, container_name, last_activity, unread}]}`, channels newest activity first |
| `GET /api/glasses/device/channels/:id/agents` | `{agents:[{session_id, name, runtime, model, status, last_activity}]}` |
| `GET /api/glasses/device/channels/:id/messages?before=&limit=(1-100, default 40)&agent=` | `{messages:[{id, seq, author:{kind:'member'\|'agent', name}, text, created_at, attachments_note?, display?}], has_more, before, after}`, oldest first (`display`: see Display messages below) |
| `GET /api/glasses/device/channels/:id/messages?after=<seq>&wait=(≤20)&agent=` | Long-poll, same shape. The DB is polled every 2s. The next `after` is returned even when the `agent` filter dropped every row. |
| `GET /api/glasses/device/launch-options?channel_id=` | `{runtimes:[{id, label, models:[{id, label}], stale, note?}]}`: models are "Default" + the desktop's published catalog (`runtime_model_catalogs`); `stale` = no catalog or an aged one (history added), `note` = a line for the lens ("Open Dopl on your computer to refresh this list.") |
| `POST /api/glasses/device/launch {channel_id, runtime, model?, name?}` | `{status, session_id, agent_name, directive_id}`. The agent's name rides the launch request's own `agentName` field (the one `dopl_launch_agent` sends), which the desktop applies. Without `name` it is the next free `New agent`, `New agent 1`, `New agent 2`…, unique case-insensitively among the owner's live agent sessions and their last 200 launches; the agent can rename itself later. The optional `name` is trimmed, sanitized and cut to 40 characters, and empty means none. |
| `GET /api/glasses/device/launch/:directiveId?channel_id=` | The same shape, for a launch still `launching` after the POST |
| `PUT /api/glasses/device/target {channel_id \| null, agent_session_id?}` | `{ok:true}` |
| `POST /api/glasses/device/channels/:id/messages/:messageId/display/answer {index, block_id?}` | `{ok:true, answer:{block_id, choice, index, at, via:'glasses'}}`; errors as the app route (below) |

**Live agent activity** (the channel page's "working · thinking" bar, `core/menu/activity.ts`):
- Every messages response, paged or long-polled, carries
  `activity:[{session_id, name, state:'thinking'|'working'|'replying'|'waiting', detail?}]` and
  `activity_version` (a 12-hex fingerprint).
- It is built from the live `channel_sessions` rows each operator's desktop pushes, using the
  `dopl_read_channel` vocabulary:

  | Session detail | `state` | `detail` |
  |---|---|---|
  | `thinking` | `thinking` | |
  | `tool` (or none, while working) | `working` | the tool name, only on the wearer's own sessions |
  | `posting` | `replying` | |
  | `permission` | `waiting` | "needs approval" |
  | `awaiting_peer` | `waiting` | "waiting on an agent" |

- **Omitted:** idle and ended sessions, a session only holding an inbound reply
  (`awaiting_inbound`), and rows not refreshed in the last 120s.
- **Long-poll wake-up:** pass `&activity=<activity_version>` and the long-poll also returns as soon
  as the set or any state changes, with `messages: []` if nothing new was posted. It checks once
  every 2s: one message check, then one activity read.

**Message rendering:**
- Only `kind:'message'` rows are shown.
- Text is markdown-flattened and sanitized. Line and paragraph breaks are kept (`\n`; three or
  more blank lines fold to one). Images become `[image]`; links to files become `[file: name]`,
  and these are also listed in `attachments_note` (`core/channel-text.ts › flattenChannelText`).
- Authors are named `You` for the device owner, then the member's name, then the agent's display
  name, then `agent-<id>`. The agent's name comes from its live `channel_sessions` row; an agent
  with no row (ended, or its Mac restarted) gets its **persisted** name in one batched read per
  page (`gateway.ts › persistedAgentNames`, fenced on the channel): the run's last label in
  `workspace_token_spend` (`session_key` ends `:<agentId>`), else its launch directive's
  applied / requested / identity name. Home's recent agents and the agents list use the same
  lookup for a session row with no name. `agent-<id>` only when neither knows it.

**Display messages** (docs/specs/unified-display.md, contract C3):
- A message whose `display/core/adapt.ts › displayOf` answers — a v2 display, a v1 display, or a
  legacy decision (`metadata.escalation` only) — gets a `display` field, compiled for the device's
  platform into the Read / Conversation page's **chat area** (`platforms/types.ts ›
  ChatDisplay`, G2: `platforms/even-g2/chat-display.ts`):

  ```ts
  display: {
    screen_id: string;
    containers: {block_id, kind:'text'|'list', x, y, w, h, content?, items?, brightness?, border?}[];  // page 1
    pages?: {containers}[];                         // present only when it continues: every page, pages[0] = containers
    options: {block_id, items: string[], recommended: number | null} | null;   // the one choice
    answer: {block_id, choice, index, at, via, by?, message_id?} | null;
    fallback?: true;                                // present only when the text rendering is used
    decision?: true;                                // answering it posts a channel answer message
  }
  // and on an ANSWER message (from `metadata.escalationAnswer`):
  answer_to?: {message_id, index, choice}
  ```

  - Coordinates are **lens px** (the same frame as screen containers). G2 chat area
    (`even-g2/display.ts › CHAT_AREA`): the plugin's chat body rect `x 0, y 30, w 576, h 172`
    (header above, footer list from y 204). Containers stack top-down at `x 8, w 560` from y 30,
    never below y 202, with the G2 font and box model; none captures input.
  - The **choice is not a container**: it is `options`, for the plugin's footer list; the
    recommended item carries ` (rec)` when it fits 63 bytes. Every container is text: info
    lists, fields and tables are `─ item` / `label: value` lines (never a G2 list, which draws
    40px rows and a selection border). Absolute layouts are stacked.
  - **Never below y 202.** A display taller than the area (or over 6 containers) continues on
    further pages: `pages` (max 6), each its own reader page; a text block fills the page and
    continues (by line, then word, at least 2 lines each side), any other block moves whole.
    The plugin shows `(k/n)` on the first line, and the options / answered line only on the
    last page. An older plugin reads `containers` (page 1). Over 6 pages → the degradation
    ladder (`display/core/degrade.ts`) shortens it.
  - A block over the G2 limits at every ladder level → `fallback: true`: the text rendering,
    paged the same way (cut with `+N more` past 6 pages).
  - `text` on a display message is that text rendering, multi-line: text blocks, `label
    ███▒▒▒▒▒▒▒ 32%`, a `─` divider, info items `─ item`, options `▶ item`. A stored display that
    fails re-validation is shown as a plain message (no `display`).
- **Answer from the glasses**: `POST …/messages/:messageId/display/answer {index, block_id?}`
  (`id` from the message; device token, read rate limit). It runs the app route's own path
  (`display/server/answer.ts › answerDisplay`) as the device owner with `metadata.source` = the
  glasses, so the owner must be a channel member and one of the display's answerers (tagged, else
  its author); a decision posts the answer message (a linked lens row is released by the
  post-insert hook), a v1 dev row takes the legacy lane. Errors: 404 `DISPLAY_NOT_FOUND` / `CHANNEL_NOT_FOUND`, 400 `DISPLAY_BAD_CHOICE`
  / `VALIDATION_FAILED`, 403 `DISPLAY_NOT_YOURS`, 409 `DISPLAY_ANSWERED` / `DISPLAY_ANSWER_REFUSED`.
- **Conversation filter** (`agent=`): that agent's own posts, plus the owner's posts addressed to
  it. It reads a raw page four times wider. Use `before` from the response to page further back,
  because the filter drops rows.

**Status mapping:** `channel_sessions.state`/`detail` map to `working`, `waiting`, `idle` or
`ended`. `waiting` means detail is `permission` (a tool approval) or `awaiting_inbound`.

**Launch semantics:**
- Agents run on the owner's Dopl desktop, so the server files a launch directive through the same
  `createLaunchDirective` path as `dopl_launch_agent`. The desktop claims it and enforces the agent
  cap, launch posture, credits and runtime/model availability.
- The POST waits up to 10s for the result:
  - `launched`: `session_id` is the new agent id, and the device's current target is set to that
    agent.
  - Still `launching`: poll `GET /launch/:directiveId`.
  - Refused: 409 `LAUNCH_<REASON>` with a short message, for example `LAUNCH_CAP` "Agent limit
    reached on your computer.".
  - Expired: 409 `LAUNCH_EXPIRED`.
  - Desktop offline: 409 `DESKTOP_OFFLINE`.
- The server has no model catalog (the desktop owns it), so launch options are the runtimes and
  models this user has launched before, plus Claude and its known models. Each runtime starts with
  `Default` (no model, so the desktop picks). The desktop refuses anything it can't run (`no-sdk`,
  `no-model`).

**Current target and voice routing:**
- Voice and Hey Even go to the first usable target, in this order:
  1. an explicit override: `?channel_id=&agent=` on the request, or the headers
     `X-Glasses-Channel` / `X-Glasses-Agent`;
  2. the stored current target, set when the wearer opens a chat/read view on the glasses
     (`POST /device/target`, which checks membership);
  3. **fallback:** the owner's most recently active channel (last message, else creation) that
     they are a member of and that is live. Direct messages are excluded, so an untargeted
     utterance never lands in a one-to-one conversation with another person.
  - With none usable, the answer is 409 `Open a channel on your glasses first.`
    (Hey Even: `invalid_request_error`).
- Each candidate is re-validated, and an invalid one falls through to the next. There is no
  linked-channel step.
- An **agent** target is sent `to: @agent-<id>` and must be running; if it isn't, the answer is 400
  "That agent is not running".
- A **channel** target is unaddressed, so the channel's normal wake rule applies.
- The Hey Even answer is `Sent to <agent display name | channel name>.`, or the agent's reply if it
  arrives within the hold.

## Voice: glasses to Dopl channel to agent, replies back to the glasses

What the wearer says is posted as the device owner's own message into the **resolved target**
(see "Current target and voice routing" above). With no usable target the answer is 409.
- **Handler:** `core/voice/utterance.ts › handleGlassesUtterance`, using the channels service's
  `postMessage`. That is the same write the app and `dopl_send_message` use, so the server stores
  the normal wake verdict.
- **Addressing:** an agent target is addressed `to: @agent-<id>`. A channel target is unaddressed,
  and the server's rule for an unaddressed person-authored post (RR3) wakes the room's agent.
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

**Reply mirror** (`core/messages/reply-mirror.ts`):
- **Scope, per device:** (a) its current-target channel, and (b) every channel it posted to by
  voice or Hey Even in the last 24h. State lives in `glasses_device_channel_activity`
  (`device_id, channel_id, last_posted_at, reply_cursor_seq, cursor_at`), one row per channel.
  A successful post stamps `last_posted_at` (`recordDevicePost`, called from the utterance's
  `onPosted` hook; a failed stamp never fails the utterance).
- Each device inbox long-poll (at most one pass per 5s) reads agent `message` rows past each
  in-scope channel's cursor in **one** query (`ChannelGateway.agentMessagesAfterMany`, an `or` of
  `channel_id = X AND seq > n` groups, ordered by channel then seq, 20 per channel per pass).
- **No history replay.** A channel entering scope (no row, or a cursor not confirmed in the last
  600s, e.g. it left scope or the glasses were off) starts at the channel's head. A post into a
  channel without a fresh cursor starts it at the post's own seq, so the reply to that post is
  mirrored and nothing older is. A fresh cursor is kept on a new post, so replies already pending
  still arrive.
- Each reply becomes a glasses message with `card_id = reply-<channel message id>`. The partial
  unique index `glasses_messages_reply_card_uidx` stops duplicates.
- Every reply becomes a `show {title: agent display name, lines, channel_id, agent_session_id?}`
  card, never a `notify`. `channel_id` is the source channel and `agent_session_id` the author
  agent when known, so the plugin can fold the reply inline in Read/Conversation for that channel. A notify
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
GLASSES_API_BASE_URL=<public base for Hey Even URLs; https://www.usedopl.com in production>
GLASSES_PLUGIN_ORIGINS=<optional; narrows CORS from * to these exact origins>
GLASSES_REPLY_HOLD_MS=<optional; default 6000, max 6000>
GLASSES_DEBUG=<optional; 1 logs Hey Even request headers, redacted>
GLASSES_DEV_AGENT_TOKENS=<dev only; 1 lets dopl_at_ tokens claim/manage devices outside production>
```

Migrations applied to the project (matched by NAME):
- `20261025120000_glasses_messages`
- `20261026120000_glasses_screens_templates`
- `20261027120000_glasses_voice_reply_mirror`
- `20261028120000_glasses_device_links_pairings`
- `20261029120000_glasses_review_hardening`
- `20261030120000_glasses_device_current_target`
- `20261111120000_glasses_device_channel_activity` (applied 2026-09-28 by name as
  `glasses_device_channel_activity`, byte-exact, md5 `0342853c1c936bf425346c9986bcbabf`)

- `20261112120000_device_aware_messages` (applied 2026-09-28 by name as `device_aware_messages`,
  md5 `5f460724dbe755f0260d73a7405e3426`): `glasses_messages.channel_message_id` and
  `merge_channel_message_display` (plus `desktop_devices.display_name`).

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

`scripts/glasses-dev-seed.mjs` takes a file holding a Dopl user credential for the account that
will own the device:
- a Supabase access JWT, or
- a `dopl_at_…` token, only when the dev server runs with `GLASSES_DEV_AGENT_TOKENS=1`.

Secrets go only to files (mode 600).

```sh
# Claim the code the plugin/simulator is showing:
node scripts/glasses-dev-seed.mjs --user-token-file <file> --code ABC234 --channel <channel uuid>

# Or pair a headless device end to end, saving its token (and optionally a Hey Even key):
node scripts/glasses-dev-seed.mjs --user-token-file <file> --out <token file> --channel <uuid> --hey-even <key file>
```

`--base` defaults to `http://127.0.0.1:3100`.
