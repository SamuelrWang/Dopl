import { ASK_HOLD_MAX_S, type CapabilityId, type DeviceKind } from "@dopl/contracts/device-sdk";

import { GLASSES_LIMITS as L } from "@/features/glasses/core/validation";
import { PRESENT_DISPLAY_LIMITS as D } from "@/features/glasses/platforms/even-g2/display";

import { capabilityCard, type CardSpec } from "./capability-cards";
import { G2_ASK_DESCRIPTOR } from "./pages-concepts";
import { DEVICE_ID } from "./shared";
import type { DocBlock, DocIcon, DocPage, DocStatus, ModelSupport } from "./types";

/**
 * Device CATEGORIES: capability groups, not brands. Each category page has the same shape: its
 * models and a model × capability badge grid, then "What your agent receives" (device → agent)
 * and "What your agent can send" (agent → device), every capability in the one card
 * (`capability-cards.ts`). What every category shares lives in Core and is linked, never repeated.
 *
 * ⚠ BADGES ARE THE API's STATUS (`/v1`, the code on the card). A model is `live` for a capability
 * only when its adapter's `describe()` publishes it AND the production dispatcher delivers it
 * (`server/device-adapters.ts › wiredDeviceAdapters`); `content.test.ts` checks both. Even G2 is
 * the only such model on 2026-10-27. Limits are read from the G2 platform's own constants, the
 * same ones `adapters/even-g2.ts` derives its descriptors from.
 */

const LIVE: DocStatus = "live";
const SOON: DocStatus = "coming_soon";

/** Lens lifetimes of an SDK delivery (`server/glasses/even-g2-dispatch.ts › SDK_*_TTL_S`; pinned in `built.test.ts`). */
export const G2_TTL_S = { notify: 60, screen: 600, ask: 600 };

const soon = (model: string, note?: string): ModelSupport => ({ model, status: SOON, ...(note ? { note } : {}) });
const NOT_CONNECTED = "Set by each device's descriptor. No model in this category is connected yet.";

export interface Category {
  slug: string;
  title: string;
  icon: DocIcon;
  description: string;
  kinds: DeviceKind[];
  /** Model name → how Dopl reaches it. Status is derived from the cards' support, never set here. */
  models: { name: string; reach: string }[];
  /** Brands in this category Dopl has no integration for, named under the model cards. */
  unsupported?: string[];
  notes?: string[];
  receives: CardSpec[];
  sends: CardSpec[];
  /** Says why there is nothing under "receives". */
  receivesNone?: string;
}

const G2 = "Even Realities G2";
const MENTRA = "Mentra";

