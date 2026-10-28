import { useState } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { formatClockTime } from "@/shared/lib/format-time";
import { EmptyState } from "@/shared/ui/empty-state";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { StatusPill } from "@/shared/ui/status-pill";
import { DeviceKindIcon } from "@/features/devices/components/device-glyph";
import { AgentFace } from "@/features/channels/components/agent-face";
import type { PreviewHost, PreviewLog, PreviewPresence, PreviewRoute } from "@/features/home/preview-types";
import { OverviewCard } from "./overview-card";
import styles from "./overview.module.css";
import parts from "./overview-preview.module.css";

const PRESENCE_WORD: Record<PreviewPresence, string> = { online: "Online", away: "Away", offline: "Offline" };

/** A presence word on the card's ground: green dot when online, warning word when away. */
export function Presence({ status, suffix }: { status: PreviewPresence; suffix?: string }) {
  return (
    <StatusPill bare dot tone={status === "online" ? "live" : status === "away" ? "attention" : "neutral"}>
      {PRESENCE_WORD[status]}
      {suffix && <span className="text-text-muted"> {suffix}</span>}
    </StatusPill>
  );
}

const runTime = (minutes: number) =>
  minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
const runtimeWord = (runtime: string) => runtime.charAt(0).toUpperCase() + runtime.slice(1);

/** Working agents over all agents, across every computer. */
export function agentTally(hosts: readonly PreviewHost[]): { working: number; total: number } {
  const agents = hosts.flatMap((host) => host.agents);
  return { working: agents.filter((agent) => agent.state === "working").length, total: agents.length };
}

/** Every running agent, under the computer that runs it. */
export function AgentsCard({ hosts }: { hosts: readonly PreviewHost[] }) {
  return (
    <OverviewCard title="Agents" count={agentTally(hosts).total} className={styles.slotAgents}>
      <div className={parts.groups}>
        {hosts.map((host) => (
          <div key={host.device} role="group" aria-label={host.name}>
            <div className={parts.groupHead}>
              <span className={styles.mark} data-shape="tile" aria-hidden="true">
                <DeviceKindIcon kind="computer" size={13} strokeWidth={1.8} />
              </span>
              <span className={parts.groupName}>{host.name}</span>
              {host.thisComputer && <span className={styles.tag}>This computer</span>}
              <Presence status={host.status} />
            </div>
            {host.agents.length === 0 ? (
              <p className={styles.note}>No agents running</p>
            ) : (
              <ul className={styles.rows}>
                {host.agents.map((agent) => (
                  <li key={agent.id} className={styles.row}>
                    <AgentFace size="s" photo={null} name={agent.name} color={null} runtime={agent.runtime} />
                    <span className={styles.rowMain}>
                      <span className={styles.rowTitle}>{agent.name}</span>
                      <span className={styles.rowMeta}>
                        #{agent.channelName} · {runtimeWord(agent.runtime)}
                      </span>
                    </span>
                    <span className={styles.mono}>{runTime(agent.runningMinutes)}</span>
                    <StatusPill bare dot tone={agent.state === "working" ? "live" : "attention"}>
                      {agent.state === "working" ? "Working" : "Waiting for you"}
                    </StatusPill>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </OverviewCard>
  );
}

type FeedTab = "routing" | "logs";

function RouteRow({ route }: { route: PreviewRoute }) {
  const landed = route.tried[route.tried.length - 1];
  return (
    <li className={cn(styles.row, parts.feed)}>
      <span className={cn(styles.mono, parts.time)}>{formatClockTime(route.at)}</span>
      <span className={styles.rowMain}>
        <span className={styles.rowTitle}>{route.summary}</span>
        <span className={styles.rowMeta} title={route.why}>
          {route.kind} from {route.from}
        </span>
      </span>
      <span className={parts.hops} aria-label={`Tried ${route.tried.join(", ")}; landed on ${landed}`}>
        {route.tried.map((device, i) => {
          const isLanded = i === route.tried.length - 1;
          return (
            <span key={`${device}-${i}`} className={parts.hop} data-landed={isLanded || undefined}>
              {isLanded ? <Check size={10} aria-hidden="true" /> : <X size={10} aria-hidden="true" />}
              {device}
            </span>
          );
        })}
      </span>
    </li>
  );
}

function LogRow({ log }: { log: PreviewLog }) {
  return (
    <li className={cn(styles.row, parts.feed)}>
      <span className={parts.level} data-level={log.level} aria-label={log.level} />
      <span className={cn(styles.mono, parts.time)}>{formatClockTime(log.at)}</span>
      <span className={styles.rowMain}>
        <span className={styles.rowTitle}>{log.event}</span>
        <span className={styles.rowMeta}>
          {log.device} · {log.detail}
        </span>
      </span>
    </li>
  );
}

/** Where each message to the operator landed (Routing), and what each device did (Logs). */
export function ActivityCard({
  routes,
  logs,
}: {
  routes: readonly PreviewRoute[];
  logs: readonly PreviewLog[];
}) {
  const [tab, setTab] = useState<FeedTab>(routes.length > 0 ? "routing" : "logs");
  const firstTry = routes.filter((route) => route.tried.length === 1).length;
  const rows = tab === "routing" ? routes.length : logs.length;
  return (
    <OverviewCard
      title="Activity"
      count={tab === "routing" ? `${firstTry}/${routes.length} first try` : logs.length}
      aside={
        <SegmentedControl
          options={[
            { key: "routing", label: "Routing" },
            { key: "logs", label: "Logs" },
          ]}
          value={tab}
          onChange={setTab}
          variant="underline"
          size="sm"
          ariaLabel="Activity feed"
        />
      }
    >
      {rows === 0 ? (
        <EmptyState variant="outline" title={tab === "routing" ? "Nothing routed yet" : "No device events"} />
      ) : (
        <ul className={styles.rows} aria-label={tab === "routing" ? "Routing" : "Logs"}>
          {tab === "routing"
            ? routes.map((route) => <RouteRow key={route.id} route={route} />)
            : logs.map((log) => <LogRow key={log.id} log={log} />)}
        </ul>
      )}
    </OverviewCard>
  );
}
