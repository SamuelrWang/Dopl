/**
 * WHAT THE MIC BUTTON SAYS WHEN DICTATION CANNOT RUN, in the operator's words (2026-10-08).
 *
 * The ONE place dictation copy lives. Engines report CODES (the desktop helper's, the browser
 * engine's `error` strings); this table turns each into a short `reason` (the button's accessible
 * name, so it stays a few words) and a `fix` (the tooltip's second line: what to do about it).
 *
 * ⚠ EVERY UNAVAILABLE STATE ON A MAC POINTS AT macOS DICTATION (Fn twice). It works in any text
 * field in the app regardless of what our engine can do, so it is the honest fallback, not filler.
 */

export interface DictationFault {
  code: string;
  reason: string;
  fix: string | null;
}

const SETTINGS = "System Settings › Privacy & Security";
const FN = "Or press Fn twice to use macOS Dictation.";

type Copy = { reason: string; fix: (mac: boolean) => string | null };

const TABLE: Record<string, Copy> = {
  // Desktop helper (`dopl-desktop-app/main/dictation.js` › availabilityFromProbe) and browser.
  "speech-denied": {
    reason: "Speech recognition blocked",
    fix: () => `Allow Dopl in ${SETTINGS} › Speech Recognition.`,
  },
  "speech-restricted": {
    reason: "Speech recognition restricted",
    fix: (mac) => (mac ? `A device policy blocks it. ${FN}` : "A device policy blocks it."),
  },
  "mic-denied": {
    reason: "Microphone blocked",
    fix: (mac) => (mac ? `Allow Dopl in ${SETTINGS} › Microphone.` : "Allow microphone access for this site."),
  },
  "mic-restricted": {
    reason: "Microphone restricted",
    fix: (mac) => (mac ? `A device policy blocks it. ${FN}` : "A device policy blocks it."),
  },
  "no-mic": { reason: "No microphone", fix: () => "Connect a microphone and try again." },
  "locale-unsupported": {
    reason: "Language not supported",
    fix: (mac) => (mac ? `Your language has no speech model. ${FN}` : null),
  },
  "on-device-unavailable": {
    reason: "Speech model not installed",
    fix: () => "Turn on Dictation in System Settings › Keyboard to download it. Then try again.",
  },
  "unsupported-os": {
    reason: "Dictation not on this system yet",
    fix: () => "Use your system's own dictation for now.",
  },
  "desktop-outdated": {
    reason: "Update Dopl for dictation",
    fix: (mac) => (mac ? FN : null),
  },
  // Browser engine (`webkitSpeechRecognition` error codes).
  "not-allowed": {
    reason: "Microphone blocked",
    fix: () => "Allow microphone access for this site.",
  },
  "service-not-allowed": {
    reason: "Microphone blocked",
    fix: () => "Allow microphone access for this site.",
  },
  "audio-capture": { reason: "No microphone", fix: () => "Connect a microphone and try again." },
  network: {
    reason: "Dictation unavailable",
    fix: () => "This browser's speech service did not answer. Try Chrome, or check your connection.",
  },
};

/** Codes that END a dictation without anything being wrong: a quiet room, our own stop. */
const SILENT = new Set(["no-speech", "aborted"]);

/**
 * The fault for an engine code, or null for an ordinary ending. An unknown code is still a fault
 * (never silence): "Dictation failed", with the Fn hint on a Mac.
 */
export function dictationFault(code: string | null | undefined, mac: boolean): DictationFault | null {
  if (!code || SILENT.has(code)) return null;
  const copy = TABLE[code];
  if (!copy) return { code, reason: "Dictation failed", fix: mac ? `Try again. ${FN}` : "Try again." };
  return { code, reason: copy.reason, fix: copy.fix(mac) };
}

/** True on a Mac, from the browser's own report. Only chooses which hint to show. */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const p = nav.userAgentData?.platform || nav.platform || nav.userAgent || "";
  return /mac/i.test(p);
}
