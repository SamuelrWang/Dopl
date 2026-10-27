import type { DocPage } from "./types";

/**
 * One page per device. ⚠ Status follows `docs/specs/device-sdk/SPEC-v1.md` §4/§5: Even G2 is the
 * only live adapter, the desktop app is beta, everything else is planned and says so.
 */

/** Not built yet. The page says so and describes nothing as working. */
function comingSoon(slug: string, title: string, description: string, plan: string): DocPage {
  return {
    slug: `devices/${slug}`,
    tab: "about",
    group: "Devices",
    title,
    description,
    status: "coming_soon",
    blocks: [
      { type: "quote", text: "Not available yet. Nothing is delivered to this device today." },
      { type: "p", text: plan },
    ],
  };
}

export const DEVICE_PAGES: DocPage[] = [
  {
    slug: "devices/even-realities-g2",
    tab: "about",
    group: "Devices",
    title: "Even Realities G2 glasses",
    description: "Show, ask and notify on your user's glasses",
    status: "live",
    blocks: [
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
      { type: "h2", text: "Connect it" },
      {
        type: "p",
        text: "The glasses show a six character pairing code. Your user enters it in Dopl while signed in, and from then on the glasses tools appear on every MCP connection that user makes to the [hosted MCP server](/docs/api-reference#hosted-mcp).",
      },
    ],
  },
  {
    slug: "devices/desktop",
    tab: "about",
    group: "Devices",
    title: "Desktop",
    description: "The Dopl desktop app on macOS",
    status: "beta",
    blocks: [
      { type: "h2", text: "Supports" },
      {
        type: "list",
        items: [
          "Channel messages, displays and one press decisions your agent posts with `dopl_show`",
          "Presence, so Dopl knows which of your user's computers is online",
        ],
      },
      { type: "h2", text: "Connect it" },
      {
        type: "p",
        text: "Your user signs in to the desktop app and the computer appears under Devices in Settings. Device level actions through the Device SDK are planned.",
      },
    ],
  },
  comingSoon(
    "phone-push",
    "Phone push",
    "Push notifications on your user's phone",
    "Planned as a fallback surface for routing, so a notification or question can reach the user when no other device is active."
  ),
  comingSoon(
    "mac-notch",
    "Mac notch",
    "A live status around the MacBook notch",
    "Planned as a glanceable surface for status that updates in place and short questions."
  ),
  comingSoon("apple-watch", "Apple Watch", "Glanceable intents on the wrist", "Planned after phone support."),
  comingSoon("cars", "Cars", "Intents on in-car displays", "Planned through a connected car provider, with safety limits enforced outside the model."),
  comingSoon("meta-ray-ban", "Meta Ray-Ban", "Audio first intents on Meta Ray-Ban glasses", "Planned on Meta's official device toolkit."),
  comingSoon("robots", "Robots", "Intents for robots that work alongside your users", "Planned through a robotics bridge, simulator first, with safety limits enforced outside the model."),
];
