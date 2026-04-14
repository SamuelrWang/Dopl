import { clsx } from "clsx";
import type { ViewName } from "@/shared/constants";
import { MessageSquare, Layout, Search, Settings, FileText, Download } from "lucide-react";

const TABS: { id: ViewName; label: string; icon: typeof MessageSquare }[] = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "canvas", label: "Canvas", icon: Layout },
  { id: "search", label: "Search", icon: Search },
];

interface PanelTabsProps {
  active: ViewName;
  onChange: (view: ViewName) => void;
  onSettingsClick: () => void;
}

export function PanelTabs({ active, onChange, onSettingsClick }: PanelTabsProps) {
  return (
    <div className="flex items-center border-b border-[var(--border-default)] bg-[var(--bg-inset)]">
      <div className="flex flex-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={clsx(
                "flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors relative",
                isActive
                  ? "text-[var(--accent-primary)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              )}
            >
              <Icon size={14} />
              {tab.label}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--accent-primary)]" />
              )}
            </button>
          );
        })}
      </div>
      <button
        onClick={onSettingsClick}
        className="p-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
        title="Settings"
      >
        <Settings size={14} />
      </button>
    </div>
  );
}
