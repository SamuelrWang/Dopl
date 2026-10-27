import type { DocBlock, DocPage, DocStatus } from "./types";

/**
 * ⚠ Status follows `docs/specs/device-sdk/SPEC-v1.md` §4. Show, ask and notify are live on Even
 * G2 glasses through the hosted MCP; the Connect flow and multi device routing are planned.
 */
const PLANNED: DocBlock = {
  type: "quote",
  text: "Planned. This describes the Device SDK, which is in development. The steps below are not available yet.",
};

/** "Your agent can:" + bullets, then three steps that each end in a "Read more:" link. */
function casePage(
  status: DocStatus,
  slug: string,
  title: string,
  description: string,
  hero: { label: string; lines: string[] },
  can: string[],
  steps: { title: string; text: string; more: string }[]
): DocPage {
  const blocks: DocBlock[] = [
    { type: "hero", ...hero },
    ...(status === "coming_soon" ? [PLANNED] : []),
    { type: "p", text: "Your agent can:" },
    { type: "list", items: can },
    {
      type: "steps",
      items: steps.map((s) => ({
        title: s.title,
        blocks: [
          { type: "p", text: s.text },
          { type: "p", text: `Read more: ${s.more}.` },
        ],
      })),
    },
  ];
  return { slug: `use-cases/${slug}`, tab: "about", group: "Use cases", title, description, status, blocks };
}

export const USE_CASE_PAGES: DocPage[] = [
  casePage(
    "live",
    "show",
    "Show on a device",
    "Put a card, list or status on your user's screen",
    { label: "Show", lines: ["Flight UA 212", "Gate B14 · Boards 9:40"] },
    [
      "Put a title and up to four lines on the user's glasses with `glasses_show`",
      "Update the same card in place as the work progresses",
      "Build richer screens from display blocks with `glasses_render`, within the limits the lens reports",
    ],
    [
      {
        title: "Connect your agent",
        text: "Connect your MCP host to the hosted MCP server. Once the user has paired glasses, the glasses tools appear on the connection.",
        more: "[Start here](/docs/start-here)",
      },
      {
        title: "Show it",
        text: "Call `glasses_show` with a title and lines. Pass a `card_id` to name the card.",
        more: "[Even Realities G2 glasses](/docs/devices/even-realities-g2)",
      },
      {
        title: "Update in place",
        text: "Call `glasses_show` again with the same `card_id` and the card on the lens is replaced rather than stacked. The Device SDK will add a `show` helper with the same behaviour on every device.",
        more: "[Deliver](/docs/api-reference/deliver)",
      },
    ]
  ),
  casePage(
    "live",
    "ask",
    "Ask and get an answer",
    "Your agent asks a question and gets the user's pick back",
    { label: "Ask", lines: ["Book the 9:40 flight?", "Yes · No · Later"] },
    [
      "Ask a question with two to four options on the user's glasses with `glasses_ask`",
      "Wait for the answer in the same call, or collect it later",
      "Get the answer back as structured data, never free text to parse",
    ],
    [
      {
        title: "Ask",
        text: "Call `glasses_ask` with a question and options. The call holds for up to 200 seconds while the user decides.",
        more: "[Even Realities G2 glasses](/docs/devices/even-realities-g2)",
      },
      {
        title: "The user answers",
        text: "The user picks an option from the touchpad. If they need longer than the call holds, read the answer afterwards with `glasses_get_answer`.",
        more: "[Even Realities G2 glasses](/docs/devices/even-realities-g2)",
      },
      {
        title: "Act on it",
        text: "The answer returns the chosen option, its index and when it was picked, or a timeout or dismissal status.",
        more: "[Start here](/docs/start-here)",
      },
    ]
  ),
  casePage(
    "live",
    "notify",
    "Notify",
    "Tap your user on the shoulder",
    { label: "Notify", lines: ["Build finished", "main · 4m 12s"] },
    [
      "Send a short title and body to the user's glasses with `glasses_notify`",
      "Set how long it stays before it clears",
    ],
    [
      {
        title: "Notify",
        text: "Call `glasses_notify` with a title and a body.",
        more: "[Even Realities G2 glasses](/docs/devices/even-realities-g2)",
      },
      {
        title: "It lands on the lens",
        text: "The notification appears on the user's paired glasses and clears after its time to live, 60 seconds by default.",
        more: "[Even Realities G2 glasses](/docs/devices/even-realities-g2)",
      },
      {
        title: "Next: any device",
        text: "The Device SDK will add a `notify` helper that lets Dopl pick the device for you. It is planned, not live.",
        more: "[Deliver](/docs/api-reference/deliver)",
      },
    ]
  ),
  casePage(
    "coming_soon",
    "connect-devices",
    "Connect your users' devices",
    "Let your users link their hardware to your agent",
    { label: "Connect", lines: ["Acme Agent wants to reach", "your glasses"] },
    [
      "Open a white-label Connect flow from your own product",
      "Let users approve exactly the scopes your agent requests",
      "List each user's connections before you send anything",
    ],
    [
      {
        title: "Create a Connect session",
        text: "Your server creates a Connect session for the user and opens the returned URL or the Connect widget.",
        more: "[Create a Connect session](/docs/api-reference/connect-sessions)",
      },
      {
        title: "The user approves",
        text: "They pair a device and approve the requested scopes, with no Dopl account needed. Nothing is reachable until they do. Today, glasses pair with a code the user enters in their own Dopl account.",
        more: "[Security](/docs/security)",
      },
      {
        title: "Start sending",
        text: "The user's connections now appear on the connections list, and deliveries to that user can reach them.",
        more: "[List connections](/docs/api-reference/connections)",
      },
    ]
  ),
  casePage(
    "coming_soon",
    "routing",
    "Route to the right device",
    "Dopl picks the device your user is on right now",
    { label: "Route", lines: ["Glasses · active now", "Phone · fallback"] },
    [
      "Leave the target as `auto` and let Dopl choose",
      "Pin a delivery to one device or device kind when you need to",
      "See which device each delivery reached and why",
    ],
    [
      {
        title: "Deliver without a device",
        text: "With `target` set to `auto`, Dopl filters the user's devices by presence, capability and grants, then ranks them by your routing rules.",
        more: "[Deliver](/docs/api-reference/deliver)",
      },
      {
        title: "Or pin one",
        text: "Pass a device ID or a device kind as `target`.",
        more: "[Deliver](/docs/api-reference/deliver)",
      },
      {
        title: "Read the decision",
        text: "Every delivery returns the device it was routed to and the reason. Today, Dopl already records which device each message came from, and replies to a message sent from glasses are kept short for the lens.",
        more: "[Run a device action](/docs/api-reference/device-actions)",
      },
    ]
  ),
];
