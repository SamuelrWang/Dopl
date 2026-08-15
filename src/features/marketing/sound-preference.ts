/**
 * Landing page's ONE sound switch: bed toggle (`components/ambient-audio.tsx`)
 * writes, clicks (`components/click-sound.tsx`) read. Mute silences whole page.
 *
 * ⚠ INTENT, not playback state — true from first paint. Bed's `playing` stays
 * false until gesture gate opens; first click IS that gesture, so gating clicks
 * on real playback swallows it. Not persisted: a surviving click pref would
 * desync from the bed's intent-on default each visit.
 */

let soundOn = true;

export function isSoundOn(): boolean {
  return soundOn;
}

export function setSoundOn(next: boolean): void {
  soundOn = next;
}
