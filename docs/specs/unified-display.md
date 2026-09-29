# Unified display (spec, 2026-09-28)

**The single source of truth for three parallel builders** (backend/tools, desktop+web renderer,
glasses plugin) and the reviewer. Supersedes the `metadata.display` sections of
`docs/specs/device-aware-messages.md` (that doc keeps `metadata.source` and computer renames).

Samuel's ask, short: one display format and one tool for "custom displays" (today: glasses screens,
the chat display card, and the fixed decision card are three things). Agents compose displays from
a small set of blocks; every surface (desktop/web card, G2 lens, future devices) draws the same
spec its own way. The decision card becomes a display the agent composes. Agents are pushed, softly
but firmly, to use displays for choices and structure.

---

## 0. Decisions at a glance

| # | Decision |
| --- | --- |
| D1 | Platform-neutral display core moves to `src/features/display/core/**` (client-safe). Glasses keep only the lens adapter and the G2 compiler. |
| D2 | Block vocabulary v2 = 9 blocks: `heading text fields list choice progress table divider spacer`. **No `image`** (desktop CSP forbids `img-src https:`, `apps/desktop-ui/vite.config.ts`). |
| D3 | `choice` is the ONLY answerable block (max one per display). A v1 selectable `list` is read as a `choice`. |
| D4 | Stored envelope `metadata.display` gets `spec_version: 2`. v1 rows (dev rows exist in the shared DB, incl. the backfill) and legacy decision rows (`metadata.escalation` only) are adapted **at read time**; no data rewrite. |
| D5 | A channel display with a `choice` IS a decision. The server also stamps `metadata.escalation` as a **decision index** (projection) so every existing decision mechanism keeps working unchanged: answerers rule, unique answer index, typed answers, agent wake via `escalationAnswer.agentId`, waiting items, notifications, old shipped desktops (they render the index as today's card, or the body). |
| D6 | ONE tool: **`dopl_show`** (granular), bound to `dopl_channel:send` with preset `kind:"display"`, runs `POST /api/displays`. `target: auto | channel | glasses`. |
| D7 | `dopl_request_decision` unchanged on the wire; the server builds its display from the escalation (one builder shared with the read adapter). `glasses_render / use_template / update / ask / show / notify` become thin shortcuts over the display service; names and return shapes unchanged. |
| D8 | `display` param is REMOVED from `dopl_send_message` (unshipped branch; one path). The POST messages route keeps a `display` input only as the service's stamping entry. |
| D9 | Answers: one route (`…/display/answer`) for every display. Decision lane = today's escalation answer (a member message with `escalationAnswer`); a post-insert hook stamps `display.answer` and releases a linked lens row. |
| D10 | Enforcement = descriptions + guidance line + server-side nudge (tip line in the post result, log line). No auto-conversion. Plain chat stays plain. |
| D11 | Auto lens push goes only to the CALLER's own glasses, only when a device is online (seen ≤60s) and the display has a `choice` (or no channel is resolvable). |

---

## 1. Module layout

```
src/features/display/                          NEW — owner: backend
  core/            client-safe, no server imports (the desktop renderer's ESLint fence)
    types.ts       §2 types, limits, BLOCK_TYPES, DISPLAY_SPEC_VERSION = 2
    normalize.ts   normalizeDisplay(input, {version}) → {ok, display} | {ok:false, errors}; fromV1(blocks)
    adapt.ts       displayOf(metadata, opts?) (v2 | v1 | escalation → Display);
                   displayFromEscalation(e); decisionIndexOf(display) (projection)
    fallback.ts    displayFallback(blocks) — text-only rendering (body, MCP reads)
    degrade.ts     toLensPrimitives(blocks, {mode, level}) — §2.5
    answerers.ts   answerersOf(metadata, authorUserId) — "tagged, else author" (moved from
                   server/service-writes-metadata-escalation.ts › escalationAnswerers; both import it)
    template.ts    moved from glasses/core/screens/template.ts; v1/v2 aware
    doc.ts         BLOCKS_PARAM_DOC (pushed, ≤330 chars) + DISPLAYS_GUIDE (pulled doctrine text)
  server/
    service.ts     showDisplay(ctx, input) — routing, post/replace, lens push, hold, templates, validate
    answer.ts      answerDisplay (decision lane + legacy v1 lane), saveDisplayTemplate, onAnswerInserted hook
    lens.ts        port over glasses/core/screens/service.ts (push/replace/hold a lens row)
    repository.ts  RPC wrappers + findByDisplayId
    nudge.ts       structuredProseSignals(body) + throttle + log
src/app/api/displays/route.ts                  NEW POST — owner: backend

src/features/glasses/core/screens/             owner: backend
  spec.ts, normalize.ts   KEPT as the LENS PRIMITIVE vocabulary (text/list/progress/divider/spacer)
                          the G2 compiler consumes; spec.ts BLOCKS_DOC rewritten to v2 (§4.4)
  service.ts              becomes the lens row engine used by display/server/lens.ts
  display.ts, channel-mirror.ts, channel-displays.ts, display-actions.ts, template.ts
                          DELETED (moved into display/**; delete, don't disarm)
src/features/glasses/platforms/even-g2/**      G2 compiler — owner: backend (consumes primitives)

src/features/channels/components/              web + desktop renderer — owner: renderer
  display-card.tsx, display-blocks.tsx, display-choice.tsx (NEW: the decision face)
  escalation-card-row.tsx, agent-stream-escalation.tsx, hooks/use-escalation-writes.ts → DELETED
  once every caller renders DisplayCard

~/Downloads/glasses-mcp/plugin                 glasses plugin renderer — owner: plugin
```

Per-surface renderers of the SAME `Display`:

| Surface | Renderer | Input |
| --- | --- | --- |
| Web channels-v2 + desktop workspace pages + desktop Home pane (all via `transcript.tsx`) and the agent stream | `display-card.tsx` → `display-blocks.tsx` / `display-choice.tsx` | `displayOf(message.metadata, {pageAnswer})` |
| G2 lens screen (a pushed display, `glasses_messages.kind='screen'`) | `toLensPrimitives(mode:"screen")` → `even-g2/compile.ts › compileScreen` | v2 blocks |
| G2 Read / Conversation chat area | `toLensPrimitives(mode:"chat")` → `even-g2/chat-display.ts › compileChatDisplay` → plugin | v2 blocks |
| Text-only (message `body`, `dopl_read_channel`, glasses inbox text, old clients) | `displayFallback` | v2 blocks |

---

## 2. Block vocabulary v2

### 2.1 Types (`display/core/types.ts`, verbatim contract)

```ts
export const DISPLAY_SPEC_VERSION = 2;
export const BLOCK_TYPES = ["heading", "text", "fields", "list", "choice", "progress", "table", "divider", "spacer"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

interface BlockBase { id: string }                       // normalized: always present (default b1, b2, … by position)

export interface HeadingBlock  extends BlockBase { type: "heading"; text: string }
export interface TextBlock     extends BlockBase {
  type: "text"; content: string;                         // newlines allowed
  tone?: "muted" | "strong";                             // omitted = default ink
  // glasses hints (v1), ignored by chat renderers except `border`:
  lines?: number; brightness?: 0 | 1 | 2 | 3 | 4; border?: boolean;
}
export interface FieldsBlock   extends BlockBase { type: "fields"; rows: { label: string; value: string }[] }
export interface ListBlock     extends BlockBase { type: "list"; items: string[]; style?: "number" }  // info only; omitted = bullets
export interface ChoiceOption  { label: string; description?: string; recommended?: true; why?: string }
export interface ChoiceBlock   extends BlockBase { type: "choice"; options: ChoiceOption[] }
export interface ProgressBlock extends BlockBase { type: "progress"; value: number; label?: string }
export interface TableBlock    extends BlockBase { type: "table"; columns: string[]; rows: string[][] }
export interface DividerBlock  extends BlockBase { type: "divider" }
export interface SpacerBlock   extends BlockBase { type: "spacer"; lines?: number }

export type DisplayBlock = HeadingBlock | TextBlock | FieldsBlock | ListBlock | ChoiceBlock
  | ProgressBlock | TableBlock | DividerBlock | SpacerBlock;

/** x/y/w/h survive only on layout "absolute" (glasses_render); chat renderers only ORDER by them. */
export type Positioned<B> = B & { x?: number; y?: number; w?: number; h?: number };

export interface DisplayAnswerStamp {
  block_id: string;          // the choice block's id
  index: number;             // 0-based option index — THE answer
  choice: string;            // the option label at answer time
  at: string;                // ISO
  via: "glasses" | "computer" | "web" | "phone" | (string & {});   // metadata.source.kind vocabulary
  by?: string;               // answering member's user id (absent on v1/lens-only answers)
  message_id?: string;       // the answer message (decision lane)
}

/** Stored at channel_messages.metadata.display (reserved, server-written). */
export interface DisplayEnvelopeV2 {
  spec_version: 2;
  display_id: string;                        // [A-Za-z0-9_-]{1,64}; server "d-xxxxxxxx" unless the caller named one
  blocks: Positioned<DisplayBlock>[];        // normalized
  layout?: "absolute";                       // omitted = stack
  wait_until?: string;                       // ISO; set while an agent hold may still consume the answer (§3.4)
  glasses_message_id?: string;               // linked lens row
  answer?: DisplayAnswerStamp | null;
  origin?: "dopl_show" | "dopl_request_decision" | "glasses_render" | "glasses_ask" | "glasses_use_template" | "glasses_update";
}

/** What every reader gets from displayOf(). */
export interface Display {
  from: "v2" | "v1" | "escalation";
  display_id: string;
  blocks: Positioned<DisplayBlock>[];
  layout: "stack" | "absolute";
  answer: DisplayAnswerStamp | null;
  wait_until: string | null;
  glasses_message_id: string | null;
  /** metadata.escalation is present: answers go through the decision lane (§5). */
  decision: boolean;
}

export interface DisplayError { block?: string; code: DisplayErrorCode; message: string }
export type DisplayErrorCode = "bad_value" | "unknown_key" | "too_many_blocks" | "text_too_long"
  | "list_too_long" | "multiple_choice" | "bad_recommendation" | "table_shape" | "duplicate_id";
```

### 2.2 Validation limits (neutral = what a display may carry anywhere)

| Rule | Limit |
| --- | --- |
| Blocks per display | 1–24 |
| `id` (any block) | `^[A-Za-z0-9_-]{1,32}$`, unique; default `b<n>` (1-based position) |
| Unknown key on a block | **error `unknown_key`** naming it (strict; the 2026-09-28 stripped-`layout` lesson). Allowed extras: `lines`,`brightness`,`border` on text; `x,y,w,h` on any block only when `layout:"absolute"` |
| `heading.text` | 1–120 chars, one line |
| `text.content` | 1–2000 chars; newlines kept; `lines` 1–40; `brightness` 0–4 |
| `fields.rows` | 1–12; `label` 1–40 one line; `value` 1–200 one line |
| `list.items` | 1–20; each 1–200 one line |
| `choice` | **max one per display** (`multiple_choice`); `options` 2–12; `label` 1–80 one line; `description` ≤200 one line; `why` ≤200 one line and only on the recommended option; at most one `recommended` (`bad_recommendation`) |
| `progress` | `value` number 0–1; `label` ≤120 one line |
| `table` | `columns` 2–4 (each 1–40); `rows` 1–10; every row has exactly `columns.length` cells (`table_shape`); cell ≤60 one line |
| `spacer.lines` | 1–4 (default 1) |
| Strings | C0 controls except `\n`/`\t` stripped (in multi-line fields only), trimmed; "one line" fields refuse `\n` |
| Fallback body | `displayFallback` output capped at 4000 chars (…) |

`dopl_request_decision` keeps its own tighter caps (2–6 options, consequence required) — those are
the ESCALATION input schema's and do not move (`src/features/channels/escalation.ts`).

Every problem is collected (never truncate silently); the tool error is
`{"ok":false,"errors":[{block,code,message}]}` as `glasses_render` returns today.

### 2.3 v1 compatibility (`fromV1`)

Applied to: stored v1 envelopes (`spec_version: 1`), `glasses_render` / `glasses_save_template` /
`glasses_use_template` input, and v1 templates (no `spec_version` in the stored spec).

| v1 block | v2 |
| --- | --- |
| `text{content, lines?, brightness?, border?}` | `text` (same fields) |
| `list{items, selectable ≠ false}` (v1 default is selectable) | `choice{options: items.map(label)}` (id kept) |
| `list{items, selectable:false}` | `list{items}` |
| `progress`, `divider`, `spacer` | same |
| v1 envelope `screen_id` / `wait_for_input` / `answer{block_id,choice,index,at,via}` | `display_id` / (no hold stamp) / same stamp |

In **v2 input** (dopl_show), a `list` carrying `selectable:true` is accepted as an alias for a
`choice` (lenient), `selectable:false` is ignored. Two v1 selectable lists → `multiple_choice`.

### 2.4 JSON examples

A decision composed freely (what `dopl_request_decision` also produces, with `text` for the issue):

```json
{ "blocks": [
  { "type": "heading", "text": "Ship the migration now?" },
  { "type": "text", "content": "Additive and reversible. CI is green.", "tone": "muted" },
  { "type": "fields", "rows": [ { "label": "Risk", "value": "Low" }, { "label": "ETA", "value": "10 min" } ] },
  { "type": "choice", "id": "ship", "options": [
    { "label": "Ship now", "description": "Live in ~10 minutes; review after.", "recommended": true, "why": "Reversible; nothing depends on it." },
    { "label": "Wait for review", "description": "Blocked until tomorrow morning." } ] } ] }
```

A live status (no choice, replaced in place by `display_id`):

```json
{ "display_id": "deploy-1", "blocks": [
  { "type": "heading", "text": "Deploy 1.38.0" },
  { "type": "progress", "value": 0.6, "label": "Build" },
  { "type": "table", "columns": ["Job", "State"], "rows": [["web", "done"], ["desktop", "running"]] } ] }
```

### 2.5 Degradation (per block, per surface)

`toLensPrimitives(blocks, {mode: "screen" | "chat", level})` maps v2 → the G2 primitive blocks
(`glasses/core/screens/spec.ts`), then the existing compiler lays them out. Chat renderers draw
every block natively.

| Block | Desktop / web | G2 lens + chat area (primitive) | Text-only (`displayFallback`) |
| --- | --- | --- | --- |
| heading | semibold body-size line | `text{brightness:4}` | the text |
| text | paragraph; `muted` → secondary ink, `strong` → semibold; `border` → boxed | `text`; brightness = `brightness` ?? (`strong`→4, `muted`→2, default unset=full) | content |
| fields | two-column rows (label muted, value primary) | one `text`: `label: value` per line | `label: value` lines |
| list | bullets, or `1.`… for `style:"number"` | `list{selectable:false}`; items prefixed `1. ` when numbered; clamped to 63 bytes | `- item` / `1. item` |
| choice | decision face (§4 of renderer, below) | **screen**: a selectable `list` of labels, the recommended one suffixed ` (rec)` when the item still fits 63 bytes; **chat**: not laid out — becomes `options{block_id, items, recommended}` for the footer list. Both: a `text` placed before it with one line per option that has a description (`Label: description`) and `Recommended: Label - why` | `1. Label — description (recommended)` per option, then `Recommended: 2. Label — why` when `why` |
| progress | `UsageMeter` | `progress` (`label ███▒▒ 32%`) | `label 32%` |
| table | small table (header row muted) | one `text`: `a · b · c` header line then one line per row | `a | b | c` lines |
| divider | `hr` | `divider` (`────`) | `---` |
| spacer | vertical gap | `spacer` | blank line |

**Degradation ladder** (deterministic; the compiler tries level 0, then 1, … until it fits):

| Level | Drops |
| --- | --- |
| 0 | nothing |
| 1 | the choice's description/recommendation text block |
| 2 | spacers |
| 3 | dividers |
| 4 | halve `table` rows / `fields` rows / `list` items (keep order, append `+N more`) until it fits, down to 1 each |

Still not fitting: **target `glasses`** → fixable errors returned to the agent (today's
`glasses_render` contract, now listing which level was tried); **`auto`** → lens skipped, the result
says `glasses=skipped(<first error>)`; **read-mode chat** → today's `fallback: true` text container.
A generic future text-only device uses `displayFallback`.

---

## 3. Display envelope, answers, wait, live update, templates

### 3.1 Writes of `metadata.display`

Only the server writes it (reserved key; stripped from caller metadata, as today in
`service-writes-metadata.ts`). Writers:

1. `showDisplay` (every `dopl_show` and every glasses shortcut from a channel session).
2. `POST /api/channels/:id/messages` with `escalation` (i.e. `dopl_request_decision`) → the stamp
   step builds `display = {spec_version:2, display_id: newDisplayId(), blocks: displayFromEscalation(e),
   origin:"dopl_request_decision"}`. **`escalation` and `display` together on one POST → 400**
   (the server derives the other).
3. `POST … messages` with a `display` input (service entry used by `showDisplay`): when the
   normalized display has a `choice`, the stamp step ALSO writes `metadata.escalation =
   decisionIndexOf(display)` (§5.2).

### 3.2 Answer model

- **Single choice.** The answer is an option **index** into the display's one `choice` block.
  `choice` (label) in requests is ignored; `index` decides. `block_id` optional (must match if given).
- **Stamp**: `display.answer` = `DisplayAnswerStamp` (§2.1). Written once (CAS RPC §7.4); a
  re-render/replace never clears the answer of an answered decision (§3.5).
- **via**: `ctx.messageSource.kind` of the answering request (`glasses` from the lens/device routes,
  `computer` from the desktop, `web` from a browser).
- **Who may answer**: `answerersOf` rule = the members the message TAGGED (server-stamped mention set),
  else its author account (today's escalation rule, now for every display). The UI draws buttons iff
  the viewer is in that set (`answerersOf` from `display/core/answerers.ts`).

### 3.3 Answer lanes (`display/server/answer.ts › answerDisplay`)

| Message has | Lane |
| --- | --- |
| `metadata.escalation` (all new choice displays + legacy decisions) | **Decision lane** (§5.3) |
| v1 display with a selectable list, no escalation (dev rows) | **Legacy lane** = today's `display-actions.ts` code, moved verbatim (glasses-linked → `answerAsk`; channel-only → patch + member message addressed to the author agent). Remove after 1.38 ships. |
| a display without a choice | 400 `DISPLAY_BAD_CHOICE` |

### 3.4 Wait semantics

- `wait: true` holds the tool call ≤ **200s** (`ASK_HOLD_CAP_SEC`; `timeout_sec` 5–200, default 120),
  polling every 2s: the lens row (if pushed) and the channel message's `display.answer`.
  Returns `answered` (with the stamp), `dismissed` (lens back button; the channel decision stays open),
  or `timeout` ("the answer will arrive as their message").
- Only a display with a `choice` may wait (`wait` on no choice → error `bad_value`).
- **Held answers wake nobody twice.** At post (or replace), a waiting display gets
  `wait_until = now + timeout_sec`. The decision lane posts the answer message as a RECORD
  (`intent:"chat"`) and derives `escalationAnswer.agentId = null` when `now < wait_until`; otherwise
  it is today's addressed/woken answer. The fold reads `wait_until` at insert time; the hold keeps
  polling until `wait_until + 5s` before returning `timeout`, so any answer inserted before
  `wait_until` (and therefore sent as a record) is still returned by the hold.
  ⚠ Builder verifies a member post with `intent:"chat"` is not fed to live sessions by
  `main/session-dispatch.js › feedLiveSession`; if it is, keep the addressed answer and add to the
  `answered` result: "The same answer also arrives as their message; don't act on it twice."
- The typed-answer door (fold 11b) is unaffected (a typed answer is always an ordinary message).

### 3.5 Live update / replace by `display_id`

- `display_id` names a display for replacement. Lookup: the newest message in the target channel
  whose `metadata.display.display_id = id` AND whose author account is the caller's
  (index §7.4). Lens: the live `glasses_messages` row with `card_id = id` (as `screen_id` today).
- Unanswered → replace in place: body (new fallback), `display` (blocks, `wait_until`, answer stays
  null) and `escalation` (new index, or removed if the choice is gone) in ONE statement
  (`replace_channel_message_display`, §7.4). The doorbell refetch redraws every surface.
- Answered (stamp present OR an `escalationAnswer` message references it) → a NEW message with the
  same `display_id`; the old one keeps its answer. The result says `replaced=new (was answered)`.
- Lens row: `refreshCard` as today (a new screen when the old one expired).
- `glasses_update` = load the stored blocks, apply `{id, content|text|items|value|label|rows}`
  patches, `showDisplay` with the same `display_id`.

### 3.6 Save as template

- Table `glasses_templates` (name kept). Saved spec = `{spec_version: 2, blocks, layout?}`; a stored
  spec without `spec_version` is v1 (`fromV1` at use). `{{var}}` filling unchanged (`template.ts`).
- Validated under the NEUTRAL limits (templates render anywhere; the lens degrades at render).
  `DISPLAY_NOT_A_TEMPLATE` is retired.
- Doors: `dopl_show(save_as="name")` (saves the normalized blocks, then shows), the card's Save
  button (`POST …/display/save`, unchanged path), `glasses_save_template` (v1 input → v2 stored).

---

## 4. ONE tool: `dopl_show`

### 4.1 Schema (granular; params typed by the tool's own text, `carry` past the legacy schema)

```ts
dopl_show({
  channel?: string,        // shared param. Default: this session's channel (X-Dopl-Session-Id)
  thread?: string,         // shared param
  target?: "auto" | "channel" | "glasses",   // default "auto"
  blocks?: object[],       // 1-24; required unless `template`
  display_id?: string,     // [A-Za-z0-9_-]{1,64}: same id replaces the display live
  mention?: string,        // "@handle, @handle": who it is for (their inbox + who may answer); omitted = your operator
  wait?: boolean,          // hold ≤200s for the answer (choice only)
  timeout_sec?: number,    // 5-200, default 120
  template?: string,       // render a saved template…
  data?: Record<string, unknown>,  // …filling its {{variables}}
  save_as?: string,        // also save these blocks as a template
  validate_only?: boolean, // preview per surface; sends nothing
  client_msg_id?: string,  // shared param
})
```

Manifest row (`packages/mcp-server/src/tool-manifest.ts`):

```ts
{ name: "dopl_show", bind: "dopl_channel:send", preset: { kind: "display" },
  params: ["channel", "thread", "client_msg_id"],
  carry: ["target", "blocks", "display_id", "mention", "wait", "timeout_sec", "template", "data", "save_as", "validate_only"],
  alwaysLoad: true }
```

The legacy `dopl_channel` `kind` enum gains `"display"` (the only legacy change; re-record
`legacy-surface.snapshot.json` deliberately). A legacy call with `kind="display"` is refused by
name: `Refused: displays are dopl_show (granular); nothing was sent.` `channel.ts` routes
`kind === "display"` to a new `channel-ops-show.ts › opShow` BEFORE the channel-required checks
(channel is optional for `target:"glasses"`), which calls `client.showDisplay(input)` →
`POST /api/displays` (client timeout ≥ 215s, the `await` precedent).

### 4.2 Routing (`showDisplay`)

| target | Channel copy | Lens copy |
| --- | --- | --- |
| `channel` | required (explicit or session channel; else error "name a channel") | never |
| `glasses` | iff a channel is resolvable (the mirror, as glasses tools do today) | required: caller has paired glasses (else error `No paired glasses; use target "channel"`); compile errors are returned |
| `auto` | iff resolvable | iff the caller's account has a device seen ≤60s AND (display has a `choice` OR no channel resolvable); a compile failure skips the lens and is reported |
| (`auto`, nothing resolvable) | error `Nowhere to show it: name a channel, or pair glasses.` | |

Lens copy is always the CALLER's own glasses (never a mentioned member's; they see it in read mode).

Channel post shape (via the channels `postMessage` service with the caller's ctx, so authorship,
session stamp, `source`, mentions, thread tags are exactly `dopl_send_message`'s):
- `body` = `mention` handles + `\n` + `displayFallback(blocks)`; `summary` = first heading/text line (≤200).
- **choice** → posted like `dopl_request_decision` posts today (`kind:"message"`, no `to`, default
  intent — `opEscalate`'s addressing rules), `display` + decision index.
- **no choice** → `intent:"chat"` (record lane: informs, wakes and feeds nobody — today's mirror rule).
- `thread` passes through. `display_id` → §3.5.

Relation to messages: a display IS a channel message (`kind='message'` + `metadata.display`); it
appears in `dopl_read_channel` as its fallback body; its answer is a member message.

### 4.3 Results (one fact line, the `opPost` style)

```
shown d-1a2b3c4d in #lab · msg=<uuid> · decision tags=1/1 · glasses=shown|skipped(<reason>)|off
shown … · replaced=in-place|new (was answered)
answered 1 "Ship now" by @samuel-wang via glasses          (wait)
timeout: still open; the answer will arrive as their message (wait)
valid · chat: 4 blocks · glasses: fits|degraded(level 2: spacers)|errors:[…]\n<ASCII preview>   (validate_only)
```

### 4.4 Existing tools → the one path

| Tool | Becomes | Wire change |
| --- | --- | --- |
| `dopl_request_decision` | unchanged call; server builds the display from `escalation` (§3.1-2) | none. Description gains ` Compose your own layout with dopl_show.` |
| `dopl_send_message` | plain text only; `display` param REMOVED | description: `…A question a person must answer is dopl_request_decision; choices, lists, tables or status: dopl_show.` |
| `glasses_render` | `client.showDisplay({target:"glasses", display_id: screen_id, blocks: fromV1(blocks), layout, wait: wait_for_input, timeout_sec, ttl, validate_only, origin})` | none (same args/returns: `{id, screen_id, status[, input]}`) |
| `glasses_use_template` | showDisplay with `template`/`data`, target glasses | none |
| `glasses_update` | §3.5 patch then showDisplay | none |
| `glasses_ask` | showDisplay target glasses, blocks `[text{id:"question"}, choice{id:"options"}]`, wait; **lens row kind stays `ask`** (the plugin's ask page has priority); channel mirror = a decision | none (returns `answered|timeout|dismissed|pending` as today) |
| `glasses_show` | normalized through the same core (`[heading title, text lines]`), lens row kind stays `show` (card; mute-hideable), **no channel copy** (a lens notice) | none |
| `glasses_notify` | same, lens kind `notify` (toast), no channel copy | none |
| `glasses_save_template`, `glasses_list_templates`, `glasses_capabilities`, `glasses_status`, `glasses_get_answer` | unchanged behaviour; capabilities lists v2 blocks + the §2.5 ladder | none |

Shortcuts call `client.showDisplay` (the loopback client `exposure.ts` already holds), so there is
ONE door (`POST /api/displays`) and one posting path.

Glasses tool descriptions: on `/api/mcp` (where `dopl_show` exists) they read
`Shortcut for dopl_show(target="glasses"…)`; on `/api/mcp/glasses` (no dopl_* tools) they stay
standalone. `registerGlassesTools(…, { shortcutOf: "dopl_show" | null })` picks the text.

### 4.5 Payload budget

`tool-budget.test.ts`: served granular total 44,590 today, target 49,205. Expected: `dopl_show`
≈ +2,100 (description ≤450, `blocks` = `BLOCKS_PARAM_DOC` ≤330, the rest one short line each),
`dopl_send_message` `display` removed −469 → net ≈ +1,650. Re-measure and set
`GRANULAR_SERVED_CEILING` with a dated comment; must stay ≤ target. The full vocabulary, limits,
degradation ladder and two examples are PULLED: `dopl_get_guide(topic="displays")` →
`dopl://doctrine/displays` (`GranularTool.pulled`), raising `GRANULAR_DOCTRINE_CEILING` only.
Glasses tool texts are app-side (not in that budget) and get shorter.

---

## 5. Decision migration

### 5.1 Old decision messages (read-time adapter, no rewrite)

`displayOf(metadata, { pageAnswer })`:
1. `metadata.display.spec_version === 2` → v2 (re-normalized tolerantly: invalid → next rule).
2. `metadata.display` v1 (has `blocks`, no/1 `spec_version`) → `fromV1`.
3. `metadata.escalation` parses (RELAXED stored parser, §5.2) → `displayFromEscalation(e)`:
   ```
   [ text{id:"issue", content: issue},
     text{id:"context", content: context}            // only when non-empty
     choice{id:"decision", options: options.map((o,i) => ({ label:o.label,
       description: o.consequence || undefined,
       ...(rec?.index === i && { recommended: true, why: rec.why || undefined }) })) } ]
   ```
   `answer` = `pageAnswer` (the transcript's `answersByEscalation` pre-pass → stamp with `by` =
   the answering message's author) when the row has no stamp.
4. else `null` → the body renders (tolerant reader, never a validator).

`decision` = `metadata.escalation` present. Issue stays a `text` (not `heading`) so legacy cards look
exactly as today.

### 5.2 Decision index (`decisionIndexOf`) and the relaxed parser

For a display with a `choice`: `issue` = first heading text, else first text's first line, else
`"Choose one"` (≤200, `…`); `context` = `displayFallback` of the other non-choice blocks (≤2000);
`options` = `{label, consequence: description ?? ""}`; `recommendation` = `{index, why: why ?? ""}`
or null. `src/features/channels/escalation.ts` gains `parseStoredEscalation` (options 2–12,
consequence 0–200, why 0–200); **every server reader switches to it** (`resolveEscalationAnswer`,
`matchTypedOption` callers). The INPUT schema (`ChannelEscalationSchema`) stays strict. Old shipped
desktops parse strictly: an index that fits the strict schema renders today's card; one that does
not renders the body. `dopl_request_decision` rows are strict by construction.

### 5.3 Decision lane (answering keeps every existing semantic)

`answerDisplay` on a decision message:
1. 404 no display/choice; 400 index out of range; 403 `DISPLAY_NOT_YOURS` if not an answerer.
2. `postMessage(ctx, channel, { body: option label, clientMsgId: "display-answer-<messageId>",
   escalationAnswer: { escalationMessageId, optionIndex }, intent?: "chat" when held (§3.4) })`.
   Fold 11 (`resolveEscalationAnswer`) runs unchanged (relaxed parse): 404/403 ordering, derived
   `agentId` (both doors), unique index → 23505 → **409 `DISPLAY_ANSWERED`**.
3. **Post-insert hook** `onAnswerInserted(row)` in `service-writes.ts`, run after ANY successful insert
   carrying `escalationAnswer` (the press, the typed door, an old desktop's POST):
   - target has `metadata.display` → `stamp_channel_message_display_answer` (CAS) with
     `{block_id, index, choice, at, via, by, message_id}`;
   - target display has `glasses_message_id` → release the lens row (`answerAsk`/`answerScreen` with
     that index; "already answered" is ignored) so a lens hold returns and the lens updates.
   Best effort + logged (`[display] answer stamp failed`); the answer message is the fact of record
   and the UI pre-pass still shows it.
4. Wake/notify: unchanged — desktop `escalationAnswerAgentIds` wakes the asking agent; mentions drive
   the inbox/notification; `consequence`/`recommendation` survive as option `description`/`recommended`+`why`.

Lens tap on a linked decision (`/api/glasses/device/answer` → `inbox.answerAsk`): after the row is
answered, if `row.channel_message_id` names a decision message, post step 2 as the device owner with
`source:{kind:"glasses"}` (menu gateway ctx). The hook's lens release is then a no-op.
`answerMirror` remains only for the legacy lane.

### 5.4 Surfaces that learn displays

- `dopl_get_status` waiting items: `isEscalation` unchanged (index present).
- Glasses read mode (`menu/lens-display.ts`): input becomes `displayOf(metadata)` → legacy decisions
  now appear on the lens with options. Device DTO additions in §7.2.
- Agent stream (desktop): sent messages with a display render the compact card (§7 renderer).

---

## 6. Enforcement

### 6.1 Guidance strings (exact)

`dopl_show` description (≤450):
> Show a display: blocks every surface draws its own way (a card in Dopl, the lens on glasses). Use it instead of formatting prose for any choice, status or structured info. A choice block makes it a decision answered in one press; the answer arrives as their message, or here with wait. The same display_id updates it live. Blocks, limits, examples: dopl_get_guide(topic="displays").

`blocks` param (`BLOCKS_PARAM_DOC`):
> heading{text} | text{content, tone?:muted|strong} | fields{rows:[{label,value}]} | list{items, style?:number} | choice{options:[{label, description?, recommended?:true, why?}]} (one per display) | progress{value 0-1, label?} | table{columns, rows} | divider | spacer. Any block may carry id.

Other params: `target` "auto (default): the channel, plus your glasses for a choice when they are on. channel: chat only. glasses: your lens (and the channel if you are in one)." · `display_id` "Same id replaces that display live (an answered decision is re-asked as a new one)." · `mention` "@handles it is for: their inbox, and who may answer. Omitted: your operator." · `wait` "Hold up to 200s for the answer to a choice." · `template`/`data`/`save_as`/`validate_only` one line each.

`GLASSES_REPLY_GUIDANCE` (both copies, byte-equal: `packages/mcp-server/src/tools/channel-source.ts`,
`dopl-desktop-app/main/message-source.js`):
> They are on glasses: reply in at most ~5 short plain-text lines (no tables, code or long lists). Choices or structure: dopl_show (it reaches the lens). Don't ask for what glasses can't do (approve permissions, open files, paste, type long text): do it later on their computer, or say so briefly.

Channel doctrine (`channel-doctrine.ts`, pulled): CHOOSING line becomes
`need a person to DECIDE → dopl_request_decision, or dopl_show with a choice block · anything
structured (options, status, lists, tables) → dopl_show, never prose formatting`.

### 6.2 Nudge (server-side; `display/server/nudge.ts`)

Runs in `postMessage` for an **agent-authored plain send** only: `author_kind='agent'`, stored kind
`message`, no `display`/`escalation`, not a record (`intent !== "chat"`), not a milestone; body ≥ 40
chars. Detection runs on the body with fenced code blocks, inline code and `>` quote lines removed.

- **choice** signal (any):
  - (a) ≥2 lines matching `^\s*(?:\d{1,2}[.)]|[A-Fa-f][.)]|\([A-Fa-f1-9]\)|Option\s+[A-F1-9]\b[:.)]?)\s+\S` AND the body contains `?`;
  - (b) a line matching `/\b(?:should (?:I|we)|shall (?:I|we)|do you want(?: me)?(?: to)?|would you (?:like|prefer)|which (?:one|option|do you)|(?:ok|okay) to|approve)\b[^?\n]{0,160}\bor\b[^?\n]{0,120}\?/i`.
- **structure** signal (any):
  - (a) markdown table: a line with ≥2 `|` followed by a line matching `^\s*\|?\s*:?-{3,}`;
  - (b) ≥3 consecutive list lines `^\s*(?:[-*•]|\d{1,2}[.)])\s+\S`, each ≤100 chars;
  - (c) ≥3 consecutive key-value lines `^\s*[A-Za-z][\w /()-]{0,30}:\s+\S`, each ≤100 chars.
- choice wins over structure. **structure** is throttled to once per agent session per 30 min
  (in-process `TtlCache`, key = session id); **choice** is never throttled (decisions MUST be displays).
- Output: the POST response gains `display_hint?: "choice" | "structure"`
  (`packages/dopl-client` type); the MCP `opPost` result gets ONE extra line (spelled per set via `callRef`):
  - choice: `Tip: a question with options is a decision — send it with dopl_request_decision or dopl_show (a choice block) so they answer in one press, on any device.`
  - structure: `Tip: lists, tables and status read better as a display — dopl_show draws them on desktop and glasses.`
- Nothing is converted, nothing refused, plain chat stays plain.

### 6.3 Metric / log

- `console.info("[display-nudge] " + JSON.stringify({evt:"structured_without_display", hint, signals, channel_id, session_id, chars}))`.
- `console.info("[display] " + JSON.stringify({evt:"display_shown", origin, choice, targets:["channel","glasses"], degraded_level}))`.
- Adoption query (no new table):
  ```sql
  select date_trunc('day', created_at) d,
    count(*) filter (where metadata ? 'display') displays,
    count(*) filter (where metadata ? 'escalation') decisions,
    count(*) filter (where not metadata ? 'display' and not metadata ? 'escalation'
      and body ~ '(^|\n)\s*(\d{1,2}[.)]|[-*•])\s+\S') list_prose
  from channel_messages
  where author_kind = 'agent' and kind = 'message' and created_at > now() - interval '14 days'
  group by 1 order by 1;
  ```

---

## 7. Work split

### 7.1 File ownership (no file has two owners)

**Backend/tools builder** (`~/Downloads/sie-glasses`):
- NEW `src/features/display/**`, `src/app/api/displays/route.ts`, `supabase/migrations/<ts>_unified_display.sql`.
- `src/features/glasses/**` (screens, mcp, menu, messages, platforms incl. `even-g2/*`), glasses API routes.
- `src/app/api/channels/[channelId]/messages/[messageId]/display/{answer,save}/route.ts`.
- `src/features/channels/escalation.ts`, `schema.ts`, `server/**` (service-writes*, fold 11/11b,
  service-writes-device, service-account if needed).
- `packages/mcp-server/**`, `packages/dopl-client/**`.
- `dopl-desktop-app/main/**` (regenerated `dopl-tool-table.json`; `canonicalDoplCall` for
  `dopl_show` → `dopl_channel` send `kind:"display"`; own-channel gate treats an absent `channel`
  as the session channel for `kind:"display"`; `message-source.js` guidance; narration verb
  "showed a display"), `dopl-desktop-app/test/**` for those.
- Docs: this spec (status notes only), `docs/specs/device-aware-messages.md`, `docs/glasses-mcp.md`,
  `docs/INVARIANTS.md` (reserved keys, decision index, one tool, nudge).
- DELETE `scripts/backfill-channel-displays.ts` (one-off, applied).
- FIRST COMMIT (unblocks the renderer): `display/core/{types,normalize,adapt,fallback,answerers}.ts` + tests.

**Renderer builder** (`~/Downloads/sie-glasses`):
- `src/features/channels/components/**` (display-card, display-blocks, NEW display-choice,
  escalation-card-face, view-model*, transcript, message-pane, agent-panel, agent-stream*,
  channel-surface-data; DELETE escalation-card-row, agent-stream-escalation after migration),
  `src/features/channels/hooks/**` (use-display-writes; DELETE use-escalation-writes when unused),
  `src/features/channels/lib/message-device.ts` (`messageDisplayOf` → delegates to `displayOf`),
  their tests, `apps/desktop-ui/src/pages/home/**` only if the Home pane needs wiring,
  `docs/DESIGN-SYSTEM.md`.
- Imports from `@/features/display/core/*` only (never `display/server`).

**Plugin builder** (`~/Downloads/glasses-mcp/plugin`): `src/core/net/dopl.ts`,
`src/core/nav/reader.ts`, `src/core/nav/screens/stream.ts`, `src/platform/even-g2/chat-display.ts`,
their tests. No Dopl-repo files.

### 7.2 Contract points

| # | Between | Contract |
| --- | --- | --- |
| C1 | backend → renderer | `display/core/types.ts`, `adapt.ts › displayOf(metadata, {pageAnswer?})`, `answerers.ts › answerersOf(metadata, authorUserId)` exactly as §2.1/§5.1 |
| C2 | backend → renderer | `POST /api/channels/:c/messages/:m/display/answer {index, block_id?}` → `{ok:true, answer: DisplayAnswerStamp}`; errors 400 `DISPLAY_BAD_CHOICE`, 403 `DISPLAY_NOT_YOURS`, 404 `DISPLAY_NOT_FOUND`, 409 `DISPLAY_ANSWERED`. `…/display/save {name?}` unchanged. Works for legacy decision rows too (renderer answers everything through this route). |
| C3 | backend → plugin | Read mode message `display` (same keys as today): `{screen_id (= display_id), containers, options: {block_id, items, recommended: number \| null} \| null, answer, fallback?, decision?: true}`; items already carry ` (rec)` when it fits. NEW on an ANSWER message: `answer_to?: {message_id, index, choice}` (from `metadata.escalationAnswer`, or `client_msg_id` `display-answer-<id>` on legacy-lane answers). Device answer route unchanged. Lens `screen` payloads unchanged (`spec_version: 1` wire). |
| C4 | backend → reviewer | `dopl_show` schema/results §4; `POST /api/displays` body = the tool args (+ `origin`, `ttl_sec`, `layout`, `shortcut` internal-only for glasses shortcuts, refused from MCP) → `{display_id, message_id?, channel_id?, glasses: "shown"\|"skipped:<r>"\|"off", replaced?, status?, answer?, preview?}` |
| C5 | backend → all | `metadata.display` v2 envelope §2.1; `metadata.escalation` = decision index §5.2 |

### 7.3 Renderer spec (desktop + web)

- `DisplayCard` renders any `Display`. Bar: `Needs Your Decision` (`DECISION_CARD_LABEL`) when the
  display has a `choice`, else `Display`; paint = `decisionCardPaint` (posting agent, black when ended).
  Save button: own agent's displays (`row.side === "me"`), as today.
- Decision face (`display-choice.tsx`), exactly today's escalation card when ANY option has a
  `description`, `recommended` or `why`: per option `AgentPill Option A` + `label: description`;
  `Recommended: [Option X]` + `why` LAST; button strip `Option A…` (aria-label `Option A: label`);
  after an answer the chosen button black, the rest `DECISION_BTN_GREY`, then `You chose` /
  `<Name> chose` + label. Otherwise the inline face (today's display list buttons with labels).
- Buttons only when the viewer ∈ `answerersOf` AND the host passes an answer handler
  (absent-not-disabled: read-only spans). Pending choice shows chosen until the stamp/pre-pass lands.
- Legacy decision rows render through the same card (adapter), keep `data-escalation-id`
  on the shell for existing tests/selectors. The `EscalationRow` kind folds into the message row
  (`display` from `displayOf` with `pageAnswer`).
- Agent stream: compact size step (the stream's existing type steps) for any sent message with a
  display; decisions keep their buttons there.
- Surfaces: report `surfaces changed:` — channels-v2 (web + desktop workspace pages), desktop Home
  pane (via `channel-surface` → transcript), agent stream; `surfaces NOT changed:` anything else.

### 7.4 Migration `unified_display` (additive; apply by NAME, md5-verify)

```sql
-- channel_messages lookup by display id (replace-by-id)
create index if not exists channel_messages_display_id_idx
  on public.channel_messages (channel_id, (metadata->'display'->>'display_id'))
  where metadata ? 'display';

-- replace an UNANSWERED display in place, fenced to its author account; p_escalation null removes the index
create or replace function public.replace_channel_message_display(
  p_message_id uuid, p_author_user_id uuid, p_body text, p_display jsonb, p_escalation jsonb)
returns boolean language plpgsql security definer set search_path = public as $$ … $$;
--   false when: not the author, display.answer not null, or any row has
--   metadata->'escalationAnswer'->>'escalationMessageId' = p_message_id::text

-- stamp the answer once (CAS)
create or replace function public.stamp_channel_message_display_answer(p_message_id uuid, p_answer jsonb)
returns boolean language plpgsql security definer set search_path = public as $$ … $$;
--   sets metadata.display.answer only when metadata ? 'display' and answer is null/absent

revoke all on function … from public, anon, authenticated; grant execute … to service_role;
```
Builder checks `channel_messages` UPDATE triggers (search vector, realtime) behave with a body change.
Verify: `select md5(array_to_string(statements,'')) from supabase_migrations.schema_migrations
where name='unified_display'` = `md5 -q` of the file.

### 7.5 Test plan (targeted during work, full gates at the end of each builder task)

Backend:
- core: every block valid/invalid at each limit; `unknown_key`; ids default/duplicate; one choice;
  one recommended; table shape; `fromV1` table; `displayOf` v2/v1/escalation/garbage→null;
  `displayFromEscalation` → `decisionIndexOf` round-trips every `ESCALATION_BODY_PARITY_CASES` case;
  `displayFallback` per block; `toLensPrimitives` per block × mode × level; G2 `compileScreen` and
  `compileChatDisplay` over degraded primitives (existing compile tests stay green).
- server: routing matrix (target × channel resolvable × glasses paired/online × choice); replace
  unanswered (in place, body updated) vs answered (new message); wait answered/timeout/dismissed and
  the held → `intent:"chat"`/`agentId:null` rule; answer lanes (decision, legacy, 400/403/404/409);
  post-insert hook from press, typed door and raw `escalationAnswer` POST (stamp + lens release);
  lens-tap on a linked decision posts exactly one answer message; nudge table (positives, negatives:
  code fences, quotes, short bodies, records, milestones; throttle).
- MCP/desktop: `tool-manifest.test`, `granular.test` (binding, carry, preset refusal on legacy),
  `call-spelling.test`, `legacy-surface` snapshot re-record, `tool-budget` ceilings,
  `granular-text.test` (450 cap), `channel-source` guidance, desktop `test/message-source.test.mjs`
  parity, `test/dopl-write-op-gating.test.mjs` (dopl_show gated as an own-channel post), glasses
  `tools.test`, `exposure.test`, `menu` read-mode tests.
- Gates: `npm run typecheck`, targeted vitest, `npm run build` (root), `packages/mcp-server` tests,
  desktop `npm test`.

Renderer: display-blocks per block; decision-face parity (migrate the `escalation-card.test.tsx`
and `escalation-agent-stream.test.tsx` expectations onto the display card: bar words, Option A…,
recommendation last, black/grey after answer, answered line, read-only spans, answerers predicate);
legacy row → same DOM as before; v1 row; agent stream. Gates: typecheck, targeted tests, root build.

Plugin: `answer_to` applies an answer to a loaded display page; recommended items; `decision`
header; legacy-decision display page. Test rig only (Vite 5181, simulator 9899, mock 3101) —
never the paired 5180/9898 rig.

### 7.6 Reviewer verification checklist

Use a dedicated test channel (create `display-lab` in Samuel's Home via the LOCAL MCP); every
post there is either a `record` or addressed to nobody live — do not wake agents in Samuel's
other channels. Local MCP = JSON-RPC to `http://127.0.0.1:3100/api/mcp` with a dev token read from a
file (never printed), headers `Accept: application/json, text/event-stream`, `X-Dopl-Tool-Set: granular`.

1. **Repo hygiene**: each builder's commits touch only its §7.1 files; no push; messages end with the
   Co-Authored-By line; deleted files gone (no disarmed leftovers); 500-line cap respected.
2. **Gates**: backend + renderer: `npm run typecheck`, targeted tests, `npm run build`;
   `packages/mcp-server` tests (budget, snapshot, spelling); desktop tests; plugin tests.
3. **Migration**: listed by name `unified_display`; md5 matches the file; both functions
   `service_role`-only (`\df+`); index present.
4. **MCP** (`tools/list`): `dopl_show` listed with §4.1 params; `dopl_send_message` has no `display`;
   `dopl_get_guide` accepts `topic:"displays"`.
5. **dopl_show target channel**, the §2.4 decision example → one message: `metadata.display.spec_version=2`,
   `metadata.escalation` (issue "Ship the migration now?", 2 options, recommendation index 0),
   body = fallback; card renders on web channel page, desktop workspace page, desktop Home pane.
6. **validate_only** with a 12-row table → `glasses: degraded(level 4 …)` + ASCII preview; nothing posted.
7. **Replace**: status example twice with `display_id:"deploy-1"` (value 0.6 → 0.9) → same message id,
   body updated; after answering a decision, re-show with its id → NEW message.
8. **Answer from the app** → member answer message with `escalationAnswer`, `display.answer` stamped
   (`via:"computer"` or `"web"`, `by`, `message_id`), second press → 409; the asking agent is woken
   (desktop dispatch log) when not held.
9. **wait** (`wait:true, timeout_sec:30`), answer within 30s → tool returns `answered …`; the answer
   message has `intent:"chat"` and `escalationAnswer.agentId` null; no second wake.
10. **dopl_request_decision** (unchanged args) → row has strict escalation AND a v2 display built from
    it; card identical to the old card.
11. **Supabase inserts** (service role, through the same insert path the repository uses — check
    `channel_messages` column defaults/seq RPC first): (a) legacy strict `metadata.escalation`, no display →
    renders as a decision card; answering stamps nothing on display (none) but posts the answer;
    glasses read mode returns a `display` with `options` for it; (b) a v1 `metadata.display`
    (selectable list) → renders as a choice via the legacy lane; (c) a garbage `metadata.display` →
    plain body; (d) a relaxed index (7 options, empty consequences) → new UI renders; answering works.
12. **Glasses** (headless device from `scripts/glasses-dev-seed.mjs --out`, test rig): `dopl_show`
    target glasses → `glasses_messages` row `kind='screen'` linked (`channel_message_id`); read mode
    returns the display with `recommended` and ` (rec)`; device answer route → answer message +
    stamp `via:"glasses"`; `answer_to` on the answer message; `glasses_ask`/`glasses_render` still
    return their old shapes; `glasses_show`/`glasses_notify` post nothing to the channel.
13. **Nudge**: an agent plain send with `1. Ship now\n2. Wait?` → result ends with the choice tip and
    a `[display-nudge]` log line; a record or a code-fenced list → no tip; two structure hits within
    30 min in one session → one tip.
14. **Guidance**: a member post with `source.kind="glasses"` → `dopl_read_channel` page ends with the
    new guidance line; desktop copy byte-equal (test).

---

## 8. Open questions

None blocking. Decided here (Samuel may overrule later): tool name `dopl_show`; no `image` block
(CSP); `display` removed from `dopl_send_message`; auto lens push = caller's own online glasses and
choices only; `glasses_show`/`glasses_notify` stay lens notices without a channel copy; the
held-answer record rule (§3.4) with its fallback if `intent:"chat"` still feeds live sessions.

---

## 9. Build status — backend/tools (2026-09-28)

Commits on `feat/glasses-mcp`: `6394ee23` core · `f673c4c0` ladder + templates · `b32f5f77` migration ·
`f388e0c2` display door + channels write path + glasses shortcuts + client · `bf67025d` MCP `dopl_show` +
desktop · `9f1048d7` server tests · (this) docs. Migration `unified_display` applied by NAME; verify with
the §7.4 query against `md5 -q supabase/migrations/20261113120000_unified_display.sql`.

**Open check (§3.4) — outcome.** A member answer with `wake_verdict: none` is NOT fed to running
desktop sessions: `main/session-dispatch.js › planFor` returns `{ids: [], context: false}` for any stored
verdict that names nobody (only `escalationAnswerAgentIds`, `thread`, or a member verdict for this
operator feed), and `feedLiveSession` skips every session that is neither named nor in context. But a
PERSON's `intent:"chat"` is not a record server-side (`service-wake-verdict-record.ts › isRecordPost`
is agent-only), so RR3 would still re-aim it at the room's most recent agent. The held answer therefore
posts `intent:"chat"` **and** `autoAddress:false` (RR3's escape), and fold 11 derives `agentId: null`
(`service-writes-metadata-escalation.ts › isHeld`) → verdict `none`, fed to nobody. The fallback sentence
("The same answer also arrives…") is not needed.

**Deviations from the text above (no cross-builder contract changed):**
1. `display/core/doc.ts` does not exist: `BLOCKS_PARAM_DOC` and the pulled guide live in
   `packages/mcp-server/src/tools/display-doctrine.ts` (the MCP package cannot import `src/`). Extra
   backend modules: `display/core/input.ts` (the post route's `DisplayInputSchema`) and
   `display/server/answer-stamp.ts` (the post-insert hook, apart from `answer.ts` to avoid a
   `service-writes` ↔ `answer` import cycle).
2. `glasses_render` keeps the v1 block input (§4.4) and `spec.ts › BLOCKS_DOC` still describes it; v2
   blocks are `dopl_show`'s. `glasses_show` / `glasses_notify` stay direct lens notices (no hop through
   `/api/displays`; same outcome: no channel copy).
3. The post ack field is `displayHint` (camelCase, the `ChannelMessagePosted` DTO convention).
4. C3 `answer_to` comes from `metadata.escalationAnswer` only; legacy-lane answers stamp the v1 row
   itself, so the plugin reads the answer off the display.
5. C4 result also carries `glasses_message_id`; `status` without `wait` is set only for the glasses
   shortcuts (the lens row's status, `glasses_render`'s old field).
6. The two RPCs are `SECURITY INVOKER` with EXECUTE granted to `service_role` only (the
   `merge_channel_message_display` precedent), not definer.
7. `ChannelEscalationAnswerSchema.optionIndex` max is the stored ceiling (11), since a display decision
   may carry 12 options.

**Verifier round 1 (2026-09-28).** Additions and rulings, backend-only:
8. v1 input keeps v1 bounds: `normalizeDisplay(…, {version: 1})` reads a selectable list as a
   `choice` of 1-19 items with v1 words in its errors; stored rows are read `tolerant` (1-19) and the
   glasses shortcuts re-show `tolerant`. A choice outside 2-12 options is NOT a decision (no index;
   answered through the legacy lane). `glasses_save_template` stores v1 input AS v1 (no
   `spec_version`), not converted — so a one-item list stays usable. `POST /api/displays` takes an
   internal `v1: true` (the shortcuts send raw v1 blocks).
9. A lens choice linked to a decision is answered once (a second tap is 409); a tap that loses to an
   app answer re-syncs the lens row to the stamp and answers 409.
10. Replace-by-id is in place only when the choice-ness is unchanged; otherwise a new message, with
    `replaced_reason: "answered" | "choice changed"` in the result. `auto` without a choice reports
    `glasses=skipped(no choice)` when glasses are online. Blocks holding `{{variables}}` are refused
    unless `data` fills them (`save_as` keeps the placeholders). A glasses compile failure names the
    levels tried (`"tried":"levels 0-N (…)"`). Results always carry `tags=` on a channel post and,
    with `wait`, `by_handle` (`answered 1 \`Ship now\` by \`@handle\` via glasses`).
11. A channel UUID from another of the caller's containers resolves server-side for `dopl_show`
    (unfenced credentials only, membership re-proved). `dopl_send_message` still resolves `channel`
    client-side within the connection's container — pass `container` there (pre-existing, unchanged).
12. `displayOf(metadata, {pageAnswer, messageId})`: a legacy decision's `display_id` falls back to
    `messageId` (additive to C1).

**Verifier round 2 (2026-09-28).**
13. A same-id replace that drops the choice from an OPEN decision posts the new message and
    withdraws the old one in one statement: its decision index goes and its envelope gains
    `superseded_by: <new message id>`. `Display.superseded_by` (optional, additive to C1) — the
    answer route refuses it with 409 `DISPLAY_SUPERSEDED`; **renderer: draw a superseded display
    read-only/closed.**
14. The channel copy of a choice that cannot be a decision (a v1-born list of 1 or 13-19 options) is
    a plain `list` (a record); the lens keeps it tappable. So no new channel row takes the legacy lane.
15. v1 input names two selectable lists as lists. A lens answer's label is the display's option by
    index (the " (rec)" mark is stripped at the lens and never reaches an answer).
