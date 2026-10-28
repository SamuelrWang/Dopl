/**
 * Every word of the Developers section (./sdk-section.tsx + ./sdk-visuals.tsx).
 *
 * ⚠ PREVIEW. Only the MCP server is live; the typed SDKs are not built, hence
 * the tag. Nothing here may claim the SDK ships today.
 * ⚠ Card titles + bodies are Samuel's locked wording (2026-10-22, second
 * round). Change them only on his word. Landing copy rules: no em/en dashes,
 * no staccato fragments, and never list device types as if they were the only
 * ones (the devices inside the visuals are EXAMPLES, with an open-ended row).
 */
/** One token of a card's SDK call line: keyword, function, string, or plain. */
export type SdkTok = readonly [kind: "kw" | "fn" | "str" | "", text: string];

/** `await <obj>.<method>(<args>)`, optionally bound to `const <name>`. */
const call = (method: string, args: string, bind?: string): readonly SdkTok[] => [
  ...(bind ? ([["kw", "const "], ["", `${bind} = `]] as const) : []),
  ["kw", "await "],
  ["", "dopl."],
  ["fn", method],
  ["", `(${args})`],
];

export type DeviceStatus = "active" | "online" | "offline";

/**
 * Example endpoints, one ID each, shared by all three cards so a device reads
 * the same everywhere. Real products as EXAMPLES (Samuel 2026-10-22), never a
 * full list: card 1 keeps its open-ended "Any device" row.
 */
const DEVICES = {
  mbp: { name: "MacBook Pro", id: "ep_7h2m9q", icon: "laptop" },
  g2: { name: "Even Realities G2", id: "ep_8f3k2d", icon: "glasses" },
  iphone: { name: "iPhone 17 Pro", id: "ep_3c9x1v", icon: "phone" },
  unitree: { name: "Unitree G1", id: "ep_5r6t0b", icon: "arm" },
  tesla: { name: "Tesla Model Y", id: "ep_2w4n8z", icon: "car" },
} as const;

export const SDK_COPY = {
  status: { active: "active", online: "online", offline: "offline" } satisfies Record<DeviceStatus, string>,
  eyebrow: "Developers",
  tag: "Preview",
  heading: "Ship your agents to your users' devices with the Dopl SDK",
  cta: "Read the docs",
  ctaHref: "/docs",

  capabilities: {
    title: "Capability discovery",
    /** SDK form of the docs' REST "List endpoints" (GET /users/{user_id}/endpoints). */
    call: call("endpoints", "userId"),
    body: "One typed API exposes every device's capabilities, with no device-specific code.",
    /** Each card reads like a capability manifest. */
    devices: [
      {
        ...DEVICES.g2,
        status: "active",
        manifest: [
          ["display", "576x288 mono"],
          ["input", "mic, touch, haptics"],
        ],
      },
      {
        ...DEVICES.unitree,
        status: "offline",
        manifest: [
          ["actuate", "23-dof, grip"],
          ["camera", "depth, 1080p"],
        ],
      },
      {
        ...DEVICES.tesla,
        status: "online",
        manifest: [
          ["display", "1920x1200 color"],
          ["input", "voice, touch"],
        ],
      },
    ],
    more: "Any device",
    moreHint: "manifest",
  },

  routing: {
    title: "Context-aware routing",
    body: "Each request routes to the best endpoint by presence, capability, and urgency.",
    /** The two asks' arguments, shown as they arrive. No header call line on
     *  this card (Samuel 2026-10-22): these two lines are its code. */
    requests: [
      '{ question: "Approve deploy?" }',
      '{ question: "Ship hotfix?", urgency: "high" }',
    ],
    /** Several can be active at once. Requests only ever land on an active one. */
    devices: [
      { ...DEVICES.mbp, status: "active" },
      { ...DEVICES.g2, status: "active" },
      { ...DEVICES.iphone, status: "online" },
      { ...DEVICES.unitree, status: "offline" },
    ],
    presenceLabel: "presence",
    /** Index into `devices` each request resolves to, with its reason tags.
     *  Presence moves from the first landing's device to the second's. */
    landings: [
      { device: 0, prompt: "Approve deploy?", reasons: ["presence", "display"], answer: "Approved" },
      { device: 1, prompt: "Ship hotfix?", reasons: ["presence", "urgency: high"] },
    ],
  },

  embedded: {
    title: "White-label by default",
    // ⚠ FOR SAMUEL: `connectLink` is NOT named in the docs yet. They only say
    // "Create a connect link for your user and open it from your app or agent"
    // (docs/content/pages-use-cases.ts). Rename here if the docs pick another name.
    call: call("connectLink", "userId", "link"),
    body: "Pairing and scoped permissions live inside your product, with every request logged.",
    brand: "Acme Agent",
    brandMark: "A",
    nav: "Settings",
    sheetTitle: "Connect your devices",
    devicesLabel: "Devices",
    devices: [
      { name: DEVICES.g2.name, on: true },
      { name: DEVICES.iphone.name, on: true },
      { name: DEVICES.mbp.name, on: false },
    ],
    permsLabel: "Permissions",
    perms: [
      { name: "Show and ask", on: true },
      { name: "Microphone", on: false },
    ],
    activity: `Acme Agent asked on your ${DEVICES.g2.name} · 2:14pm`,
  },
} as const;
