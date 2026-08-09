"use client";

import { createElement, type ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * PENDING — how an optimistic row says it is not real yet.
 *
 * An optimistic write puts a row on screen before the server has agreed to it.
 * Rendered identically to a saved row, that row is a small lie: it invites a
 * click on controls whose target does not exist, and when the write fails it
 * vanishes with no account of itself. Rendered as a SKELETON it is a different
 * lie — the content is right there, it just is not committed.
 *
 * So: the real content, dimmed and inert. Reduced opacity reads as provisional
 * (the same language `disabled:opacity-60` already speaks across the app), and
 * `pointer-events-none` makes the row honest about having nothing to click.
 * The `data-pending` attribute carries the state to CSS and to tests without
 * either of them matching on a class string.
 *
 * Tokens only, per docs/DESIGN-SYSTEM.md: opacity + pointer utilities compose
 * over whatever surface the row already had, so there is no new color, no new
 * radius, and nothing to mirror into the SPA's hand-copied `kit.css`.
 */

/** The recipe. Compose over the row's own classes; never restyle its surface. */
export const PENDING_ROW =
  "pointer-events-none select-none opacity-60 transition-opacity duration-150";

/** The attribute name, so CSS/tests have one spelling of it. */
export const PENDING_ATTR = "data-pending";

/**
 * Class + attribute for a row that already has its own element. `pending` is
 * passed straight through so a call site reads
 * `<div {...pendingRow(isPending)}>` with no ternary.
 */
export function pendingRow(
  pending: boolean,
  className?: string
): { className: string; "data-pending"?: "" } {
  const props: { className: string; "data-pending"?: "" } = {
    className: cn(className, pending && PENDING_ROW),
  };
  if (pending) props[PENDING_ATTR] = "";
  return props;
}

/**
 * The shell, for a row that has no wrapper of its own. Written with
 * `createElement` rather than JSX so the recipe and its component stay in the
 * one `.ts` module the rest of `shared/ui`'s class recipes live in
 * (`wells.ts`, `link-like.ts`).
 */
export function PendingRow({
  pending = true,
  className,
  children,
}: {
  /** False renders the children untouched, so a caller needs no branch. */
  pending?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return createElement("div", pendingRow(pending, className), children);
}
