import { GOOGLE_HOME_PAGE } from "./pages-google-home";
import type { DocPage } from "./types";

function available(slug: string, title: string, description: string, supports: string[]): DocPage {
  return {
    slug: `devices/${slug}`,
    section: "devices",
    group: "Devices",
    title,
    description,
    blocks: [
      { type: "h2", text: "Supports" },
      { type: "list", items: supports },
      { type: "h2", text: "Connect it" },
      {
        type: "p",
        text: "Your user links it once through the [Connect Dopl](/docs/use-cases/connect-devices) flow. After that, Dopl routes to it automatically.",
      },
    ],
  };
}

/** Not built yet. The page says so and lists nothing as working. */
function comingSoon(slug: string, title: string, description: string): DocPage {
  return {
    slug: `devices/${slug}`,
    section: "devices",
    group: "Devices",
    title,
    description: `${description} (coming soon)`,
    blocks: [
      { type: "quote", text: "Not available yet. Intents sent today are routed to the user's other devices." },
    ],
  };
}

export const DEVICE_PAGES: DocPage[] = [
  available("even-realities-g2", "Even Realities G2 glasses", "Show, ask and notify on your user's glasses", [
    "`show` — text, lists and cards on the heads-up display",
    "`ask` — up to four options, answered from the touchpad",
    "`notify` — a short line that fades after a few seconds",
  ]),
  available("phone-push", "Phone push", "Reach your user's phone with a push notification", [
    "`notify` — a standard push notification",
    "`ask` — actionable notification buttons",
    "`show` — opens a card in the Dopl app",
  ]),
  available("mac-notch", "Mac notch", "A live pill around the MacBook notch", [
    "`show` — a status line that updates in place",
    "`ask` — options that expand from the notch",
    "`notify` — a brief pulse with text",
  ]),
  available("desktop", "Desktop", "The Dopl desktop app on macOS", [
    "`show` — full cards and lists",
    "`ask` — any number of options",
    "`notify` — a system notification",
  ]),
  GOOGLE_HOME_PAGE,
  comingSoon("apple-watch", "Apple Watch", "Glanceable intents on the wrist"),
  comingSoon("cars", "Cars", "Intents on in-car displays"),
  comingSoon("meta-ray-ban", "Meta Ray-Ban", "Audio-first intents on Meta Ray-Ban glasses"),
  comingSoon("robots", "Robots", "Intents for robots that work alongside your users"),
];
