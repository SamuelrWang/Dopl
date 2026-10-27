import type { DocBlock, DocPage, DocStatus } from "./types";

/**
 * One page per adapter, plus the Devices overview. ⚠ Status follows
 * `docs/specs/device-sdk/SPEC-v1.md` §4/§5: Even G2 is the only live adapter, the desktop app is
 * beta, everything else is planned and says so. The G2 and desktop matrices mirror the adapters'
 * `describe()` (`src/features/device-sdk/adapters/*`); `content.test.ts` holds them equal.
 */

/** The devices in sidebar order: slug, title, kind, how Dopl reaches it, status. */
export const DEVICE_ROWS: { slug: string; title: string; kind: string; transport: string; status: DocStatus }[] = [
  { slug: "even-realities-g2", title: "Even Realities G2", kind: "glasses", transport: "Dopl plugin in Even Hub", status: "live" },
  { slug: "desktop", title: "Desktop", kind: "desktop", transport: "Dopl desktop app", status: "beta" },
  { slug: "meta", title: "Meta glasses", kind: "glasses", transport: "Meta's official device toolkit", status: "coming_soon" },
  { slug: "mentra", title: "Mentra", kind: "glasses", transport: "A Dopl app on MentraOS", status: "coming_soon" },
  { slug: "home-assistant", title: "Home Assistant", kind: "home_hub", transport: "A local bridge to Home Assistant", status: "coming_soon" },
  { slug: "google-home", title: "Google Home", kind: "home_device", transport: "Google's cloud sign in", status: "coming_soon" },
  { slug: "cars", title: "Cars", kind: "vehicle", transport: "A connected car provider", status: "coming_soon" },
  { slug: "robots", title: "Robots", kind: "robot", transport: "A robotics bridge, simulator first", status: "coming_soon" },
];

/** Capability matrices of the built adapters: [capability, tier, limits]. */
export const G2_MATRIX: [string, string, string][] = [
  ["presence.read", "T0", "Whether the glasses are connected"],
  ["present.notify", "T1", "Title 64 bytes, body 400 bytes, up to 4 lines of 100 bytes"],
  ["present.display", "T1", "576 by 248 pixels, monochrome, 12 blocks, 960 bytes of text, ASCII and box drawing characters"],
  ["ask.choice", "T1", "Question 120 bytes, 2 to 4 options of 40 bytes, holds up to 200 seconds"],
  ["input.utterance", "T1", "What the user says to the glasses"],
  ["input.tap", "T1", "Touchpad taps"],
];

export const DESKTOP_MATRIX: [string, string, string][] = [
  ["presence.read", "T0", "Online when the app has checked in within the last 150 seconds"],
  ["present.notify", "T1", "A notification on the computer"],
];

function matrix(rows: [string, string, string][]): DocBlock {
  return {
    type: "table",
    columns: ["Capability", "Tier", "Limits"],
    rows: rows.map(([cap, tier, limits]) => [`\`${cap}\``, tier, limits]),
  };
}

function device(slug: string, description: string, status: DocStatus, blocks: DocBlock[]): DocPage {
  const row = DEVICE_ROWS.find((d) => d.slug === slug)!;
  return { slug: `devices/${slug}`, tab: "about", group: "Devices", title: row.title, description, status, blocks };
}

/** Not built yet: says so, then the plan and the capability families it targets. */
function planned(slug: string, description: string, plan: string, families: string): DocPage {
  return device(slug, description, "coming_soon", [
    { type: "quote", text: "Not available yet. Nothing is delivered to this device today." },
    { type: "p", text: plan },
    { type: "h2", text: "Planned capabilities" },
    { type: "p", text: families },
  ]);
}

