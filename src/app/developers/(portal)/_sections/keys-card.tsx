"use client";

/** A key: what it is, whether it is in use, what it may do, how much it does, what to do with it. */
import { Globe, KeyRound, RefreshCw, type LucideIcon } from "lucide-react";
import type { KeyView } from "@/features/device-sdk/portal/view";
import { Badge, Button, Card, ICON_SM, Initials, initialsOf } from "../_design/ui";
import { CardFoot, CardHead, ChipRow, Figure, FigureWell, Mark, Text } from "../_design/ui-page";
import { fmt, since } from "../_components/format";
import { isDead, oldSecretLeft, stateOf, type KeyKind } from "./keys-model";

export const KIND_GLYPH: Record<KeyKind, LucideIcon> = { secret: KeyRound, publishable: Globe };

export function KeyCard({ row, canManage, onRotate, onRevoke }: { row: KeyView; canManage: boolean; onRotate: () => void; onRevoke: () => void }) {
  const state = stateOf(row);
  const left = oldSecretLeft(row);
  const dead = isDead(row);
  return (
    <Card label={row.name}>
      <CardHead
        mark={<Mark icon={KIND_GLYPH[row.kind]} tone={dead ? "ring" : "ink"} />}
        title={row.name}
        sub={<Text kind="token">{`${row.prefix}••••`}</Text>}
        badges={
          <>
            <Badge tone={state.tone} dot={state.tone === "ok"}>
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
        {row.revokedAt ? <Figure label="Revoked" value={since(row.revokedAt)} /> : <Figure label="Last used" value={since(row.lastUsedAt)} />}
        <Figure label="Calls, 7d" value={fmt(row.calls7d)} />
        <Figure label="Created" value={since(row.createdAt)} />
      </FigureWell>
      <CardFoot
        main={
          row.createdBy && (
            <>
              <Initials text={initialsOf(row.createdBy)} small />
              <Text kind="small" clip>
                {row.createdBy}
              </Text>
            </>
          )
        }
      >
        {row.locked ? (
          <Badge>Used by Dopl</Badge>
        ) : (
          canManage &&
          !dead && (
            <>
              {row.kind === "secret" && !row.expiresAt && (
                <Button size="sm" onClick={onRotate}>
                  <RefreshCw {...ICON_SM} aria-hidden="true" />
                  Rotate
                </Button>
              )}
              <Button size="sm" variant="dangerOutline" onClick={onRevoke}>
                Revoke
              </Button>
            </>
          )
        )}
      </CardFoot>
    </Card>
  );
}
