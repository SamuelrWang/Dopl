import { cn } from "@/shared/lib/utils";
import styles from "./app-shell.module.css";

interface Props {
  children: React.ReactNode;
  /**
   * Wrap children in an internal scroll container (default). Pages that
   * manage their own scrolling/layout (e.g. the KB tree + doc split)
   * pass false and receive the raw flex-column panel.
   */
  scroll?: boolean;
  className?: string;
}

/**
 * The white main content panel of the AppShell, with the light
 * semantic-token scope applied so existing token-based feature
 * components render light inside the new chrome. Every workspace
 * sub-page renders inside one of these — single source of truth for
 * the panel geometry + theming.
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
