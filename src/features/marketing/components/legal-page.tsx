import Link from "next/link";
import type { ReactNode } from "react";

/** Shared chrome for the static legal pages (/privacy, /terms). Server component. */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      className="min-h-screen px-6 py-16 flex justify-center relative z-10"
      style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
    >
      <div className="w-full max-w-2xl">
        <Link
          href="/login"
          className="inline-block mb-10 font-mono text-[10px] uppercase tracking-wider text-white/40 hover:text-white transition-colors"
        >
          &larr; Back
        </Link>

        <h1
          className="text-2xl font-bold mb-2"
          style={{
            fontFamily: "var(--font-playfair), 'Playfair Display', serif",
            fontStyle: "italic",
            color: "white",
          }}
        >
          {title}
        </h1>
        <p className="font-mono text-[10px] uppercase tracking-wider text-white/40 mb-12">
          Last updated: April 2026
        </p>

        <div className="space-y-10 text-[14px] leading-relaxed text-white/70">{children}</div>
      </div>
    </div>
  );
}

/** One numbered section: `title` is the full heading, e.g. "3. User Accounts". */
export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-mono text-[11px] uppercase tracking-wider text-white/90 mb-3">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function LegalSubheading({ children }: { children: ReactNode }) {
  return (
    <h3 className="font-mono text-[10px] uppercase tracking-wider text-white/60 mt-4 mb-2">
      {children}
    </h3>
  );
}

/** Postal + email block closing both pages' Contact section. */
export function LegalContactAddress() {
  return (
    <div className="mt-3 font-mono text-[12px] text-white/50 space-y-1">
      <p>Dopl</p>
      <p>2603 California Street</p>
      <p>San Francisco, CA</p>
      <p>
        <a href="mailto:build@usedopl.com" className="text-white/70 hover:text-white transition-colors">
          build@usedopl.com
        </a>
      </p>
    </div>
  );
}
