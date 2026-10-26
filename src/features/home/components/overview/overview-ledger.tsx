import { EmptyState } from "@/shared/ui/empty-state";
import { ThinMeter } from "@/shared/ui/usage-meter";
import {
  EMPTY_CHANNEL_USAGE,
  EMPTY_PERSON_USAGE,
  EMPTY_TOOL_USAGE,
  type HomeOverview,
} from "@/features/home/overview-types";
import { OverviewCard } from "./overview-card";
import styles from "./overview.module.css";

/** One row per home channel: credits beside a meter scaled to the top channel, then messages. */
export function ChannelsTable({ data }: { data: HomeOverview }) {
  const rows = data.channels ?? EMPTY_CHANNEL_USAGE;
  const peak = Math.max(1, ...rows.map((row) => row.credits));
  return (
    <OverviewCard title="Channels" count={rows.length}>
      {rows.length === 0 ? (
        <EmptyState variant="outline" title="No channel activity this month" />
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Channel</th>
              <th scope="col" className={styles.num}>
                Credits
              </th>
              <th scope="col" className={styles.num}>
                Messages
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.workspaceId}>
                <td className="font-medium">
                  {row.name ? `#${row.name}` : <span className="text-text-muted">Untitled channel</span>}
                </td>
                <td className={styles.num}>
                  <span className={styles.numMeter}>
                    <ThinMeter used={row.credits} limit={peak} className="w-14" />
                    {row.credits.toLocaleString()}
                  </span>
                </td>
                <td className={styles.num}>{row.messages.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </OverviewCard>
  );
}

/** Credits per person; `role` is the container role, the only place `guest` exists. */
export function PeopleCard({ data }: { data: HomeOverview }) {
  const rows = data.people ?? EMPTY_PERSON_USAGE;
  const guests = rows.filter((row) => row.role === "guest");
  const guestCredits = guests.reduce((sum, row) => sum + row.credits, 0);
  return (
    <OverviewCard
      title="People"
      count={rows.length}
      aside={
        guests.length > 0 && (
          <span className={styles.mono}>
            {guests.length} {guests.length === 1 ? "guest" : "guests"} · {guestCredits.toLocaleString()}
          </span>
        )
      }
    >
      {rows.length === 0 ? (
        <EmptyState variant="outline" title="No credits spent yet" />
      ) : (
        <ul className={styles.rows}>
          {rows.map((row) => (
            <li key={row.userId} className={styles.row}>
              <span className={styles.mark} aria-hidden="true">
                {(row.name || "?").charAt(0).toUpperCase()}
              </span>
              <span className={styles.rowMain}>
                <span className={styles.rowTitle}>
                  {row.name || <span className="font-normal text-text-muted">Unknown member</span>}
                </span>
              </span>
              {row.role && <span className={styles.tag}>{row.role}</span>}
              <span className={styles.mono}>{row.credits.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </OverviewCard>
  );
}

/** The busiest `(tool, op)` pairs, the finest grain the schema has. */
export function ToolsCard({ data }: { data: HomeOverview }) {
  const rows = data.tools ?? EMPTY_TOOL_USAGE;
  return (
    <OverviewCard title="MCP tools" count={rows.length}>
      {rows.length === 0 ? (
        <EmptyState variant="outline" title="No tool calls yet" />
      ) : (
        <ul className={styles.rows}>
          {rows.map((row) => (
            <li key={`${row.tool}:${row.op}`} className={styles.row}>
              <span className={styles.rowMain}>
                <span className={styles.rowTitle}>
                  <span className="font-mono">
                    {row.tool}
                    {row.op && <span className="font-normal text-text-muted">.{row.op}</span>}
                  </span>
                </span>
              </span>
              <span className={styles.mono}>{row.calls.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </OverviewCard>
  );
}

/** A clipped scan says so, once, under what it clipped. */
export function ClippedLine({ data }: { data: HomeOverview }) {
  if (!data.truncated) return null;
  return <p className={styles.note}>From the newest {data.scanned.toLocaleString()} events.</p>;
}
