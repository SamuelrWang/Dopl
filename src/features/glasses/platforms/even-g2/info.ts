import type { PlatformInfo } from "../info";

export const EVEN_G2_INFO = {
  id: "even_g2",
  label: "Even G2",
  assistant: { name: "Hey Even", setupPath: "Even app → Settings → Even AI → Agent Configuration" },
} as const satisfies PlatformInfo;
