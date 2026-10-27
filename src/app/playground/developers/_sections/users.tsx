"use client";

import { useState } from "react";
import type { Connection } from "@dopl/contracts/device-sdk";
import { CAPABILITY_FAMILY, CAPABILITY_RISK_TIER, RISK_TIERS } from "@dopl/contracts/device-sdk";
import type { CapabilityId, CapabilityScope, RiskTier } from "@dopl/contracts/device-sdk";
import { cn } from "@/shared/lib/utils";
import { SearchField } from "@/shared/ui/search-field";
import { StatusPill } from "@/shared/ui/status-pill";
import { usePortal } from "../_components/portal-context";
import { Card, Chip, Chips, Table, TierChip, deviceName, ov, since } from "../_components/ui";

/** The tiers a scope reaches: one id → its tier; a family wildcard → every tier in that family. */
export function tiersOf(scope: CapabilityScope): RiskTier[] {
  if (!scope.endsWith(".*")) return [CAPABILITY_RISK_TIER[scope as CapabilityId]];
  const family = scope.slice(0, -2);
  const ids = (Object.keys(CAPABILITY_FAMILY) as CapabilityId[]).filter((id) => CAPABILITY_FAMILY[id] === family);
  return RISK_TIERS.filter((t) => ids.some((id) => CAPABILITY_RISK_TIER[id] === t));
}

function statusPill(c: Connection) {
  if (c.status === "revoked") return <StatusPill>Revoked</StatusPill>;
  if (c.status === "needs_reauth") return <StatusPill tone="attention">Needs re-auth</StatusPill>;
  return (
    <StatusPill tone="live" dot bare>
      Active
    </StatusPill>
  );
}

export function UsersSection() {
  const { fx } = usePortal();
  const [query, setQuery] = useState("");
  const all = [...new Set(fx.connections.map((c) => c.external_user_id))];
  const users = all.filter((u) => u.includes(query.trim()));

  return (
    <Card
      title="End users"
      count={users.length === all.length ? all.length : `${users.length} of ${all.length}`}
      aside={<SearchField value={query} onChange={setQuery} placeholder="external_user_id" size="sm" className="w-52" />}
    >
      <Table columns={["User", "Device", "Status", "Granted scopes", "Tiers", "Connected"]}>
        {users.flatMap((u) =>
          fx.connections
            .filter((c) => c.external_user_id === u)
            .map((c, i) => {
              const tiers = RISK_TIERS.filter((t) => c.grants.some((g) => tiersOf(g.scope).includes(t)));
              return (
                <tr key={c.id} className={cn(c.status === "revoked" && "opacity-50")}>
                  <td className="whitespace-nowrap font-mono text-small">{i === 0 ? u : ""}</td>
                  <td>
                    <span className="flex flex-col py-1.5">
                      <span className="whitespace-nowrap font-medium">{deviceName(c.device)}</span>
                      <span className={cn(ov.rowMeta, "font-mono")}>{c.id}</span>
                    </span>
                  </td>
                  <td className="whitespace-nowrap">{statusPill(c)}</td>
                  <td>
                    <Chips>
                      {c.grants.map((g) => (
                        <Chip key={g.scope}>
                          {g.scope}
                          {g.expires_at && ` · ${since(g.expires_at)}`}
                        </Chip>
                      ))}
                    </Chips>
                  </td>
                  <td>
                    <Chips>
                      {tiers.map((t) => (
                        <TierChip key={t} tier={t} />
                      ))}
                    </Chips>
                  </td>
                  <td className="whitespace-nowrap text-text-muted">{since(c.created_at)}</td>
                </tr>
              );
            })
        )}
      </Table>
    </Card>
  );
}
