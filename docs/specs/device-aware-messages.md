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

- `label` is a snapshot at write time. The UI shows the live device name when `device_id` resolves
  in the viewer's own device list, else `label`.
- Old rows have no key: render nothing.
- One helper decides it: `src/features/channels/server/message-source.ts` (`requestMessageSource`,
  `glassesMessageSource`). Read side (client-safe): `src/features/channels/lib/message-device.ts`.

## `channel_messages.metadata.display` (reserved, server-written)

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
- Answered on the glasses → the same message's `display.answer` is set (`via: "glasses"`).

## Endpoints

| Route | Auth | Body | Returns |
| --- | --- | --- | --- |
| `POST /api/channels/:channelId/messages/:messageId/display/answer` | session, channel member, message author's account | `{index: number, block_id?: string \| null, choice?: string}` | `{ok: true, answer}`; 404 no display/list, 403 not the author, 409 already answered/expired |
| `POST /api/channels/:channelId/messages/:messageId/display/save` | session, channel member | `{name?: string}` (slugified to `a-z0-9_-`, ≤64; default from the first text line) | `{name, variables, updated_at}` (the caller's `glasses_templates` row) |
| `PATCH /api/devices/:id` | session | `{name: string \| null}` (1-64 chars; `null`/`""` restores the detected name) | `{device: ComputerDeviceDto}` |

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
- `dopl_get_status` waiting items: ` · via …` on the item.
- Desktop session inbound (Claude/Codex): one note line above the fence (`via glasses (Even G2)`) plus
  the guidance line for glasses.
- Guidance text: `packages/mcp-server/src/tools/channel-source.ts › GLASSES_REPLY_GUIDANCE`
  (desktop restates it in `dopl-desktop-app/main/message-source.js`, parity-tested).
