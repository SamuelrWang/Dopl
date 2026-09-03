/**
 * **THE ONE BASE CLASS EVERY CHANNEL ERROR EXTENDS.**
 *
 * ⚠ **ITS OWN FILE (§1 SPLIT, 2026-09-02) ONLY BECAUSE `errors.ts` REACHED THE
 * 500-LINE CAP AND A SECOND ERROR MODULE NEEDED IT.** Exporting it FROM
 * `errors.ts` instead would make `errors.ts → errors-recipient.ts → errors.ts` a
 * cycle, and a cycle through a CLASS declaration is a temporal-dead-zone crash
 * at module evaluation rather than a lint warning. A leaf with no imports cannot
 * be in one.
 *
 * ⚠ **IT IS NOT AN IMPORT PATH FOR CALLERS.** `errors.ts` is still the one door
 * to every channel error — this file is an implementation detail of that file
 * and its siblings, the same arrangement `types.ts` has with its four type
 * modules.
 */
export class ChannelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