export const DEVICE_PAGES: DocPage[] = [
  {
    slug: "devices",
    tab: "about",
    group: "Devices",
    title: "Devices",
    description: "Every device Dopl supports or plans to support, and where each one stands",
    status: "live",
    blocks: [
      {
        type: "p",
        text: "Each device is reached through an adapter that Dopl builds and maintains against the vendor's official tools, so vendor changes are absorbed in one place. Every adapter publishes the capabilities its device supports.",
      },
      {
        type: "table",
        columns: ["Device", "Kind", "Reached through", "Status"],
        rows: DEVICE_ROWS.map((d) => [
          `[${d.title}](/docs/devices/${d.slug})`,
          `\`${d.kind}\``,
          d.transport,
          d.status === "live" ? "Live" : d.status === "beta" ? "Beta" : "Coming soon",
        ]),
      },
      {
        type: "p",
        text: "Phones and watches are planned as delivery surfaces for routing after these. Every kind will also have a simulated device for testing.",
      },
    ],
  },
  device("even-realities-g2", "Show, ask and notify on your user's glasses", "live", [
    { type: "h2", text: "Supports" },
    {
      type: "list",
      items: [
        "`glasses_show`: a title and up to four lines on the lens, updated in place when you reuse its `card_id`",
        "`glasses_ask`: a question with two to four options, answered from the touchpad; the call holds for up to 200 seconds",
        "`glasses_notify`: a short title and body that clears after its time to live",
        "`glasses_render` and saved templates: screens your agent builds from display blocks, checked against the lens limits that `glasses_capabilities` reports",
      ],
    },
    { type: "h2", text: "Capability matrix" },
    { type: "p", text: "The same glasses in the Device SDK's [capability model](/docs/concepts/devices-and-capabilities):" },
    matrix(G2_MATRIX),
    { type: "h2", text: "Connect it" },
    {
      type: "p",
      text: "The glasses show a six character pairing code. Your user enters it in Dopl while signed in, and from then on the glasses tools appear on every MCP connection that user makes to the [hosted MCP server](/docs/sdks/hosted-mcp).",
    },
  ]),
  device("desktop", "The Dopl desktop app on macOS", "beta", [
    { type: "h2", text: "Supports" },
    {
      type: "list",
      items: [
        "Channel messages, displays and one press decisions your agent posts with `dopl_show`",
        "Presence, so Dopl knows which of your user's computers is online",
      ],
    },
    { type: "h2", text: "Capability matrix" },
    matrix(DESKTOP_MATRIX),
    { type: "h2", text: "Connect it" },
    {
      type: "p",
      text: "Your user signs in to the desktop app and the computer appears under Devices in Settings. Device level actions through the Device SDK are planned.",
    },
  ]),
  planned(
    "meta",
    "Audio first intents on Meta glasses",
    "Planned on Meta's official device toolkit, starting with the Ray-Ban and display models it supports.",
    "Speech and notifications (`present.*`), spoken questions (`ask.*`), voice input (`input.utterance`) and, with an explicit grant, photo and audio capture (`capture.*`)."
  ),
  planned(
    "mentra",
    "Glasses running MentraOS",
    "Planned as a Dopl app on MentraOS, the open glasses platform that runs on glasses from several makers.",
    "Display and notifications (`present.*`), questions (`ask.*`) and voice and touch input (`input.*`)."
  ),
  planned(
    "home-assistant",
    "Lights, media and sensors through Home Assistant",
    "Planned as the first device beyond glasses and computers, through a local bridge to the user's Home Assistant.",
    "State and telemetry (`state.*`), and reversible actions such as lights and media (`act.set`, `act.media`). Locks are T4 and need confirmation on every call."
  ),
  planned(
    "google-home",
    "Devices in the user's Google Home",
    "Planned through Google's cloud, with the user signing in to Google from the Connect flow.",
    "State (`state.*`) and reversible actions such as lights and media (`act.set`, `act.media`)."
  ),
  planned(
    "cars",
    "Intents and commands for connected cars",
    "Planned through a connected car provider rather than one integration per manufacturer, with safety limits enforced outside the model.",
    "Telemetry (`telemetry.read`), navigation (`act.navigate`) and vehicle commands (`act.lock`, `act.motion.vehicle`), which are T4 and confirmed on every call."
  ),
  planned(
    "robots",
    "Intents for robots that work alongside your users",
    "Planned through a robotics bridge, simulator first, with real hardware only under T4 limits enforced outside the model.",
    "Telemetry (`telemetry.read`) and motion (`act.motion.*`), which is T4: confirmed on every call, with speed, area and time limits and a safe stop if the connection drops."
  ),
];
