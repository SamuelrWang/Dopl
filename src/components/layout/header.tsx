"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { UserMenu } from "./user-menu";

const navItems: { href: string; label: string }[] = [
  { href: "/canvas", label: "Canvas" },
  { href: "/entries", label: "Browse" },
  { href: "/pricing", label: "Pricing" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function Header() {
  const pathname = usePathname();

  if (pathname === "/login" || pathname === "/terms" || pathname === "/privacy") return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-20 flex justify-center px-4 pt-3 pointer-events-none"
      style={{
        transform: "translateX(calc(var(--chat-drawer-inset, 0px) / -2))",
        transition: "transform 250ms cubic-bezier(0.16, 1, 0.3, 1)",
        willChange: "transform",
      }}
    >
      <nav
        className="pointer-events-auto inline-flex items-center gap-1 px-1.5 py-1 rounded-full backdrop-blur-xl border border-white/[0.1] shadow-[0_4px_16px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.08)]"
        style={{ backgroundColor: "oklch(0.13 0 0 / 0.5)" }}
      >
        {/* Logo */}
        <Link
          href="/canvas"
          aria-label="Dopl"
          className="shrink-0 flex items-center justify-center w-7 h-7 rounded-lg overflow-hidden ml-1"
        >
          <Image
            src="/favicons/favicon-32x32.png"
            alt="Dopl"
            width={20}
            height={20}
            className="rounded-md"
          />
        </Link>

        {/* Nav pills */}
        <div className="flex items-center gap-0.5 ml-1">
          {navItems.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`
                  px-3 py-1 rounded-full font-mono text-[10px] uppercase tracking-[0.12em] font-medium transition-colors duration-150 select-none
                  ${active
                    ? "text-white/90 bg-white/[0.08] border border-white/[0.15]"
                    : "text-white/40 hover:text-white/70 border border-transparent hover:border-white/[0.08] hover:bg-white/[0.04]"
                  }
                `}
              >
                {item.label}
              </Link>
            );
          })}
        </div>

        {/* User menu */}
        <div className="shrink-0 ml-1">
          <UserMenu />
        </div>
      </nav>
    </div>
  );
}
