"use client";

import { Check, Copy } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useCopyToClipboard } from "@/shared/hooks/use-copy-to-clipboard";

/**
 * Icon-only copy affordance (Copy→Check swap). Surfaces with their own chrome
 * (labelled CTAs, toasts) compose `useCopyToClipboard` directly instead.
 */
export function CopyButton({
  text,
  size = 14,
  label = "Copy",
  className,
}: {
  text: string;
  size?: number;
  /** Tooltip + accessible name. */
  label?: string;
  className?: string;
}) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <button
      type="button"
      onClick={() => void copy(text)}
      title={label}
      aria-label={label}
      className={cn(
        "shrink-0 cursor-pointer text-text-muted transition-colors hover:text-text-secondary",
        className
      )}
    >
      {copied ? <Check size={size} /> : <Copy size={size} />}
    </button>
  );
}
