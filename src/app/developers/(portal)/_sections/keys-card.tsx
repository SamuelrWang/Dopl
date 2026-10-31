"use client";

/** A key: what it is, whether it is in use, what it may do, how much it does, what to do with it. */
import { Copy, Globe, KeyRound, RefreshCw, type LucideIcon } from "lucide-react";
import { Badge, Button, Card, ICON_SM, Initials, initialsOf, type Tone } from "../_design/ui";
import { AddCard, CardFoot, CardHead, ChipRow, Figure, FigureWell, Mark, Text } from "../_design/ui-page";
import type { ApiKeyRow } from "../_data/misc";
import { fmt, since } from "../_components/ui";
import { oldSecretLeft, stateOf, type KeyKind } from "./keys-model";

export const KIND_GLYPH: Record<KeyKind, LucideIcon> = { secret: KeyRound, publishable: Globe };
const TONE: Record<"ok" | "warn" | "plain", Tone> = { ok: "ok", warn: "warn", plain: "neutral" };

export function KeyCard({ row, onRotate, onRevoke, onCopy }: { row: ApiKeyRow; onRotate: () => void; onRevoke: () => void; onCopy: (token: string) => void }) {
  const state = stateOf(row);
  const left = oldSecretLeft(row);
  return (
    <Card label={row.name}>
      <CardHead
        mark={<Mark icon={KIND_GLYPH[row.kind]} tone={row.revoked ? "ring" : "ink"} />}
        title={row.name}
        sub={<Text kind="token">{row.token ?? `${row.prefix}••••`}</Text>}
        badges={
          <>
            <Badge tone={TONE[state.tone]} dot={state.tone === "ok"}>
              {state.label}
            </Badge>
            {left && <Badge tone="warn">{left}</Badge>}
          </>
        }
      />
      <ChipRow>
        {row.scopes.map((scope) => (
          <Badge key={scope} tone="ring">
            {scope}
          </Badge>
        ))}
      </ChipRow>
      <FigureWell>
        {row.revoked ? <Figure label="Revoked" value={since(row.revokedAt ?? null)} /> : <Figure label="Last used" value={since(row.lastUsedAt)} />}
        <Figure label="Calls, 7d" value={fmt(row.calls7d)} />
        <Figure label="Created" value={since(row.createdAt)} />
      </FigureWell>
      <CardFoot
        main={
          <>
            <Initials text={initialsOf(row.createdBy)} small />
            <Text kind="small" clip>
              {row.createdBy}
            </Text>
          </>
        }
      >
        {!row.revoked && (
          <>
            {row.token ? (
              <Button size="sm" onClick={() => onCopy(row.token!)}>
                <Copy {...ICON_SM} aria-hidden="true" />
                Copy
              </Button>
            ) : (
              <Button size="sm" onClick={onRotate}>
                <RefreshCw {...ICON_SM} aria-hidden="true" />
                Rotate
              </Button>
            )}
            <Button size="sm" variant="dangerOutline" onClick={onRevoke}>
              Revoke
            </Button>
          </>
        )}
      </CardFoot>
    </Card>
  );
}

/** Stands in for an empty section and starts the flow on that type. */
export function AddKeyCard({ label, env, onClick }: { label: string; env: string; onClick: () => void }) {
  return <AddCard wide title={label} sub={env} onClick={onClick} />;
}
