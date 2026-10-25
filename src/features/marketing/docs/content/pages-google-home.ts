import type { DocPage } from "./types";

const APP = "/Applications/Dopl.app/Contents";
const ADD_CLAUDE = `claude mcp add dopl-google-home \\
  -e ELECTRON_RUN_AS_NODE=1 \\
  -- ${APP}/MacOS/Dopl ${APP}/Resources/app.asar/main/google-home/mcp-stdio.js`;
const ADD_JSON = `{
  "mcpServers": {
    "dopl-google-home": {
      "command": "${APP}/MacOS/Dopl",
      "args": ["${APP}/Resources/app.asar/main/google-home/mcp-stdio.js"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}`;

/** Google Home / Nest over Cast on the local network, sent from the user's Mac. */
export const GOOGLE_HOME_PAGE: DocPage = {
  slug: "devices/google-home",
  tab: "about",
  group: "Devices",
  title: "Google Home",
  description: "Speak on Google Home and Nest speakers, and show cards on a Nest Hub",
  blocks: [
    { type: "h2", text: "Supports" },
    {
      type: "list",
      items: [
        "`notify` — says a message out loud on a Google Home or Nest speaker",
        "`show` — puts a card (title and up to six lines) on a Nest Hub or Nest Hub Max, optionally read aloud",
        "`status` — lists the speakers and displays on the network, and which have a screen",
      ],
    },
    {
      type: "p",
      text: "`ask` is not supported. Cast only plays to the speaker, so no answer can come back. Use glasses, phone or desktop for questions.",
    },
    { type: "h2", text: "How it works" },
    {
      type: "p",
      text: "Dopl reaches the speaker with Google Cast from the user's Mac, over the local network. No Google account, sign-in or Google approval is needed. Speech is made with the Mac's own voice and cards are drawn on the Mac, so the text goes only to the user's speaker.",
    },
    { type: "h2", text: "Set it up" },
    {
      type: "steps",
      items: [
        {
          title: "Same network",
          blocks: [
            {
              type: "p",
              text: "The Mac running the Dopl desktop app and the Google Home must be on the same Wi-Fi network. Guest networks and networks that block device-to-device traffic will not work.",
            },
          ],
        },
        {
          title: "Add the Google Home tools to your agent",
          blocks: [
            { type: "p", text: "They run on the Mac as a local MCP server named `dopl-google-home`." },
            {
              type: "code",
              tabs: [
                { label: "Claude Code", code: ADD_CLAUDE },
                { label: "MCP config", code: ADD_JSON },
              ],
            },
          ],
        },
        {
          title: "Check the speaker is found",
          blocks: [
            {
              type: "p",
              text: "Ask your agent to call `google_home_status`. The first time, macOS may ask to allow incoming connections for Dopl: allow it, because the speaker fetches the audio from the Mac.",
            },
          ],
        },
      ],
    },
    { type: "h2", text: "Tools" },
    {
      type: "table",
      columns: ["Tool", "What it does"],
      rows: [
        ["`google_home_status`", "Scans the network (about 3 seconds) and lists devices"],
        ["`google_home_capabilities`", "What works and the limits, including that `ask` is not supported"],
        ["`google_home_notify`", "Speaks `text`, or plays your own `audio_url`"],
        ["`google_home_show`", "Shows a card on a device with a screen; `speak: true` also reads it"],
      ],
    },
    {
      type: "p",
      text: "`device` takes an id or a name from `google_home_status`. Leave it out when there is only one speaker (or, for `show`, one screen).",
    },
    { type: "h3", text: "google_home_status" },
    {
      type: "code",
      tabs: [
        { label: "Request", code: "{}" },
        {
          label: "Response",
          code: `{
  "online": true,
  "count": 2,
  "devices": [
    { "id": "8a1f…", "name": "Kitchen display", "model": "Google Nest Hub", "display": true, "group": false },
    { "id": "c03e…", "name": "Office speaker", "model": "Google Home", "display": false, "group": false }
  ]
}`,
        },
      ],
    },
    { type: "h3", text: "google_home_notify" },
    {
      type: "code",
      tabs: [
        { label: "Request", code: '{\n  "text": "Your build finished. All tests passed.",\n  "device": "Office speaker"\n}' },
        {
          label: "Response",
          code: `{
  "ok": true,
  "device": { "id": "c03e…", "name": "Office speaker", "model": "Google Home", "display": false, "group": false },
  "status": "BUFFERING",
  "media_session_id": 1
}`,
        },
      ],
    },
    { type: "h3", text: "google_home_show" },
    {
      type: "code",
      tabs: [
        { label: "Request", code: '{\n  "title": "Flight UA 212",\n  "lines": ["Gate B14", "Boards 9:40"],\n  "speak": true\n}' },
        {
          label: "Response",
          code: `{
  "ok": true,
  "device": { "id": "8a1f…", "name": "Kitchen display", "model": "Google Nest Hub", "display": true, "group": false },
  "status": "BUFFERING",
  "media_session_id": 1
}`,
        },
      ],
    },
    { type: "h2", text: "Limits" },
    {
      type: "list",
      items: [
        "`notify` text: 500 characters. `show`: title 80 characters, up to 6 lines of 120.",
        "A message interrupts whatever the speaker is playing, and plays at its current volume.",
        "The Mac must be awake and on the same network. Speech and cards are made with macOS; on other systems pass `audio_url` or `image_url`.",
        "Speaker groups are listed but never picked automatically; name one with `device` to use it.",
        "The card is a fixed layout. For your own design, pass an `image_url` (PNG or JPEG, up to 1280 × 720).",
      ],
    },
    { type: "h2", text: "Coming soon" },
    {
      type: "list",
      items: [
        "Routing from the hosted API and MCP, so `show` and `notify` reach a Google Home without the local server.",
        "Controlling lights, thermostats and other devices, through Google's Home APIs and Home MCP.",
        "Messages that resume what was playing afterwards.",
      ],
    },
  ],
};
