// STAGING ONLY. Overview top: the summary strip, what needs you and what is running.
"use client";

import { MessageCircleQuestion, ShieldCheck, Zap } from "lucide-react";
import type { MockHost } from "@/features/overview-staging/overview-mock-data";
import { ECard, EDeviceMark, EEmpty, EMeter, ERuntime, EStatus } from "./overview-bits";
import { agentIndex, runTime, type Need } from "./overview-data";

export type Wallet = { used: number; limit: number; remaining: number; over: boolean } | null;

function Cell({ label, value, of, children }: { label: string; value: string; of?: string; children?: React.ReactNode }) {
  return (
    <div className="ove-cell">
      <span className="ove-cell-label">{label}</span>
      <span className="ove-cell-value">
        {value}
        {of && <span className="ove-cell-of">{of}</span>}
      </span>
      {children}
    </div>
  );
}

/** Working · Need you · Devices online · Credits left. Device cells only with the preview. */
export function SummaryStrip({
  hosts,
  needCount,
  devices,
  wallet,
}: {
  hosts: readonly MockHost[] | null;
  needCount: number;
  devices: { online: number; total: number } | null;
  wallet: Wallet;
}) {
  const agents = hosts?.flatMap((h) => h.agents) ?? [];
  const working = agents.filter((a) => a.state === "working").length;
  return (
    <section className="white-card ove-card ove-strip" aria-label="Summary">
      {hosts && <Cell label="Working" value={String(working)} of={`/ ${agents.length}`} />}
      <Cell label="Need you" value={String(needCount)} />
      {devices && <Cell label="Devices online" value={String(devices.online)} of={`/ ${devices.total}`} />}
      <Cell
        label="Credits left"
        value={wallet ? wallet.remaining.toLocaleString() : "—"}
        of={wallet ? `/ ${wallet.limit.toLocaleString()}` : undefined}
      >
        {wallet && <EMeter value={wallet.used} max={wallet.limit} tone={wallet.over ? "over" : undefined} />}
      </Cell>
    </section>
  );
}

export function NeedsCard({
  needs,
  creditsOut,
  onResolve,
  onGetCredits,
}: {
  needs: readonly Need[];
  creditsOut: boolean;
  onResolve: (id: string) => void;
  onGetCredits: () => void;
}) {
  const agents = agentIndex();
  const count = needs.length + (creditsOut ? 1 : 0);
  return (
    <ECard title="Needs you" count={count}>
      {count === 0 ? (
        <EEmpty>Nothing waiting</EEmpty>
      ) : (
        <ul className="ove-rows">
          {creditsOut && (
            <li className="ove-row ove-need">
              <span className="ove-need-icon" data-tone="over" aria-hidden="true">
                <Zap size={13} />
              </span>
              <span className="ove-row-main">
                <span className="ove-row-title">Out of credits</span>
                <span className="ove-row-meta">Tool calls are paused until the next period</span>
              </span>
              <span className="ove-actions">
                <button type="button" className="ove-btn" data-primary="true" onClick={onGetCredits}>
                  Get more credits
                </button>
              </span>
            </li>
          )}
          {needs.map((n) => {
            const agent = agents.get(n.agentId);
            return (
              <li key={n.id} className="ove-row ove-need">
                <span className="ove-need-icon" aria-hidden="true">
                  {n.kind === "permission" ? <ShieldCheck size={13} /> : <MessageCircleQuestion size={13} />}
                </span>
                <span className="ove-row-main">
                  <span className="ove-row-title">{n.ask}</span>
                  <span className="ove-row-meta">
                    {agent?.name ?? "Agent"} · {agent?.host ?? ""} · {n.at}
                  </span>
                </span>
                <span className="ove-actions">
                  {n.kind === "permission" ? (
                    <>
                      <button type="button" className="ove-btn" data-primary="true" onClick={() => onResolve(n.id)}>
                        Approve
                      </button>
                      <button type="button" className="ove-btn" onClick={() => onResolve(n.id)}>
                        Deny
                      </button>
                    </>
                  ) : (
                    <button type="button" className="ove-btn" onClick={() => onResolve(n.id)}>
                      Answer
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </ECard>
  );
}

/** Every running agent, under the computer that runs it. */
export function AgentsCard({ hosts }: { hosts: readonly MockHost[] }) {
  const total = hosts.reduce((n, h) => n + h.agents.length, 0);
  return (
    <ECard title="Agents" count={total}>
      <div className="ove-groups">
        {hosts.map((h) => (
          <div key={h.id} className="ove-group" role="group" aria-label={h.name}>
            <div className="ove-group-head">
              <EDeviceMark kind="computer" />
              <span className="ove-group-name">{h.name}</span>
              {h.thisComputer && <span className="ove-tag">This computer</span>}
              <EStatus status={h.status} />
            </div>
            {h.agents.length === 0 ? (
              <EEmpty>No agents running</EEmpty>
            ) : (
              <ul className="ove-rows">
                {h.agents.map((a) => (
                  <li key={a.id} className="ove-row">
                    <ERuntime runtime={a.runtime} />
                    <span className="ove-row-main">
                      <span className="ove-row-title">{a.name}</span>
                      <span className="ove-row-meta">
                        {a.channel} · {a.runtime}
                      </span>
                    </span>
                    <span className="ove-mono">{runTime(a.runningFor)}</span>
                    <span className="ove-state" data-state={a.state}>
                      <i aria-hidden="true" />
                      {a.state === "working" ? "Working" : "Waiting for you"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </ECard>
  );
}
