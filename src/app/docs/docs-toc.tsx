"use client";

interface TocItem {
  id: string;
  title: string;
  level: number;
}

interface DocsTocProps {
  items: TocItem[];
  activeId: string;
}

export function DocsToc({ items, activeId }: DocsTocProps) {
  if (items.length === 0) return null;

  return (
    <nav className="w-[200px] shrink-0 h-full overflow-y-auto py-8 pl-6 pr-4 scrollbar-discreet">
      <p className="font-mono text-[10px] uppercase tracking-widest text-white/30 mb-3">
        On this page
      </p>
      <ul className="space-y-1">
        {items.map((item, idx) => {
          const isActive = item.id === activeId;
          return (
            <li key={`toc-${idx}-${item.id}`}>
              <a
                href={`#${item.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth" });
                }}
                className={`block text-[12px] py-0.5 transition-colors ${
                  item.level === 3 ? "pl-3" : ""
                } ${
                  isActive
                    ? "text-white/90"
                    : "text-white/35 hover:text-white/60"
                }`}
              >
                {item.title}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
