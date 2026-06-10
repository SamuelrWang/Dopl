import styles from "@/shared/layout/app-shell/app-shell.module.css";

/**
 * Route-level loading boundary for the knowledge landing page. Renders
 * INSIDE the persistent knowledge-layout shell, mirroring the landing
 * content's geometry — title, hero banner, KB card grid — so arriving
 * at /knowledge never flashes a full-screen loader.
 */
export default function Loading() {
  return (
    <main className={styles.main}>
      <div className={`${styles.scroll} animate-pulse`} aria-hidden>
        {/* Title row */}
        <div className="flex items-center gap-3.5" style={{ marginBottom: 24 }}>
          <div className="h-8 w-48 rounded-md bg-black/[0.07]" />
          <div className="h-7 w-14 rounded-lg bg-black/[0.07]" />
        </div>

        {/* Hero banner */}
        <div
          className="rounded-[20px] bg-black/[0.08]"
          style={{ minHeight: 320, marginBottom: 42 }}
        />

        {/* Section head */}
        <div className="flex items-center justify-between" style={{ marginBottom: 26 }}>
          <div className="h-8 w-56 rounded-md bg-black/[0.07]" />
          <div className="h-11 w-32 rounded-[11px] bg-black/[0.07]" />
        </div>

        {/* KB cards */}
        <div className={styles.cards}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={styles.card}
              style={{ pointerEvents: "none" }}
            >
              <div className="h-5 w-2/3 rounded bg-black/[0.06] mb-3" />
              <div className="h-3.5 w-full rounded bg-black/[0.05] mb-1.5" />
              <div className="h-3.5 w-4/5 rounded bg-black/[0.05]" />
              <div className="mt-auto pt-4 flex items-center justify-between">
                <div className="h-3 w-16 rounded bg-black/[0.05]" />
                <div className="h-3 w-24 rounded bg-black/[0.05]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
