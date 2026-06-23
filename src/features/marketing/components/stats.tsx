import { STATS } from "../constants";

/** Three-up stat band sitting on the frame below the card. */
export function Stats() {
  return (
    <section className="dopl-stats">
      {STATS.map((stat) => (
        <div key={stat.label} className="dopl-stat">
          <div className="dopl-stat-value">{stat.value}</div>
          <div className="dopl-stat-label">{stat.label}</div>
        </div>
      ))}
    </section>
  );
}
