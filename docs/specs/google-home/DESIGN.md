# Google Home: design (2026-10-24, branch feat/google-home)

## Decision

**Google Cast over the LAN, sent from the Dopl desktop app's machine, exposed as a local stdio MCP
server `dopl-google-home`.** It is the only path in [RESEARCH.md](RESEARCH.md) that speaks on a
speaker and shows on a Nest Hub today with no Google account, no OAuth, no subscription and no
Google approval. Home APIs need a mobile app and user OAuth; Home MCP is US-only, $20/month and
early access, and documents no speak/show output; the Assistant SDK is non-commercial and has no
broadcast. Those are listed under Later.

Cast is LAN-only, so the sender must sit on the user's network. Dopl is local-first: the desktop
app already runs there. The hosted `/api/mcp` on Vercel cannot reach a speaker in someone's
kitchen, which is why this first cut is a local MCP server and not a hosted tool.

## Shape (mirrors the glasses device)

| Glasses | Google Home |
| --- | --- |
| `glasses_status` | `google_home_status` (mDNS rescan; `display` = has a screen) |
| `glasses_capabilities` | `google_home_capabilities` (`ask.supported: false`, with the reason) |
| `glasses_notify` | `google_home_notify` (spoken; or `audio_url`) |
| `glasses_show` | `google_home_show` (1280x720 card on a Nest Hub; `speak` reads it too) |
| `glasses_ask` | none: Cast is output-only, no answer can come back |
| — | `device_status` / `device_command` (2026-10-27): what is playing + the commands the device accepts now; send one |

### Device control (2026-10-27)

Generic by construction: the tool pair is named for devices, not Google, and the command list is read
off the device (`device-control.js › commandsFor`), so no tool is ever added per app or per command.
Cast gives `set_volume`, `mute`, `unmute` (receiver), `stop` (receiver STOP of the running session, any
app) and `pause` / `play` (media namespace, when the app reports it). Choosing what to play and
smart-home devices stay out of scope (Google Home MCP / Home Assistant).

Result shape is the glasses one: one JSON text block, `isError` with a fixable sentence on refusal.

## Code (`dopl-desktop-app/main/google-home/`)

- `discovery.js` — mDNS `_googlecast._tcp` via `bonjour-service` (MIT); TXT `fn`/`md`/`ca` → rows;
  `ca` bit 0 = screen; `Google Cast Group` rows are groups (never auto-picked).
- `cast-frame.js` + `cast-client.js` — Cast v2 sender written here (protobuf frame by hand, ~250 lines)
  instead of `castv2` (MIT), whose protobufjs@6 dependency has a prototype-pollution history.
  CONNECT → LAUNCH `CC1AD845` (Default Media Receiver) → CONNECT transport → LOAD. Self-signed device
  certificate accepted, as every Cast sender does.
- `render.js` — speech by macOS `say` (AAC .m4a), cards as SVG → PNG by macOS `sips`. Text never
  leaves the machine except to the user's speaker; no Google Translate TTS (unofficial, ToS risk).
- `media-server.js` — the device pulls media by URL, so files are served on the LAN interface that
  shares the device's subnet, under a random 128-bit path, deleted after 5 minutes; anything else 404s.
- `service.js` — device resolution (id or name; omitted = the only speaker / only screen), limits.
- `device-control.js` — receiver/media status → state + accepted commands; one command sent.
- `mcp-tools.js` + `mcp-stdio.js` — the six tools; `--discover` prints rows and exits.

Tests: `dopl-desktop-app/test/google-home-{cast,service}.test.mjs` — fake socket, stubbed discovery,
cast, speech, card and media; nothing reaches a device.

## Limits accepted for v1

Interrupts playback and does not resume it; plays at current volume; Mac must be awake on the same
network; macOS-only rendering (else `audio_url`/`image_url`); fixed card layout (custom HTML needs a
registered custom receiver); no answers.

## Later

1. **Hosted routing** — `show`/`notify` on `/api/mcp` and REST reach Google Home: the server queues
   the intent and the user's desktop (same LAN) executes it, the delivery-keystone pattern
   (INVARIANTS §5). Needs a queue table (migration) and a desktop pull loop.
2. **Desktop agents get the tools by default** — inject `dopl-google-home` into Dopl-launched sessions,
   gated by containment profile like `profileOffersGlasses`.
3. **Smart-home device control** — Google Home MCP when it leaves early access (agent connects to Google
   directly; Dopl can list it), or Home APIs via a Dopl phone app.
4. **Resume-after-message** — a custom receiver or Home MCP if it gains a broadcast tool.
5. **Home Assistant bridge** for users who run HA.