const DISPLAY_GLASSES: Category = {
  slug: "display-glasses",
  title: "Display glasses",
  icon: "glasses",
  description: "Heads up display glasses: cards, questions and notifications on the lens",
  kinds: ["glasses"],
  models: [
    { name: G2, reach: "The Dopl plugin in Even Hub, Even's official plugin runtime" },
    { name: MENTRA, reach: "A Dopl app on MentraOS" },
  ],
  unsupported: ["Rokid", "XREAL", "Vuzix", "Brilliant Labs", "INMO"],
  receives: [
    {
      capability: "ask.choice",
      title: "Answers to a question",
      what: "The option the user picked on a question you sent, read from the action. Use it to branch on a decision without parsing free text.",
      limits: [
        `The question stays on the lens for ${G2_TTL_S.ask / 60} minutes. \`dopl.ask\` waits up to ${ASK_HOLD_MAX_S} seconds, then returns \`timeout\` and you can keep reading the action.`,
        "A dismissed question completes with `dismissed: true` and no label.",
      ],
      call: "answer",
      result: { lens_message_id: "b3f0c2a8-91de-4c57-a1f6-0e4d8b2c7a93", index: 0, label: "Yes", answered_at: "2026-10-27T17:05:09Z" },
      support: [{ model: G2, status: LIVE, note: "Answered from the touchpad" }, soon(MENTRA)],
    },
    {
      capability: "presence.read",
      title: "Online status",
      what: "Whether the glasses are connected and when they were last seen. Check it before sending something time sensitive.",
      limits: ["`online` uses the same window as the glasses' own device list."],
      call: "device",
      device: {
        id: DEVICE_ID,
        kind: "glasses",
        vendor: "even_realities",
        model: "even_g2",
        firmware: null,
        adapter_id: "even_g2",
        adapter_version: "0.1.0",
        capabilities: [G2_ASK_DESCRIPTOR],
        online: true,
        last_seen_at: "2026-10-27T17:04:58Z",
      },
      support: [{ model: G2, status: LIVE }, soon(MENTRA)],
    },
    {
      capability: "input.utterance",
      title: "Voice transcripts",
      what: "What the user says to the glasses, as text. Use it to let the user start or steer your agent hands free.",
      limits: ["Not recorded for API end users yet, so `source_of_last_message` in [Get context](/docs/api-reference/context) stays `null`."],
      call: "event",
      support: [
        soon(G2, "Published in the G2 descriptor. Agents on the [hosted MCP](/docs/sdks/hosted-mcp) get it today as a message in the glasses' linked channel"),
        soon(MENTRA),
      ],
    },
    {
      capability: "input.tap",
      title: "Taps",
      what: "Touchpad taps outside a question, such as a tap to open your agent.",
      limits: ["A tap that answers a question already arrives as that question's answer, above."],
      call: "event",
      support: [soon(G2, "Published in the G2 descriptor, not delivered to the API yet"), soon(MENTRA)],
    },
  ],
  sends: [
    {
      capability: "present.display",
      title: "Show a card",
      what: "A screen built from [display blocks](/docs/concepts/displays): a heading, text, a list, fields. Use it for status the user glances at.",
      limits: [
        `${D.width_px} by ${D.height_px} pixels, monochrome, up to ${D.max_blocks} blocks and ${D.max_text_bytes} bytes of text.`,
        "ASCII and box drawing characters only: curly quotes are straightened and emoji are dropped. Image blocks are refused.",
        `Stays on the lens for ${G2_TTL_S.screen / 60} minutes. Content that does not fit is refused with \`invalid_request\`, never shortened.`,
        "Updating a card in place is not in the API yet: each call shows a new card. On the [hosted MCP](/docs/sdks/hosted-mcp), `glasses_show` with the same `card_id` or `glasses_update` replaces it live.",
      ],
      call: "action",
      args: {
        blocks: [
          { id: "title", type: "heading", text: "Flight UA 212" },
          { id: "gate", type: "text", content: "Gate B14. Boards 9:40" },
        ],
      },
      support: [{ model: G2, status: LIVE }, soon(MENTRA)],
    },
    {
      capability: "ask.choice",
      title: "Ask a question",
      what: "A question with options the user picks from the touchpad. Use it when your agent needs a decision before it continues.",
      limits: [
        `Question up to ${L.question} bytes, ${L.options.min} to ${L.options.max} options of up to ${L.option} bytes each.`,
        "Read the answer under What your agent receives, or call `dopl.ask`, which sends and waits in one call.",
      ],
      call: "action",
      args: { question: "Book the 9:40 flight?", options: [{ label: "Yes" }, { label: "No" }] },
      support: [{ model: G2, status: LIVE }, soon(MENTRA)],
    },
    {
      capability: "present.notify",
      title: "Notify",
      what: "A short title and body that clears on its own. Use it for something the user should know now but need not act on.",
      limits: [
        `Title up to ${L.title} bytes, body up to ${L.body} bytes, shown as up to ${L.lines.max} lines of ${L.line} bytes.`,
        `Clears after ${G2_TTL_S.notify} seconds.`,
      ],
      call: "action",
      args: { title: "Build finished", body: "main passed in 4m 12s" },
      support: [{ model: G2, status: LIVE }, soon(MENTRA)],
    },
  ],
};

