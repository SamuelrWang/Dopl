/**
 * GlassNavbar — Sharp-cornered frosted navigation bar.
 *
 * Signature details (ported from openclaw-cloud):
 *  - Height: 48px mobile, 56px desktop (fixed — do not change)
 *  - Corner radius: 3px (sharp, intentional — NOT rounded-full)
 *  - Background: bg-black/[0.07] with backdrop-blur-[10px]
 *  - Border: hairline white/10
 *  - Layout: flex items-center px-3 md:px-6
 *
 * Accepts `leading`, `children` (nav items), and `trailing` slots.
 * Nav items should use `GlassNavLink` for the mono-label active/inactive
 * states or any custom children.
 */

"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface GlassNavbarProps extends React.HTMLAttributes<HTMLElement> {
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
}

export function GlassNavbar({
  leading,
  trailing,
  children,
  className,
  ...props
}: GlassNavbarProps) {
  return (
    <nav
      data-slot="glass-navbar"
      className={cn(
        "shrink-0 h-[48px] md:h-[56px]",
        "bg-black/[0.07] backdrop-blur-[10px]",
        "rounded-[3px] border border-white/10",
        "overflow-visible flex items-center px-3 md:px-6 relative",
        className
      )}
      {...props}
    >
      {leading && <div className="mr-4 md:mr-6 shrink-0">{leading}</div>}
      <div className="hidden md:flex items-center gap-1 flex-1">
        {children}
      </div>
      {trailing && (
        <div className="ml-auto flex items-center gap-2 md:gap-4 shrink-0">
          {trailing}
        </div>
      )}
    </nav>
  );
}

interface GlassNavLinkProps
  extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
}

/**
 * GlassNavLink — A navigation link with active/inactive states
 * matching the openclaw mono-uppercase pattern.
 *
 * Active:   text-white/90 font-semibold
 * Inactive: text-white/50 hover:text-white/80 font-normal
 */
export function GlassNavLink({
  href,
  children,
  className,
  ...props
}: GlassNavLinkProps) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(href + "/");

  return (
    <Link
      href={href}
      className={cn(
        "text-sm px-3 py-1.5 transition-colors",
        isActive
          ? "text-white/90 font-semibold"
          : "font-normal text-white/50 hover:text-white/80",
        className
      )}
      {...props}
    >
      {children}
    </Link>
  );
}
