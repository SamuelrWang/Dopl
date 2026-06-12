import Link from "next/link";

const COLUMNS = [
  {
    heading: "Product",
    links: [
      { href: "/pricing", label: "Pricing" },
      { href: "/docs", label: "Docs" },
      { href: "/login", label: "Sign in" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="bg-[#0b0e14] pt-20 pb-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-12 px-6 sm:flex-row sm:justify-between">
        <div>
          <p className="font-(family-name:--font-display) text-2xl font-semibold text-white">
            Dopl
          </p>
          <p className="mt-3 max-w-xs text-sm text-white/50">
            One workspace for your team&apos;s knowledge, skills, and
            workflows — for every AI agent.
          </p>
        </div>
        <div className="flex gap-16">
          {COLUMNS.map((column) => (
            <div key={column.heading}>
              <p className="text-sm font-semibold text-white/80">
                {column.heading}
              </p>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.href + link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-white/50 transition-colors hover:text-white"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="mx-auto mt-16 max-w-5xl border-t border-white/10 px-6 pt-6">
        <p className="text-xs text-white/40">
          © {new Date().getFullYear()} Dopl. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
