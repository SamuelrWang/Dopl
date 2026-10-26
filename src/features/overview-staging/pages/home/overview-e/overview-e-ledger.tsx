// STAGING ONLY — Overview Version E: where it went. One Channels table (credits AND messages on the
// same row, which Current splits into two rails), then People and MCP tools side by side.
// Built new; no Current / D component imported.
"use client";

import type { HomeOverview } from "@/features/home/overview-types";
import { ECard, EEmpty, EMeter } from "./overview-e-bits";

export function ChannelsTable({ data }: { data: HomeOverview }) {
  const rows = data.channels ?? [];
  const peak = Math.max(1, ...rows.map((r) => r.credits));
  return (
    <ECard title="Channels" count={rows.length}>
      {rows.length === 0 ? (
        <EEmpty>No channel activity this month</EEmpty>
      ) : (
        <table className="ove-table">
          <thead>
            <tr>
              <th scope="col">Channel</th>
              <th scope="col" className="ove-num">Credits</th>
              <th scope="col" className="ove-num">Messages</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.workspaceId}>
                <td>
                  <span className="ove-cell-name">
                    {r.name ? `#${r.name}` : <span className="ove-muted">Untitled channel</span>}
                  </span>
                </td>
                <td className="ove-num">
                  <span className="ove-num-meter">
                    <EMeter value={r.credits} max={peak} />
                    {r.credits.toLocaleString()}
                  </span>
                </td>
                <td className="ove-num">{r.messages.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ECard>
  );
}

export function PeopleCard({ data }: { data: HomeOverview }) {
  const rows = data.people ?? [];
  return (
    <ECard title="People" count={rows.length}>
      {rows.length === 0 ? (
        <EEmpty>No credits spent yet</EEmpty>
      ) : (
        <ul className="ove-rows">
          {rows.map((p) => (
            <li key={p.userId} className="ove-row">
              <span className="ove-initial" aria-hidden="true">
                {(p.name || "?").charAt(0).toUpperCase()}
              </span>
              <span className="ove-row-main">
                <span className="ove-row-title">{p.name || <span className="ove-muted">Unknown member</span>}</span>
              </span>
              {p.role && <span className="ove-tag">{p.role}</span>}
              <span className="ove-mono">{p.credits.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </ECard>
  );
}

export function ToolsCard({ data }: { data: HomeOverview }) {
  const rows = data.tools ?? [];
  return (
    <ECard title="MCP tools" count={rows.length}>
      {rows.length === 0 ? (
        <EEmpty>No tool calls yet</EEmpty>
      ) : (
        <ul className="ove-rows">
          {rows.map((t) => (
            <li key={`${t.tool}.${t.op}`} className="ove-row">
              <span className="ove-row-main">
                <span className="ove-row-title ove-code">
                  {t.tool}
                  {t.op && <span className="ove-muted">.{t.op}</span>}
                </span>
              </span>
              <span className="ove-mono">{t.calls.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </ECard>
  );
}

/** A clipped scan says so, once, under what it clipped. */
export function ClippedLine({ data }: { data: HomeOverview }) {
  if (!data.truncated) return null;
  return <p className="ove-note">From the newest {data.scanned.toLocaleString()} events.</p>;
}