const AUDIO_GLASSES: Category = {
  slug: "audio-glasses",
  title: "Audio and camera glasses",
  icon: "headphones",
  description: "Glasses without a display: speech, spoken questions, voice and the camera",
  kinds: ["glasses"],
  models: [{ name: "Meta glasses", reach: "Meta's official device toolkit, starting with the Ray-Ban models it supports" }],
  unsupported: ["Amazon Echo Frames", "Solos"],
  receives: [
    { capability: "input.utterance", title: "Voice transcripts", what: "What the user says, as text.", limits: [NOT_CONNECTED], call: "event", support: [soon("Meta glasses")] },
    { capability: "capture.photo", title: "Photos", what: "A photo from the glasses' camera, taken when your agent asks. T2: the user must tick it on the consent screen.", limits: [NOT_CONNECTED], call: "read", responseFrom: "test", support: [soon("Meta glasses")] },
    { capability: "capture.audio", title: "Audio clips", what: "A recording from the glasses' microphones, taken when your agent asks.", limits: [NOT_CONNECTED], call: "read", responseFrom: "test", support: [soon("Meta glasses")] },
  ],
  sends: [
    { capability: "present.speak", title: "Speak", what: "Text read aloud in the user's ear.", limits: [NOT_CONNECTED], call: "action", args: { text: "Your 3pm moved to 3:30." }, responseFrom: "test", support: [soon("Meta glasses")] },
    { capability: "present.notify", title: "Notify", what: "A short notification, spoken on glasses without a display.", limits: [NOT_CONNECTED], call: "action", args: { title: "Build finished", body: "main passed" }, responseFrom: "test", support: [soon("Meta glasses")] },
    { capability: "ask.confirm", title: "Ask to confirm", what: "A yes or no question the user answers by voice. The answer comes back on the action as `confirmed`.", limits: [NOT_CONNECTED], call: "action", args: { question: "Send the reply to Ana?" }, responseFrom: "test", support: [soon("Meta glasses")] },
  ],
};

const GH = "Google Home";
const HA = "Home Assistant";
const GH_LOCAL = "Built as a local MCP server in the Dopl desktop app (`google_home_notify`), not in a release yet";

const SMART_HOME: Category = {
  slug: "smart-home",
  title: "Smart home",
  icon: "speaker",
  description: "Speakers, smart displays and home devices: speech, cards, state and reversible actions",
  kinds: ["home_hub", "home_device"],
  models: [
    { name: GH, reach: "Google Cast over the local network, from the user's Mac" },
    { name: HA, reach: "A local bridge to the user's Home Assistant" },
  ],
  unsupported: ["Amazon Alexa", "Apple Home"],
  notes: [
    "Google Home is output only. Cast plays to the speaker and no answer can come back, so Google Home has nothing under What your agent receives.",
  ],
  receives: [
    { capability: "state.read", title: "Device state", what: "The current state of a home device, such as whether a light is on.", limits: [NOT_CONNECTED], call: "read", responseFrom: "test", support: [soon(HA)] },
    { capability: "telemetry.read", title: "Sensor readings", what: "Readings such as temperature or energy use.", limits: [NOT_CONNECTED], call: "read", responseFrom: "test", support: [soon(HA)] },
  ],
  sends: [
    { capability: "present.speak", title: "Speak", what: "A message said out loud on a speaker. It interrupts what the speaker is playing.", limits: ["Google Home: 500 characters, at the speaker's current volume. The Mac must be awake on the same network."], call: "action", args: { text: "Your build finished. All tests passed." }, responseFrom: "test", support: [soon(GH, GH_LOCAL), soon(HA)] },
    { capability: "present.display", title: "Show a card", what: "A card on a smart display, optionally read aloud.", limits: ["Google Home: Nest Hub and Nest Hub Max only. Title up to 80 characters and up to 6 lines of 120."], call: "action", args: { blocks: [{ id: "title", type: "heading", text: "Flight UA 212" }] }, responseFrom: "test", support: [soon(GH, "Built as `google_home_show` in the same local MCP server, not in a release yet"), soon(HA)] },
    { capability: "act.set", title: "Set a device", what: "A reversible change such as turning on a light. The arguments are defined with the first home adapter.", limits: [NOT_CONNECTED], call: "action", responseFrom: "test", support: [soon(GH, "Planned through Google's Home APIs"), soon(HA)] },
    { capability: "act.media", title: "Control media", what: "Play, pause or change what a speaker or TV is playing.", limits: [NOT_CONNECTED], call: "action", responseFrom: "test", support: [soon(GH), soon(HA)] },
    { capability: "act.lock", title: "Lock or unlock", what: "Locks are T4, so the default profile denies them even when the user ticked them.", limits: [NOT_CONNECTED], call: "action", responseFrom: "test", support: [soon(HA)] },
  ],
};

