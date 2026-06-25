import styles from "@/features/knowledge/components/knowledge-v2/knowledge-v2.module.css";

/**
 * Loading boundary for a deep-linked knowledge base. Mirrors the V2 two-pane
 * geometry (list pane + detail pane) so the persistent shell never flashes a
 * mismatched shape while the base + entry SSR.
 */
export default function Loading() {
  return (
    <div className={styles.shell} aria-hidden>
      <div className={styles.listPane} />
      <div className={styles.detailPane} />
    </div>
  );
}
