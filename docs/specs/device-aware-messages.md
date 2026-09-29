# Device-aware messages (contract, 2026-09-28)

Authoritative data contract between the backend and the UI for member message sources, agent-built
displays, and computer renames. Product ask: agents know which device a member wrote from and can
show structured displays in chat as well as on glasses.

## `channel_messages.metadata.source` (reserved, server-written)

Stamped on a MEMBER-authored post (`author_kind = 'user'`) only. Any caller-supplied `source` is
stripped (`service-writes-metadata.ts › resolvePostMetadata`) and re-stamped from the request by
`service-writes.ts › postMessage` off `ChannelContext.messageSource`.

```ts
{ kind: "glasses" | "computer" | "web" | "phone"; device_id?: string; label: string; platform?: string }
```

| Door | Value |
| --- | --- |
| Glasses push-to-talk / Hey Even | `{kind:"glasses", device_id: glasses_device_links.id, label: device name, platform: "even_g2"}` |
| Request with `X-Dopl-Device` naming an active `desktop_devices` row | `{kind:"computer", device_id: desktop_devices.id, label: effective name, platform: "macos"}` |
| Desktop SPA without a resolvable device (`X-Dopl-Runtime: desktop-ui`) | `{kind:"computer", label:"Computer"}` |
| Anything else (browser session) | `{kind:"web", label:"Web"}` |

The desktop SPA's API bridge (`main/ui-bridge.js › sendApiRequest`) sends `X-Dopl-Device` since this
change, so a message typed in the desktop app resolves to its computer (Electron restart required to
pick up the main-process change).

- `label` is a snapshot at write time. The UI shows the live device name when `device_id` resolves
  in the viewer's own device list, else `label`.
- Old rows have no key: render nothing.
- One helper decides it: `src/features/channels/server/message-source.ts` (`requestMessageSource`,
  `glassesMessageSource`). Read side (client-safe): `src/features/channels/lib/message-device.ts`.

## `channel_messages.metadata.display` (reserved, server-written)

> ⚠ **SUPERSEDED 2026-09-28 by docs/specs/unified-display.md** (v2 envelope, one block vocabulary,
> `dopl_show`, decisions as displays, one answer route). What follows is the v1 shape, kept because
> v1 rows still exist and are read at read time through `display/core/adapt.ts › displayOf`.
> `dopl_send_message` no longer takes `display`; the glasses mirror modules named below are deleted.

```ts
{
  spec_version: 1;
  screen_id: string;
  blocks: DisplayBlock[];          // normalized glasses blocks: {id, type, content?, items?, lines?,
                                   //   brightness?, border, selectable, value?, label?, x?, y?, w?, h?}
  layout?: "stack" | "absolute";   // omitted = stack
  wait_for_input?: boolean;        // true = the agent is waiting on the selectable list
  glasses_message_id?: string;     // the linked glasses_messages row, when shown on glasses
  answer?: { block_id: string | null; choice: string; index: number; at: string; via: "glasses" | "computer" | "web" | "phone" } | null;
}
```

- Vocabulary: `src/features/glasses/core/screens/spec.ts` (one schema). Platform-neutral validation:
  `src/features/glasses/core/screens/display.ts › normalizeDisplay` (the G2 compiler is only for glasses).
- Written when:
  1. `glasses_render` / `glasses_use_template` / `glasses_update` / `glasses_ask` run from a Dopl
     channel session (the MCP call carries `X-Dopl-Session-Id` = `<channelId>:…`). The first call posts
     an agent message (`intent: "chat"`, wakes nobody, body = plain-text fallback) with `display`;
     later calls for the same glasses row (same `screen_id`, `glasses_update`) UPDATE that message's
     `metadata.display` in place. A re-render clears `answer` (`null`). `glasses_ask` becomes
     `[{id:"question", type:"text"}, {id:"options", type:"list", selectable:true}]`, `wait_for_input: true`.
     External MCP clients (no session channel) post nothing.
  2. An agent posts a display without glasses: `POST /api/channels/:id/messages` with
     `display: {blocks, layout?, wait_for_input?}` (MCP: `dopl_send_message` `display`). `screen_id`
     is server-generated (`d-xxxxxxxx`); `glasses_message_id` / `answer` are never accepted from a caller.