const PHONES: Category = {
  slug: "phones",
  title: "Phones",
  icon: "phone",
  description: "Notifications, screens and questions on your user's phone",
  kinds: ["phone"],
  models: [{ name: "Phone", reach: "Push to the user's phone. It is the first kind in the routing fallback order" }],
  receives: [
    { capability: "input.utterance", title: "Voice transcripts", what: "What the user says to the phone, as text.", limits: [NOT_CONNECTED], call: "event", support: [soon("Phone")] },
    { capability: "input.tap", title: "Taps", what: "Taps on a screen your agent showed.", limits: [NOT_CONNECTED], call: "event", support: [soon("Phone")] },
  ],
  sends: [
    { capability: "present.notify", title: "Notify", what: "A push notification.", limits: [NOT_CONNECTED], call: "action", args: { title: "Build finished", body: "main passed in 4m 12s" }, responseFrom: "test", support: [soon("Phone")] },
    { capability: "present.display", title: "Show a card", what: "A screen built from display blocks. Long replies that do not fit on glasses go here.", limits: [NOT_CONNECTED], call: "action", args: { blocks: [{ id: "title", type: "heading", text: "Deploy ready" }] }, responseFrom: "test", support: [soon("Phone")] },
    { capability: "ask.choice", title: "Ask a question", what: "A question with options as notification buttons.", limits: [NOT_CONNECTED], call: "action", args: { question: "Ship it?", options: [{ label: "Yes" }, { label: "No" }] }, responseFrom: "test", support: [soon("Phone")] },
  ],
};

const DESKTOP_NOTE = "The Dopl desktop app takes notices only while signed in to a Dopl account, so the API refuses delivery with `capability_unsupported` today";

const COMPUTERS: Category = {
  slug: "computers",
  title: "Computers",
  icon: "desktop",
  description: "The Dopl desktop app on your user's Mac",
  kinds: ["desktop"],
  models: [{ name: "Dopl desktop app", reach: "Dopl's own app on macOS" }],
  unsupported: ["Windows", "Linux"],
  receives: [
    { capability: "presence.read", title: "Online status", what: "Whether the computer is on and the app has checked in recently.", limits: ["Online when the app checked in within the last 150 seconds."], call: "read", responseFrom: "test", support: [soon("Dopl desktop app", DESKTOP_NOTE)] },
  ],
  sends: [
    { capability: "present.notify", title: "Notify", what: "A system notification on the computer.", limits: [NOT_CONNECTED], call: "action", args: { title: "Build finished", body: "main passed" }, responseFrom: "test", support: [soon("Dopl desktop app", DESKTOP_NOTE)] },
  ],
};

const VEHICLES: Category = {
  slug: "vehicles",
  title: "Vehicles",
  icon: "car",
  description: "Telemetry, navigation and commands for connected cars",
  kinds: ["vehicle"],
  models: [{ name: "Cars", reach: "A connected car provider rather than one integration per manufacturer" }],
  notes: ["Vehicle commands are T4. The default profile denies them, and safety limits are enforced outside the model."],
  receives: [
    { capability: "telemetry.read", title: "Telemetry", what: "Location, charge or fuel, and odometer.", limits: [NOT_CONNECTED], call: "read", responseFrom: "test", support: [soon("Cars")] },
  ],
  sends: [
    { capability: "act.navigate", title: "Navigate", what: "Send a destination to the car's navigation.", limits: [NOT_CONNECTED], call: "action", responseFrom: "test", support: [soon("Cars")] },
    { capability: "act.lock", title: "Lock or unlock", what: "Lock or unlock the car. T4.", limits: [NOT_CONNECTED], call: "action", responseFrom: "test", support: [soon("Cars")] },
    { capability: "act.motion.vehicle", title: "Move the vehicle", what: "Vehicle motion such as summon. T4.", limits: [NOT_CONNECTED], call: "action", responseFrom: "test", support: [soon("Cars")] },
  ],
};

const ROBOTS: Category = {
  slug: "robots",
  title: "Robots",
  icon: "robot",
  description: "Telemetry and motion for robots that work alongside your users",
  kinds: ["robot"],
  models: [{ name: "Robots", reach: "A robotics bridge, simulator first" }],
  notes: ["Motion is T4: confirmed on every call, with speed, area and time limits and a safe stop if the connection drops."],
  receives: [
    { capability: "telemetry.read", title: "Telemetry", what: "Pose, battery and joint state.", limits: [NOT_CONNECTED], call: "read", responseFrom: "test", support: [soon("Robots")] },
  ],
  sends: [
    { capability: "act.motion.move", title: "Move", what: "Move the robot or its arm. T4.", limits: [NOT_CONNECTED], call: "action", responseFrom: "test", support: [soon("Robots")] },
    { capability: "act.motion.gripper", title: "Gripper", what: "Open or close a gripper. T4.", limits: [NOT_CONNECTED], call: "action", responseFrom: "test", support: [soon("Robots")] },
  ],
};

