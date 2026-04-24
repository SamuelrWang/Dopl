/**
 * Pill — pill-shaped button/link matching the nav items in the screenshot.
 *
 * Renders an icon + label inside a recessed pill. Active state has a subtle
 * highlight border. Polymorphic — can render as <button> or <a>.
 */

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/shared/lib/utils";

const pillVariants = cva(
  "inline-flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors duration-150 rounded-[var(--radius-pill)] select-none",
  {
    variants: {
      variant: {
        default:
          "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-inset-hover)]",
        inset:
          "bg-[var(--bg-inset)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-inset-hover)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)]",
        active:
          "bg-[var(--bg-inset)] border border-[var(--border-highlight)] text-[var(--text-primary)] shadow-[var(--inset-highlight)]",
      },
      size: {
        sm: "h-8 px-3 text-xs gap-1.5",
        md: "h-10 px-4 text-sm gap-2",
        lg: "h-12 px-5 text-base gap-2.5",
      },
    },
    defaultVariants: {
      variant: "inset",
      size: "md",
    },
  }
);

interface BasePillProps extends VariantProps<typeof pillVariants> {
  icon?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

type ButtonPillProps = BasePillProps &
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    href?: never;
  };

type AnchorPillProps = BasePillProps &
  React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
  };

export type PillProps = ButtonPillProps | AnchorPillProps;

export function Pill({
  variant,
  size,
  className,
  icon,
  children,
  ...props
}: PillProps) {
  const content = (
    <>
      {icon && (
        <span className="shrink-0 [&_svg]:size-4 text-[var(--text-muted)]">
          {icon}
        </span>
      )}
      {children}
    </>
  );

  if ("href" in props && props.href !== undefined) {
    return (
      <a
        data-slot="pill"
        className={cn(pillVariants({ variant, size }), className)}
        {...(props as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      data-slot="pill"
      className={cn(pillVariants({ variant, size }), className)}
      {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)}
    >
      {content}
    </button>
  );
}

export { pillVariants };
