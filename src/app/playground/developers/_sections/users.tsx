"use client";

import { useState } from "react";
import type { Connection } from "@dopl/contracts/device-sdk";
import { CAPABILITY_FAMILY, CAPABILITY_RISK_TIER, RISK_TIERS } from "@dopl/contracts/device-sdk";
import type { CapabilityId, CapabilityScope, RiskTier } from "@dopl/contracts/device-sdk";
import { cn } from "@/shared/lib/utils";
import { SearchField } from "@/shared/ui/search-field";
import { StatusPill } from "@/shared/ui/status-pill";
import { usePortal } from "../_components/portal-context";
import { Chip, Muted, PageHeader, Table, Td, TierChip, deviceName, since } from "../_components/ui";

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
  const users = [...new Set(fx.connections.map((c) => c.external_user_id))].filter((u) => u.includes(query.trim()));

  return (
    <>
      <PageHeader title="End users" action={<SearchField value={query} onChange={setQuery} placeholder="external_user_id" />} />
      <Table columns={["external_user_id", "Device", "Status", "Granted scopes", "Tiers", "Connected"]}>
        {users.flatMap((u) =>
          fx.connections
            .filter((c) => c.external_user_id === u)
            .map((c, i) => {
              const tiers = RISK_TIERS.filter((t) => c.grants.some((g) => tiersOf(g.scope).includes(t)));
              return (
                <tr key={c.id} className={cn(c.status === "revoked" && "opacity-50")}>
                  <Td mono className="whitespace-nowrap">
                    {i === 0 ? u : ""}
                  </Td>
                  <Td>
                    <div className="flex flex-col">
                      <span className="whitespace-nowrap">{deviceName(c.device)}</span>
                      <span className="font-mono text-micro text-text-muted">{c.id}</span>
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap">{statusPill(c)}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {c.grants.map((g) => (
                        <Chip key={g.scope}>
                          {g.scope}
                          {g.expires_at && <span className="ml-1 text-text-muted">· {since(g.expires_at)}</span>}
                        </Chip>
                      ))}
                    </div>
                  </Td>
                  <Td>
                    <div className="flex gap-1">
                      {tiers.map((t) => (
                        <TierChip key={t} tier={t} />
                      ))}
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap">
                    <Muted>{since(c.created_at)}</Muted>
                  </Td>
                </tr>
              );
            })
        )}
      </Table>
    </>
  );
}
