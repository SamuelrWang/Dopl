"use client";

import { createElement, type ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * PENDING — an optimistic row awaiting the server: real content, dimmed and
 * inert. NOT a skeleton (skeleton means "no content yet"). `data-pending`
 * carries the state to CSS/tests without matching on a class string. Tokens
 * only (docs/DESIGN-SYSTEM.md), so nothing to mirror into the SPA's `kit.css`.
 */

/** The recipe. Compose over the row's own classes; never restyle its surface. */
export const PENDING_ROW =
  "pointer-events-none select-none opacity-60 transition-opacity duration-150";

/** Attribute name — one spelling for CSS and tests. */
export const PENDING_ATTR = "data-pending";

/** Class + attribute for a row with its own element: `<div {...pendingRow(p)}>`. */
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

/** Shell for a row with no wrapper. `createElement` not JSX so this stays a
 *  `.ts` module alongside the other class recipes (`wells.ts`, `link-like.ts`). */
export function PendingRow({
  pending = true,
  className,
  children,
}: {
  /** False renders children untouched, so the caller needs no branch. */
  pending?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return createElement("div", pendingRow(pending, className), children);
}
