import { cn } from "@/shared/lib/utils";
import styles from "./app-shell.module.css";

interface Props {
  children: React.ReactNode;
  /**
   * Wrap children in an internal scroll container (default). Pages owning their
   * own scroll/layout (e.g. the KB tree + doc split) pass false for the raw
   * flex-column panel.
   */
  scroll?: boolean;
  className?: string;
}

/**
 * AppShell's white content panel, carrying the light token scope so token-based
 * feature components render light inside the chrome. Single source of truth for
 * panel geometry + theming — every workspace sub-page renders inside one.
 */
export function AppPanel({ children, scroll = true, className }: Props) {
  return (
    <main className={cn(styles.mainDetail, styles.lightScope, className)}>
      {scroll ? (
        <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
      ) : (
        children
      )}
    </main>
  );
}
