/**
 * The landing page's ONE sound switch, shared by every sound source on it.
 *
 * There are two of those now — the looping bed (`components/ambient-audio.tsx`)
 * and the button clicks (`components/click-sound.tsx`) — and only the bed owns a
 * visible control. A visitor who hits that speaker toggle is muting *the page*,
 * not one track: clicks that kept firing afterwards would read as a bug in a
 * control they just used. So the toggle writes here and the clicks read here.
 *
 * This is INTENT, not playback state. The bed's rendered `playing` stays false
 * until a browser gesture gate lets it start, and the first click on the page is
 * the gesture that opens it — gating clicks on actual playback would swallow
 * exactly that click. `soundOn` is instead "the visitor has not asked for
 * silence", which is true from the first paint.
 *
 * Deliberately not a React store: the only reader checks it inside a DOM event
 * handler at fire time, so a subscription would buy re-renders nobody needs.
 * Deliberately not persisted to localStorage either — the bed's own default is
 * intent-on every visit, and a click preference that outlived it would put the
 * two out of step on the next load.
 */

let soundOn = true;

export function isSoundOn(): boolean {
  return soundOn;
}

export function setSoundOn(next: boolean): void {
  soundOn = next;
}
