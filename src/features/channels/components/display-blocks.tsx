"use client";

/**
 * **THE DISPLAY BLOCKS, IN DOPL'S OWN FACE** — the desktop/web renderer of the one display
 * vocabulary (`display/core/types.ts`, docs/specs/unified-display.md §2.5): heading, text, fields,
 * list, progress, table, divider, spacer. The `choice` block is the host's (`display-card.tsx` →
 * `display-choice.tsx`), drawn in its place through {@link DisplayBlocks}' `choice` slot. The G2
 * lens draws the SAME blocks through `display/core/degrade.ts`; text-only readers get the body.
 *
 * ⚠ **NO PIXELS FROM THE SPEC.** `absolute` layout's `x`/`y`/`w`/`h` are HUD coordinates; here they
 * only ORDER the blocks (top-to-bottom, then left-to-right), and v1 `brightness` maps onto the ink
 * ramp rather than onto a box.
 *
 * ⚠ **AN UNKNOWN BLOCK DRAWS NOTHING** — a newer server's block on an older bundle degrades to the
 * blocks this build knows (the adapter already dropped anything it could not normalize).
 */

import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { UsageMeter } from "@/shared/ui/usage-meter";
import type {
  Display,
  DisplayBlock,
  Positioned,
  TextBlock,
} from "@/features/display/core/types";
import type { AgentCardFace } from "./escalation-card-face";
import { MD_TABLE, MD_TD, MD_TH } from "./message-markdown";

/** v1 HUD brightness 0-4 onto the ink ramp; v2 `tone` wins; unset is full ink. */
function inkOf(block: TextBlock): string | false {
  if (block.tone === "strong") return "font-semibold";
  if (block.tone === "muted") return "text-text-secondary";
  const b = block.brightness;
  if (typeof b !== "number" || b >= 3) return false;
  return b >= 2 ? "text-text-secondary" : "text-text-muted";
}

/** Top-to-bottom, then left-to-right, for `absolute`; the agent's order for `stack`. */
function ordered(display: Display): Positioned<DisplayBlock>[] {
  if (display.layout !== "absolute") return display.blocks;
  const at = (value: number | undefined) => value ?? 0;
  return [...display.blocks].sort((a, b) => at(a.y) - at(b.y) || at(a.x) - at(b.x));
}

export function DisplayBlocks({
  display,
  face,
  choice,
}: {
  display: Display;
  /** The host's size step (`escalation-card-face.ts › AGENT_CARD_FACE`). */
  face: AgentCardFace;
  /** What the `choice` block draws, in its place (at most one per display). */
  choice?: ReactNode;
}) {
  return (
    <>
      {ordered(display).map((block) => {
        const key = block.id;
        switch (block.type) {
          case "heading":
            return (
              <p key={key} data-block={key} className={cn(face.body, "font-semibold")}>
                {block.text}
              </p>
            );
          case "text":
            return (
              <p
                key={key}
                data-block={key}
                className={cn(
                  face.body,
                  "whitespace-pre-wrap",
                  inkOf(block),
                  block.border && "rounded-[8px] border border-border-default px-2 py-1"
                )}
              >
                {block.content}
              </p>
            );
          case "fields":
            return (
              <dl
                key={key}
                data-block={key}
                className={cn(face.body, "grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5")}
              >
                {block.rows.map((row, i) => (
                  <div key={i} className="contents">
                    <dt className="text-text-muted">{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            );
          case "list": {
            const List = block.style === "number" ? "ol" : "ul";
            return (
              <List
                key={key}
                data-block={key}
                className={cn(
                  face.body,
                  "pl-5",
                  block.style === "number" ? "list-decimal" : "list-disc"
                )}
              >
                {block.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </List>
            );
          }
          case "choice":
            return <div key={key} data-block={key} className="contents">{choice}</div>;
          case "progress": {
            const pct = Math.round(Math.min(1, Math.max(0, block.value)) * 100);
            return (
              <UsageMeter
                key={key}
                label={block.label}
                used={pct}
                limit={100}
                readout={`${pct}%`}
                className=""
              />
            );
          }
          case "table":
            return (
              <div key={key} data-block={key} className="overflow-x-auto">
                <table className={cn(MD_TABLE, face.body)}>
                  <thead>
                    <tr>
                      {block.columns.map((column, i) => (
                        <th key={i} className={cn(MD_TH, "text-text-muted")}>
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) => (
                          <td key={j} className={MD_TD}>
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "divider":
            return <hr key={key} data-block={key} className="border-border-default" />;
          case "spacer":
            return (
              <div
                key={key}
                data-block={key}
                aria-hidden
                style={{ height: `${Math.min(4, Math.max(1, block.lines ?? 1)) * 0.75}rem` }}
              />
            );
          default:
            return null;
        }
      })}
    </>
  );
}
