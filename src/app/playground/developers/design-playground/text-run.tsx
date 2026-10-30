import styles from "./design-playground.module.css";
import { RUNS, type RunName } from "./text-runs";

/** One measured text run. Each word sits at its own measured left; the class carries the rest. */
export function T({ n }: { n: RunName }) {
  return (
    <span className={`${styles.run} ${styles[n]}`}>
      {RUNS[n].map(([word, left], i) => (
        <span key={i} className={styles.word} style={{ left }}>
          {word}{" "}
        </span>
      ))}
    </span>
  );
}
