/**
 * **THE SHIPPED PROSE OF `dopl_channel`, IN ONE PLACE** — the description a
 * client is PUSHED on connection, the doctrine it PULLS, and the argument
 * `.describe()` text. The harness two law suites both read.
 *
 * ⚠ **SPLIT OUT ON 2026-09-06 (review pass 2), AT THE 500-LINE CAP.**
 * `channel-law.test.ts` reached 504 when the `artifact` op joined the published
 * op list, and it split along the seam its own header already named: the pins
 * that read the DOCTRINE word for word stayed there, and the pins that hold the
 * DESCRIPTION to being a POINTER moved to `law-description-pointer.test.ts`.
 * Both need these three values, and they are built once here so the two suites
 * cannot come to disagree about what the tool actually ships.
 *
 * ⚠ IT IS A PLAIN MODULE AND NOT A `.test.ts` ON PURPOSE, for the reason
 * `law-removed-vocabulary.ts` states: importing one test file from another
 * registers its `describe` blocks twice.
 *
 * ⚠ **THE FILENAME TAKES NO `channel-` PREFIX**, same as its two siblings. The
 * source-wide scan in `law-scan.test.ts` excludes `.test.ts` but reads every
 * OTHER `*.ts` in this directory, and the parity split-scan wants the prefix
 * only on files that carry a HANDLER. This one carries none.
 */

import type { DoplClient } from "@dopl/client";
import type { RegisterTool } from "./respond";
import { registerChannelTool } from "./channel";
import { CHANNEL_DOCTRINE } from "./channel-doctrine";
import { CHANNEL_INPUT_SHAPE } from "./channel-schema";

/**
 * The description the tool ACTUALLY REGISTERS.
 *
 * ⚠ Read off the registrar rather than off the constant, so a registrar that
 * wraps or appends is caught rather than leaving every pin reading a text no
 * client is served. (`law-description-pointer.test.ts` pins the two as equal;
 * that is the assertion which makes reading the registered string safe here.)
 */
function registeredDescription(): string {
  let text = "";
  const cap: RegisterTool = ((name: string, d: string) => {
    if (name === "dopl_channel") text = d;
  }) as RegisterTool;
  registerChannelTool(cap, {} as DoplClient);
  if (!text) throw new Error("dopl_channel was not registered");
  return text;
}

export const DESCRIPTION = registeredDescription();

/**
 * EVERY WORD THIS TOOL SHIPS AS PROSE — the description a client is PUSHED on
 * connection, and the doctrine it PULLS. ⚠ **BOTH, BECAUSE THE SCANS THAT READ
 * THIS ARE ABOUT WHAT AN AGENT CAN READ, NOT WHICH FILE IT SITS IN** (T82).
 * Scanning the description alone used to be scanning everything; now it is a
 * pointer, and the doctrine is the surface that teaches HARDEST — a reader who
 * opens it has asked for the rules — so scanning only the pointer would let
 * 22,000 characters say whatever they liked.
 */
export const SHIPPED_PROSE = `${DESCRIPTION}\n${CHANNEL_DOCTRINE}`;

/** The argument `.describe()` text, which is prose a client reads too. */
export const ARG_PROSE = Object.values(CHANNEL_INPUT_SHAPE)
  .map((arg) => arg.description ?? "")
  .join("\n");
