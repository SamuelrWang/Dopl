import type { DocBlock, DocPage } from "./types";

/** "Your agent can:" + bullets, then three steps that each end in a "Read more:" link. */
function useCase(
  slug: string,
  title: string,
  description: string,
  hero: { label: string; lines: string[] },
  can: string[],
  steps: { title: string; text: string; more: string }[]
): DocPage {
  const blocks: DocBlock[] = [
    { type: "hero", ...hero },
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
  return { slug: `use-cases/${slug}`, tab: "about", group: "Use cases", title, description, blocks };
}

export const USE_CASE_PAGES: DocPage[] = [
  useCase(
    "show",
    "Show on a device",
    "Put a card, list or status on your user's screen",
    { label: "Show", lines: ["Flight UA 212", "Gate B14 · Boards 9:40"] },
    [
      "Render text, lists, key–value cards and images with `show`",
      "Update what is on screen in place as the work progresses",
      "Stay within the layout each device supports — Dopl adapts the blocks",
    ],
    [
      {
        title: "State the intent",
        text: "Call `show` with a user ID and an array of blocks. You describe the content, not the device.",
        more: "[Show](/docs/api-reference/show)",
      },
      {
        title: "Dopl picks the device",
        text: "Dopl routes to the device the user is on right now and renders the blocks for its screen.",
        more: "[Route to the right device](/docs/use-cases/routing)",
      },
      {
        title: "Update or clear",
        text: "Send new blocks with the same display ID to update in place, or clear it when the task ends.",
        more: "[Show](/docs/api-reference/show)",
      },
    ]
  ),
  useCase(
    "ask",
    "Ask and get an answer",
    "Your agent asks a question and gets the user's pick back",
    { label: "Ask", lines: ["Book the 9:40 flight?", "Yes · No · Later"] },
    [
      "Ask a question with up to six options",
      "Wait for the answer, or poll for it later",
      "Get the answer back as structured data, never free text to parse",
    ],
    [
      {
        title: "Ask",
        text: "Call `ask` with a question and options. Dopl shows it on the user's current device.",
        more: "[Ask](/docs/api-reference/ask)",
      },
      {
        title: "The user answers",
        text: "A tap on glasses, a button on the phone, a click in the notch — the answer is the same shape everywhere.",
        more: "[Devices](/docs/devices/even-realities-g2)",
      },
      {
        title: "Act on it",
        text: "The answer returns to the agent that asked, with the option picked and the device it came from.",
        more: "[Ask](/docs/api-reference/ask)",
      },
    ]
  ),
  useCase(
    "notify",
    "Notify",
    "Tap your user on the shoulder, wherever they are",
    { label: "Notify", lines: ["Build finished", "main · 4m 12s"] },
    [
      "Send a short notification with `notify`",
      "Mark urgency so Dopl can pick a louder or quieter device",
      "Respect the user's quiet hours automatically",
    ],
    [
      {
        title: "Notify",
        text: "Call `notify` with a user ID and text.",
        more: "[Notify](/docs/api-reference/notify)",
      },
      {
        title: "Dopl delivers",
        text: "It lands on the device the user is wearing or holding, and falls back to phone push.",
        more: "[Route to the right device](/docs/use-cases/routing)",
      },
      {
        title: "Track it",
        text: "Each notification returns an ID you can check for delivered and seen.",
        more: "[Notify](/docs/api-reference/notify)",
      },
    ]
  ),
  useCase(
    "connect-devices",
    "Connect your users' devices",
    "Let your users link their hardware to your agent",
    { label: "Connect Dopl", lines: ["Acme Agent wants to reach", "your glasses and phone"] },
    [
      "Send users a **Connect Dopl** link from your product",
      "Let them pick which devices your agent may reach",
      "Know which devices are linked before you send anything",
    ],
    [
      {
        title: "Send the Connect Dopl link",
        text: "Create a connect link for your user and open it from your app or agent.",
        more: "[List endpoints](/docs/api-reference/endpoints)",
      },
      {
        title: "The user approves",
        text: "They sign in to Dopl, pick devices and approve your agent. Nothing is reachable until they do.",
        more: "[Security](/docs/security)",
      },
      {
        title: "Start sending",
        text: "Their linked devices now appear on your endpoints list, and intents to that user are delivered.",
        more: "[List endpoints](/docs/api-reference/endpoints)",
      },
    ]
  ),
  useCase(
    "routing",
    "Route to the right device",
    "Dopl picks the device your user is on right now",
    { label: "Route", lines: ["Glasses · active now", "Phone · fallback"] },
    [
      "Leave the device out and let Dopl choose",
      "Pin an intent to one device when you need to",
      "See which device each intent was delivered to",
    ],
    [
      {
        title: "Send without a device",
        text: "Omit `device` and Dopl uses the user's most recently active, capable device.",
        more: "[Show](/docs/api-reference/show)",
      },
      {
        title: "Or pin one",
        text: "Pass an endpoint ID from the endpoints list to target one device.",
        more: "[List endpoints](/docs/api-reference/endpoints)",
      },
      {
        title: "Fallbacks",
        text: "If the device can't render the intent, Dopl falls back to the next capable one.",
        more: "[Devices](/docs/devices/even-realities-g2)",
      },
    ]
  ),
];
