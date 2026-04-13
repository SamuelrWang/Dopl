"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { PillBar, Pill, Orb } from "@/components/design";
import { UserMenu } from "./user-menu";

// Simple inline line icons — match the aesthetic from /design
function InboxIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <path d="M3 11h4l1 2h4l1-2h4" />
    </svg>
  );
}

function BrowseIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="11" y="3" width="6" height="6" rx="1" />
      <rect x="3" y="11" width="6" height="6" rx="1" />
      <rect x="11" y="11" width="6" height="6" rx="1" />
    </svg>
  );
}

function BuilderIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path
        d="M4 17l4-12 4 12M6 13h4M14 5v12M11 5h6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const navItems: { href: string; label: string; icon: React.ReactNode }[] = [
  { href: "/canvas", label: "Canvas", icon: <InboxIcon /> },
  { href: "/entries", label: "Browse", icon: <BrowseIcon /> },
  { href: "/build", label: "Builder", icon: <BuilderIcon /> },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function Header() {
  const pathname = usePathname();

  return (
    // Relative + high z-index so the navbar floats ABOVE the canvas grid
    // and panels on the ingest page. The PillBar is overridden to match
    // the dark-glass styling used by the chat input box, so the canvas
    // grid shows through it.
    <div className="container mx-auto px-4 pt-4 flex justify-center relative z-20">
      <PillBar
        className="!bg-black/[0.25] !border-white/[0.1] !shadow-[0_4px_16px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-saturate-[1.4] !backdrop-blur-[12px]"
        leading={
          <Link href="/canvas" aria-label="Setup Intelligence Engine">
            <Orb size="md" glow="strong" />
          </Link>
        }
        trailing={<UserMenu />}
      >
        {navItems.map((item) => (
          <Pill
            key={item.href}
            href={item.href}
            icon={item.icon}
            variant={isActive(pathname, item.href) ? "active" : "inset"}
          >
            {item.label}
          </Pill>
        ))}
      </PillBar>
    </div>
  );
}
