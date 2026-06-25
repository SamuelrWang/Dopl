import styles from "@/features/knowledge/components/knowledge-v2/knowledge-v2.module.css";

/**
 * Route-level loading boundary for the knowledge area. Renders INSIDE the
 * persistent app shell, mirroring the V2 two-pane geometry (floating panel
 * with a list pane + detail pane) so arriving at /knowledge never flashes a
 * mismatched shape.
 */
export default function Loading() {
  return (
    <div className={styles.shell} aria-hidden>
      <div className={styles.listPane} />
      <div className={styles.detailPane} />
    </div>
  );
}
