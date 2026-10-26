// STAGING ONLY — Overview Version D, the HERO: what is happening right now and what needs you.
// The one big card the page leads with; everything below it supports it.
"use client";

import { AgentFace, Pill } from "./overview-d-bits";
import { duration, type LiveAgent, type Need } from "./overview-d-data";

export function NowHero({
  agents,
  needs,
  creditsOut,
  devices,
  onResolve,
  onGetCredits,
}: {
  agents: readonly LiveAgent[];
  /** Open asks, newest first. */
  needs: readonly Need[];
  /** The wallet is empty: tool calls are paused, which is itself something that needs you. */
  creditsOut: boolean;
  /** Devices online / total, or null when the devices preview is off. */
  devices: { online: number; total: number } | null;
  onResolve: (id: string) => void;
  onGetCredits: () => void;
}) {
  const waitingOn = new Set(needs.map((n) => n.agentId));
  const working = agents.filter((a) => a.state === "working" && !waitingOn.has(a.id)).length;
  const needCount = needs.length + (creditsOut ? 1 : 0);
  const byId = new Map(agents.map((a) => [a.id, a]));

  return (
    <section className="ovd-hero" aria-label="Right now">
      <header className="ovd-hero-head">
        <h2 className="ovd-hero-title">Right now</h2>
        <span className="ovd-live">
          <i aria-hidden />
          Live
        </span>
      </header>

      <dl className="ovd-figures">
        <div>
          <dt>Working</dt>
          <dd>{working}</dd>
        </div>
        <div data-tone={needCount > 0 ? "needs-you" : undefined}>
          <dt>Need you</dt>
          <dd>{needCount}</dd>
        </div>
        {devices && (
          <div>
            <dt>Devices online</dt>
            <dd>
              {devices.online}
              <span className="ovd-figure-of">/{devices.total}</span>
            </dd>
          </div>
        )}
      </dl>

      <div className="ovd-hero-body">
        <div className="ovd-hero-col" aria-label="Agents">
          <p className="ovd-col-label">Agents</p>
          {agents.length === 0 ? (
            <p className="ovd-empty">No agents running.</p>
          ) : (
            <ul className="ovd-log">
              {agents.map((a) => {
                const waiting = waitingOn.has(a.id);
                return (
                  <li key={a.id} className="ovd-log-row">
                    <AgentFace runtime={a.runtime} d={30} />
                    <div className="ovd-log-body">
                      <p className="ovd-log-name">
                        {a.name}
                        <span className="ovd-log-time">{duration(a.runningFor)}</span>
                      </p>
                      <p className="ovd-log-did">
                        {a.channel}
                        <span className="ovd-log-where"> · {a.host}</span>
                      </p>
                    </div>
                    {waiting ? (
                      <Pill tone="needs-you">Waiting for you</Pill>
                    ) : a.state === "working" ? (
                      <Pill tone="live">Working</Pill>
                    ) : (
                      <Pill>Waiting</Pill>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="ovd-hero-col ovd-hero-asks" aria-label="Needs you">
          <p className="ovd-col-label">Needs you</p>
          {needCount === 0 && <p className="ovd-empty">Nothing needs you.</p>}
          {creditsOut && (
            <article className="ovd-notif">
              <div className="ovd-notif-text">
                <p className="ovd-notif-title">Out of credits</p>
                <p className="ovd-notif-body">Tool calls are paused until you add credits.</p>
                <div className="ovd-notif-actions">
                  <button type="button" className="ovd-btn" onClick={onGetCredits}>
                    Get more credits
                  </button>
                </div>
              </div>
            </article>
          )}
          {needs.map((n) => {
            const agent = byId.get(n.agentId);
            return (
              <article key={n.id} className="ovd-notif">
                {agent && <AgentFace runtime={agent.runtime} d={24} />}
                <div className="ovd-notif-text">
                  <p className="ovd-notif-title">
                    {agent?.name ?? "An agent"}
                    <span className="ovd-log-time">{n.at}</span>
                  </p>
                  <p className="ovd-notif-body">{n.ask}</p>
                  <div className="ovd-notif-actions">
                    {n.kind === "permission" ? (
                      <>
                        <button type="button" className="ovd-btn" onClick={() => onResolve(n.id)}>
                          Approve
                        </button>
                        <button
                          type="button"
                          className="ovd-btn"
                          data-variant="outline"
                          onClick={() => onResolve(n.id)}
                        >
                          Deny
                        </button>
                      </>
                    ) : (
                      <button type="button" className="ovd-btn" onClick={() => onResolve(n.id)}>
                        Answer
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
