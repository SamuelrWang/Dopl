"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const sidebarItems = [
  { href: "/canvas", label: "Canvas", icon: "📥" },
  { href: "/entries", label: "Browse", icon: "📚" },
  { href: "/build", label: "Builder", icon: "🔨" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex w-56 flex-col border-r bg-background p-4 gap-1">
      {sidebarItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            pathname === item.href
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          )}
        >
          <span>{item.icon}</span>
          {item.label}
        </Link>
      ))}
    </aside>
  );
}
