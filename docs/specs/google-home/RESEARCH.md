# Google Home: ways in from third-party code (researched 2026-10-24)

Question: how can a Dopl agent make a Google Home / Nest speaker or display speak, show something,
or control the home, as of October 2026? One row per path; sources at the end of each.

| Path | Speak | Show on Nest Hub | Control devices | Needs | Usable today without Google approval |
| --- | --- | --- | --- | --- | --- |
| Google Cast (LAN) | yes (any audio URL) | yes (image, or audio with title/artwork) | no | same LAN, nothing else | **yes** |
| Google Home APIs (Android/iOS SDK) | no | no | yes | an Android/iOS app, Google account, OAuth, Google Home Developer Console project | no (mobile app, user OAuth) |
| Google Home MCP (early access) | not documented | not documented | yes | US, Google Home Premium Advanced ($20/mo), own Google Cloud project + OAuth client | no (paid, US-only, early access) |
| Google Assistant SDK broadcast | no ("broadcast: No") | no | via queries | Google account, OAuth; experimental, non-commercial only | no (non-commercial, being retired with Assistant) |
| Cloud-to-cloud smart home | no | no | the reverse: exposes YOUR devices to Google | Developer Console project, account linking, certification | no |
| Home Assistant as a bridge | yes (`tts.speak` → Cast) | yes (Cast) | yes (its own integrations) | the user runs Home Assistant; long-lived token | yes, but only for HA users |

## Google Cast (local network)

- Every Google Home, Nest Mini/Audio, Nest Hub and Chromecast is a Cast receiver: TLS on port 8009,
  protobuf `CastMessage` frames, discovered over mDNS as `_googlecast._tcp`. A sender launches the
  public **Default Media Receiver** (app id `CC1AD845`, no registration) and `LOAD`s a media URL.
  The device fetches the URL itself, so the sender must serve it on the LAN.
- Output: audio (MP3, AAC, Opus, Vorbis, FLAC, WAV) on speakers; images (PNG, JPEG, GIF, WEBP, ≤1280x720)
  and audio with title/subtitle/artwork on displays. Custom HTML layouts need a registered custom
  receiver ($5 Cast developer fee, Google review for publishing). Cast is output-only: no input path.
- Interrupts current playback (the Assistant broadcast path resumes it; Cast does not).
- OSS (all MIT): `castv2` (protocol, deps protobufjs@6, last publish 2022), `castv2-client` (2022),
  `chromecast-api` (2023), `@foxxmd/chromecast-client` (TS, 2024), `google-home-notifier` (Cast +
  unofficial Google Translate TTS, 2026-06), `bonjour-service` (mDNS, pure JS, 2026-07),
  `multicast-dns` (2026-04). Python: `pychromecast` (MIT), used by Home Assistant's Cast integration.
- Sources: https://developers.google.com/cast/docs/media (formats, 720p image limit; read 2026-10-24) ·
  https://developers.google.com/cast/docs/web_receiver (default vs custom receivers) ·
  https://github.com/thibauts/node-castv2 (protocol description) · npm registry metadata for the
  packages above (versions, licences, publish dates; read 2026-10-24).

## Google Home APIs

- Kotlin (Android) and Swift (iOS) SDKs: Device and Structure APIs (list, state, commands), an
  Automation API (100+ device signals), a Commissioning API for Matter. Local control of Matter
  devices. Runs inside a mobile app with the user's Google sign-in and permission grant.
- No speak/show-on-speaker primitive. Not reachable from a desktop or server process.
- Sources: https://developers.home.google.com/apis (read 2026-10-24) ·
  https://developers.googleblog.com/en/home-apis-enabling-all-developers-to-build-for-the-home/ (2024-05).

## Google Home MCP (early access, 2026-09-16)

- Google-hosted MCP server (`https://home.googleapis.com/mcp`): inspect devices, read event history
  and camera summaries, run device commands. Rate-limited; sensitive actions (unlocking doors) are
  blocked; creating automations not supported yet. Claude, ChatGPT and others named as clients.
- Gated: US only, Google Home Premium Advanced ($20/month), user's own Google Cloud project and
  OAuth client. No speak/broadcast or display output is documented.
- Sources: https://techcrunch.com/2026/09/16/your-ai-agents-can-now-control-your-google-home-devices/ ·
  https://aicybr.com/blog/google-home-mcp-ai-agents-early-access-guide (both read 2026-10-24).

## Google Assistant SDK

- "Experimental and non-commercial uses only"; its feature table lists broadcast voice messages as
  **not supported**. Home Assistant's `google_assistant_sdk` notify works by sending the text
  "broadcast …" as a query on the user's account (OAuth), which is the unofficial route people use.
- Google began removing Assistant from Android on 2026-09-04 in favour of Gemini; Home speakers and
  displays are excluded for now with no end date given. Building on Assistant queries is a dead end.
- Sources: https://developers.google.com/assistant/sdk/overview (last updated 2024-09-18; read
  2026-10-24) · https://www.implicator.ai/google-sets-september-4-date-to-replace-assistant-with-gemini-on-android/ ·
  https://community.openhab.org/t/how-to-broadcast-message-in-google-home-resuming-what-you-were-listening/145434.

## Cloud-to-cloud smart home

- For device makers: you expose your own cloud's devices to Google Home (SYNC/QUERY/EXECUTE intents,
  account linking, certification). It is the wrong direction for Dopl: it lets Google control Dopl,
  not Dopl speak on a Google speaker.
- Source: https://developers.home.google.com/cloud-to-cloud (read 2026-10-24).

## Home Assistant as a bridge

- HA's Cast integration (pychromecast) plus `tts.speak` / `media_player.play_media` speaks and shows on
  Nest devices; HA also controls lights etc. through its own integrations. REST + long-lived token, and
  HA has its own MCP server integration. Good optional bridge for users who already run HA; not a
  default, since most users do not.
- Sources: https://www.home-assistant.io/integrations/tts/ · https://www.home-assistant.io/integrations/cast/
  (read 2026-10-24).
