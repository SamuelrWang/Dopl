import { cn } from "@/shared/lib/utils";
import { IdentityStack } from "@/shared/ui/avatar-stack";
import { EmptyState } from "@/shared/ui/empty-state";
import { ThinMeter } from "@/shared/ui/usage-meter";
import {
  EMPTY_CHANNEL_USAGE,
  EMPTY_PERSON_USAGE,
  EMPTY_TOOL_USAGE,
  type HomeChannelUsage,
  type HomeOverview,
} from "@/features/home/overview-types";
import type { HomeChannelOption } from "@/features/home/components/overview/overview-credits";
import { Section } from "./proposed-section";
import styles from "./proposed.module.css";

/** The lower panel: Channels over People beside MCP tools, one surface, hairlines between. */
export function LedgerPanel({
  data,
  channels,
  onOpenChannel,
}: {
  data: HomeOverview;
  channels: readonly HomeChannelOption[];
  onOpenChannel: (workspaceId: string) => void;
}) {
  return (
    <div className={styles.panel}>
      <ChannelsSection data={data} channels={channels} onOpenChannel={onOpenChannel} />
      <div className={styles.pair}>
        <PeopleSection data={data} />
        <ToolsSection data={data} />
      </div>
    </div>
  );
}

/** One row per home channel: name and faces, credits beside a meter scaled to the top channel,
 *  then messages. A row whose channel is in the left pane's list opens it. */
function ChannelsSection({
  data,
  channels,
  onOpenChannel,
}: {
  data: HomeOverview;
  channels: readonly HomeChannelOption[];
  onOpenChannel: (workspaceId: string) => void;
}) {
  const rows = data.channels ?? EMPTY_CHANNEL_USAGE;
  const peak = Math.max(1, ...rows.map((row) => row.credits));
  const byWorkspace = new Map(channels.map((channel) => [channel.workspaceId, channel]));
  return (
    <Section title="Channels" count={rows.length}>
      {rows.length === 0 ? (
        <EmptyState variant="outline" title="No channel activity this month" />
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Channel</th>
              <th scope="col" className={styles.numCol}>
                Credits
              </th>
              <th scope="col" className={styles.numCol}>
                Messages
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.workspaceId}>
                <td className="font-medium">
                  <ChannelName
                    row={row}
                    channel={byWorkspace.get(row.workspaceId)}
                    onOpen={() => onOpenChannel(row.workspaceId)}
                  />
                </td>
                <td className={styles.numCol}>
                  <span className={styles.numMeter}>
                    <ThinMeter used={row.credits} limit={peak} className="w-14" />
                    {row.credits.toLocaleString()}
                  </span>
                </td>
                <td className={styles.numCol}>{row.messages.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function ChannelName({
  row,
  channel,
  onOpen,
}: {
  row: HomeChannelUsage;
  channel: HomeChannelOption | undefined;
  onOpen: () => void;
}) {
  const label = row.name ? `#${row.name}` : "Untitled channel";
  const faces = channel?.faces ?? [];
  const body = (
    <>
      <span className={row.name ? "truncate" : "truncate text-text-muted"}>{label}</span>
      {faces.length > 0 && (
        <IdentityStack
          size="s"
          max={3}
          faces={faces.map((f) => ({ key: f.userId, photo: f.avatarUrl, name: f.displayName }))}
        />
      )}
    </>
  );
  if (!channel) return <span className={styles.name}>{body}</span>;
  return (
    <button type="button" className={cn(styles.name, styles.open)} aria-label={`Open ${label}`} onClick={onOpen}>
      {body}
    </button>
  );
}

/** Credits per person; `role` is the container role, the only place `guest` exists. */
function PeopleSection({ data }: { data: HomeOverview }) {
  const rows = data.people ?? EMPTY_PERSON_USAGE;
  return (
    <Section title="People" count={rows.length}>
      {rows.length === 0 ? (
        <EmptyState variant="outline" title="No credits spent yet" />
      ) : (
        <ul className={styles.rows}>
          {rows.map((row) => (
            <li key={row.userId} className={styles.row}>
              <span className={styles.slot} aria-hidden="true">
                {(row.name || "?").charAt(0).toUpperCase()}
              </span>
              <span className={styles.rowMain}>
                <span className={styles.rowTitle}>
                  {row.name || <span className="font-normal text-text-muted">Unknown member</span>}
                </span>
              </span>
              {row.role === "guest" && <span className={styles.tag}>Guest</span>}
              <span className={styles.num}>{row.credits.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** The busiest `(tool, op)` pairs. The tool name is an identifier, so it alone stays monospace. */
function ToolsSection({ data }: { data: HomeOverview }) {
  const rows = data.tools ?? EMPTY_TOOL_USAGE;
  return (
    <Section title="MCP tools" count={rows.length}>
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
              <span className={styles.num}>{row.calls.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
