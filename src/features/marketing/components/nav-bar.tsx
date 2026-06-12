"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { cn } from "@/shared/lib/utils";

const LINKS = [
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
];

/** Floating pill nav — gains a shadow once the page scrolls. */
export function NavBar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="fixed inset-x-0 top-4 z-50 px-4">
      <nav
        className={cn(
          "mx-auto flex max-w-5xl items-center justify-between rounded-2xl border border-[#10131a]/10 bg-white/85 px-5 py-3 backdrop-blur-md transition-shadow",
          scrolled && "shadow-[0_12px_32px_-12px_rgba(14,34,64,0.25)]",
        )}
      >
        <Link
          href="/"
          className="font-(family-name:--font-display) text-xl font-semibold tracking-tight text-[#10131a]"
        >
          Dopl
        </Link>
        <div className="hidden items-center gap-6 sm:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-[#5b6573] transition-colors hover:text-[#10131a]"
            >
              {link.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="hidden text-sm font-medium text-[#5b6573] transition-colors hover:text-[#10131a] sm:block"
          >
            Sign in
          </Link>
          <Link
            href="/login"
            className="rounded-xl bg-[#2f6fed] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#3d7bff]"
          >
            Get started
          </Link>
        </div>
      </nav>
    </header>
  );
}
