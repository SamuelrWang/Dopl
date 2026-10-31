import type { ReactNode } from "react";
import { u } from "../_design/components";
import styles from "./design-playground.module.css";

/** Holds one clone card in the flow. Its children keep the reference's canvas coordinates. */
export function CloneBox({ x, y, w, h, children }: { x: number; y: number; w: number; h: number; children: ReactNode }) {
  return (
    <div className={styles.cloneBox} style={{ width: u(w), height: u(h) }}>
      <div className={styles.origin} style={{ left: u(-x), top: u(-y) }}>
        {children}
      </div>
    </div>
  );
}