export const CATEGORIES: Category[] = [DISPLAY_GLASSES, AUDIO_GLASSES, SMART_HOME, PHONES, COMPUTERS, VEHICLES, ROBOTS];

/** A category is as live as its best model badge. */
export function categoryStatus(c: Category): DocStatus {
  const all = [...c.receives, ...c.sends].flatMap((s) => s.support.map((m) => m.status));
  return all.includes("live") ? "live" : all.includes("beta") ? "beta" : "coming_soon";
}

/** Sidebar rows, in order. */
export const CATEGORY_ROWS = CATEGORIES.map((c) => ({ slug: c.slug, title: c.title, icon: c.icon }));

/** Model × capability: the best badge a model has on any card for that capability, or null. */
function grid(c: Category): DocBlock {
  const caps = [...new Set([...c.receives, ...c.sends].map((s) => s.capability))] as CapabilityId[];
  return {
    type: "support",
    models: c.models.map((m) => m.name),
    rows: caps.map((cap) => ({
      capability: cap,
      cells: c.models.map((m) => {
        const hits = [...c.receives, ...c.sends].filter((s) => s.capability === cap).flatMap((s) => s.support.filter((x) => x.model === m.name));
        if (hits.length === 0) return null;
        return hits.some((h) => h.status === "live") ? "live" : hits.some((h) => h.status === "beta") ? "beta" : "coming_soon";
      }),
    })),
  };
}

/** Each model's card: its best status on any capability (`live` > `beta` > planned). */
function models(c: Category): DocBlock {
  const support = grid(c);
  if (support.type !== "support") throw new Error("grid() returns a support block");
  return {
    type: "models",
    items: c.models.map((m, i) => {
      const cells = support.rows.map((r) => r.cells[i]);
      const status: DocStatus = cells.includes("live") ? "live" : cells.includes("beta") ? "beta" : "coming_soon";
      return { name: m.name, reach: m.reach, status };
    }),
    unsupported: c.unsupported,
  };
}

const SHARED: DocBlock = {
  type: "p",
  text: "Keys, connecting a user's device, permissions, routing, errors and test mode work the same for every category: see [Projects, environments and keys](/docs/concepts/projects-and-keys), [Connect a device](/docs/guides/connect-a-device), [Permissions and safety](/docs/concepts/permissions-and-safety), [Errors](/docs/api-reference/errors) and [Test mode](/docs/guides/test-mode). The examples assume a `dopl` client and a `deviceId` from the [Quickstart](/docs/quickstart).",
};

function categoryPage(c: Category): DocPage {
  const cards = (specs: CardSpec[]): DocBlock[] => specs.map((s) => ({ type: "capability", ...capabilityCard(s) }));
  return {
    slug: `devices/${c.slug}`,
    section: "devices",
    group: "Devices",
    title: c.title,
    description: c.description,
    status: categoryStatus(c),
    blocks: [
      ...(c.notes ?? []).map((text): DocBlock => ({ type: "quote", text })),
      { type: "h2", text: "Models" },
      models(c),
      grid(c),
      SHARED,
      { type: "h2", text: "What your agent receives" },
      ...(c.receives.length > 0 ? cards(c.receives) : [{ type: "p" as const, text: c.receivesNone ?? "Nothing yet." }]),
      { type: "h2", text: "What your agent can send" },
      ...cards(c.sends),
    ],
  };
}

const LABEL: Record<DocStatus, string> = { live: "Live", beta: "Beta", coming_soon: "Coming soon" };

export const CATEGORY_PAGES: DocPage[] = [
  {
    slug: "devices",
    section: "devices",
    group: "Devices",
    title: "Device categories",
    description: "Every kind of device your agent can reach, grouped by what it can do",
    status: "live",
    blocks: [
      {
        type: "p",
        text: "Devices are grouped by what they can do, not by brand. Each category lists what your agent receives from the device and what it can send, one capability at a time, with the models that support it.",
      },
      {
        type: "table",
        columns: ["Category", "Models", "Status"],
        rows: CATEGORIES.map((c) => [`[${c.title}](/docs/devices/${c.slug})`, c.models.map((m) => m.name).join(", "), LABEL[categoryStatus(c)]]),
      },
      {
        type: "p",
        text: "Watches are planned after these. In [test mode](/docs/guides/test-mode) every category has a simulated device, so the code on each page runs before any model is connected.",
      },
    ],
  },
  ...CATEGORIES.map(categoryPage),
];
