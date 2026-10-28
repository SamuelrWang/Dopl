import { useState } from "react";
import { formatClockTime } from "@/shared/lib/format-time";
import { EmptyState } from "@/shared/ui/empty-state";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { AgentFace } from "@/features/channels/components/agent-face";
import type { PreviewHost, PreviewLog, PreviewRoute } from "@/features/home/preview-types";
import { agentTally } from "@/features/home/components/overview/overview-agents";
import { Section, runTime } from "./proposed-section";
import styles from "./proposed.module.css";

const runtimeWord = (runtime: string) => runtime.charAt(0).toUpperCase() + runtime.slice(1);

/** Every running agent, grouped under the computer that runs it. The group's name is a quiet
 *  subheader only: the Devices section owns presence. */
export function AgentsSection({ hosts }: { hosts: readonly PreviewHost[] }) {
  return (
    <Section title="Agents" count={agentTally(hosts).total}>
      <div>
        {hosts.map((host) => (
          <div key={host.device} role="group" aria-label={host.name} className={styles.group}>
            <div className={styles.groupName}>{host.name}</div>
            {host.agents.length === 0 ? (
              <p className={styles.note}>No agents running</p>
            ) : (
              <ul className={styles.rows}>
                {host.agents.map((agent) => (
                  <li key={agent.id} className={styles.row}>
                    <span className={styles.slot} data-bare="true">
                      <AgentFace size="s" photo={null} name={agent.name} color={null} runtime={agent.runtime} />
                    </span>
                    <span className={styles.rowMain}>
                      <span className={styles.rowTitle}>{agent.name}</span>
                      <span className={styles.rowMeta}>
                        #{agent.channelName} · {runtimeWord(agent.runtime)}
                      </span>
                    </span>
                    <span className={styles.num}>{runTime(agent.runningMinutes)}</span>
                    <span className={styles.state} data-tone={agent.state === "waiting" ? "attention" : undefined}>
                      {agent.state === "working" ? "Working" : "Waiting for you"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

type FeedTab = "routing" | "logs";

function RouteRow({ route }: { route: PreviewRoute }) {
  const landed = route.tried[route.tried.length - 1];
  return (
    <li className={styles.row}>
      <span className={styles.time}>{formatClockTime(route.at)}</span>
      <span className={styles.rowMain}>
        <span className={styles.rowTitle}>{route.summary}</span>
        <span className={styles.rowMeta} title={route.why}>
          {route.kind} · {route.from}
        </span>
      </span>
      <span className={styles.hops} aria-label={`Tried ${route.tried.join(", ")}; landed on ${landed}`}>
        {route.tried.map((device, i) => (
          <span key={`${device}-${i}`} className={styles.hop} data-landed={i === route.tried.length - 1 || undefined}>
            {device}
          </span>
        ))}
      </span>
    </li>
  );
}

function LogRow({ log }: { log: PreviewLog }) {
  return (
    <li className={styles.row}>
      <span className={styles.level} data-level={log.level} aria-label={log.level} />
      <span className={styles.time}>{formatClockTime(log.at)}</span>
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
export function ActivitySection({
  routes,
  logs,
}: {
  routes: readonly PreviewRoute[];
  logs: readonly PreviewLog[];
}) {
  const [tab, setTab] = useState<FeedTab>(routes.length > 0 ? "routing" : "logs");
  const rows = tab === "routing" ? routes.length : logs.length;
  return (
    <Section
      title="Activity"
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
    </Section>
  );
}