- Answered on the glasses → the same message's `display.answer` is set (`via: "glasses"`): a tap
  on the lens screen (linked row), or `POST /api/glasses/device/channels/:id/messages/:messageId/display/answer`
  from the glasses' Read / Conversation page (same `answerDisplay` path as the app route).
- Glasses read mode (`GET /api/glasses/device/channels/:id/messages`) adds a per-device `display`
  to such a message: blocks compiled for the platform's chat area, the selectable list as
  `options`, and `answer` (docs/glasses-mcp.md › Menu and read mode › Display messages).

## Endpoints

| Route | Auth | Body | Returns |
| --- | --- | --- | --- |
| `POST /api/channels/:channelId/messages/:messageId/display/answer` | session only (not guests), channel member, message author's account | `{index: number, block_id?: string \| null, choice?: string}` (`choice` is ignored; `index` decides) | `{ok: true, answer}`; 404 `DISPLAY_NOT_FOUND`, 400 `DISPLAY_BAD_CHOICE`, 403 `DISPLAY_NOT_YOURS`, 409 `DISPLAY_ANSWERED` / `DISPLAY_ANSWER_REFUSED` |
| `POST /api/channels/:channelId/messages/:messageId/display/save` | any member credential (not guests), channel member | `{name?: string}` (slugified to `a-z0-9_-`, ≤64; default from the first text line) | `{name, variables, updated_at}` (the caller's `glasses_templates` row); 400 `DISPLAY_NOT_A_TEMPLATE` when it exceeds the glasses limits |
| `PATCH /api/devices/:id` | session | `{name: string \| null}` (≤64 chars; `null`/blank restores the detected name) | `{device: ComputerDeviceDto}`; 404 for a legacy/removed/foreign computer |

- Code: `src/features/glasses/core/screens/display-actions.ts` (answer, save), `channel-mirror.ts`
  (post/patch/answer mirror, best effort), `channel-displays.ts` (the real ports).
- A list block is selectable unless `selectable: false` (the glasses default). Agents are told to pass
  `selectable: false` on info-only lists; the UI renders every selectable list as answer buttons.
- Answer with a linked glasses row runs the glasses answer path (`inbox.ts › answerAsk`), so a waiting
  `glasses_ask` / `wait_for_input` hold returns `answered` exactly as for a tap on the lens.
- Answer on a channel-only display also posts the choice as the member's message addressed to the
  authoring agent (so it is woken), with `metadata.source` stamped.
- `GET /api/devices` → each computer's `name` is the effective name (override ?? detected);
  `detected_name` carries the detected one; `renamed: boolean`.

## Agent-facing rendering

- `dopl_read_channel` / `await` lines: a member line gains ` · via glasses (Even G2)` /
  ` · via computer (Samuel's MacBook Pro)` / ` · via web`. When the newest member line on a page came
  from glasses, the page ends with ONE guidance line (`GLASSES_REPLY_GUIDANCE`).
- `dopl_get_status` waiting items: ` · via …` on the item (`AccountWaitingItem.source = {kind, label}`).
- `dopl_send_message` carries an optional `display: {blocks, layout?, wait_for_input?}` (granular only, `carry` in
  `tool-manifest.ts`; strict — an unknown key refuses) on a plain send AND on `kind="record"`. `kind="milestone"`
  and `thread="new"` REFUSE a display rather than drop it (`channel-ops-write.ts › displayLaneRefusal`).
- Desktop session inbound (Claude/Codex): one note line above the fence (`Sent via glasses (Even G2).`)
  plus the guidance line for glasses (`main/session-seed.js › frameContinuation`, fed from
  `session-dispatch.js` through the gate/reducer as `source`).
- Guidance text: `packages/mcp-server/src/tools/channel-source.ts › GLASSES_REPLY_GUIDANCE`
  (desktop restates it in `dopl-desktop-app/main/message-source.js`, parity-tested).

## Schema

`supabase/migrations/20261112120000_device_aware_messages.sql` (additive; applied by name as
`device_aware_messages`): `desktop_devices.display_name`, `glasses_messages.channel_message_id`
(soft link, no FK), `public.merge_channel_message_display(message, author, patch)` (service_role only).
Verify: `select md5(array_to_string(statements, '')) from supabase_migrations.schema_migrations where
name = 'device_aware_messages'` against `md5 -q` of the file.
