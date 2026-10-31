"use client";

/** Everything that interrupts the list: the create flow, the once-only reveal, rotate and revoke. */
import { Activity, AlertTriangle, Check, Copy, Cpu, RefreshCw, Send, SlidersHorizontal, Users, Webhook, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Badge, Button, ICON_SM, Segmented, TwoLine } from "../_design/ui";
import { Alert, ChipRow, CodeBlock, CodeDim, CodeStrong, ConfirmDialog, FlowDialog, Grow, Mark, ReviewWell, Row, SecretWell, Stack, Text, TextField, Tile, Tiles } from "../_design/ui-page";
import type { Env } from "../_data/company";
import { KEY_SCOPES, type ApiKeyRow } from "../_data/misc";
import { fmt, since } from "../_components/ui";
import { KIND_GLYPH } from "./keys-card";
import { GRACE, inUse, type KeyKind } from "./keys-model";

const ENV_LABEL: Record<Env, string> = { live: "Live", test: "Test" };
const KIND_LABEL: Record<KeyKind, string> = { secret: "Secret", publishable: "Publishable" };
const SCOPE_GLYPH: Record<string, LucideIcon> = { deliver: Send, "devices.act": SlidersHorizontal, "devices.read": Cpu, "users.read": Users, "events.read": Activity, "webhooks.write": Webhook };

const STEP_TYPE = "Choose a key type";
const STEP_SCOPES = "Choose what it can do";
const STEP_NAME = "Name this key";

export const copyText = (text: string) => void navigator.clipboard?.writeText(text)?.catch(() => {});

function CopyWell({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <SecretWell
      value={value}
      action={
        <Button
          size="sm"
          label={label}
          onClick={() => {
            copyText(value);
            setCopied(true);
          }}
        >
          {copied ? <Check {...ICON_SM} aria-hidden="true" /> : <Copy {...ICON_SM} aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      }
    />
  );
}

function Reveal({ kind, token }: { kind: KeyKind; token: string }) {
  return (
    <Stack>
      <CopyWell value={token} label={kind === "secret" ? "Copy secret" : "Copy key"} />
      {kind === "secret" && (
        <>
          <Alert tone="warn" icon={AlertTriangle}>
            Shown once. Store it now.
          </Alert>
          <CodeBlock title="Send a first delivery">
            <CodeDim>{"# POST /v1/deliver\n"}</CodeDim>
            {"curl -X POST https://api.usedopl.com/v1/deliver \\\n  -H "}
            <CodeStrong>{`"Authorization: Bearer ${token.slice(0, token.lastIndexOf("_") + 5)}…"`}</CodeStrong>
            {" \\\n  -d "}
            <CodeStrong>{`'{"target": {"device_id": "dev_g2_77d0"},\n       "content": {"text": "Hello"}}'`}</CodeStrong>
          </CodeBlock>
        </>
      )}
    </Stack>
  );
}

const DoneFoot = ({ onDone }: { onDone: () => void }) => (
  <>
    <Grow />
    <Button variant="ink" onClick={onDone}>
      Done
    </Button>
  </>
);

/** A rotation's new secret, on its own. */
export function RevealDialog({ row, token, onDone }: { row: ApiKeyRow; token: string; onDone: () => void }) {
  return (
    <FlowDialog label="Copy your new secret" eyebrow={`${row.name}, ${ENV_LABEL[row.env]}`} title="Copy your new secret" onDismiss={null} foot={<DoneFoot onDone={onDone} />}>
      <Reveal kind={row.kind} token={token} />
    </FlowDialog>
  );
}

export function CreateKeyFlow({ env, initialKind, onCreate, onClose }: { env: Env; initialKind: KeyKind | null; onCreate: (input: { name: string; kind: KeyKind; scopes: string[] }) => string; onClose: () => void }) {
  const [step, setStep] = useState(initialKind ? 1 : 0);
  const [kind, setKind] = useState<KeyKind | null>(initialKind);
  const [scopes, setScopes] = useState<string[]>(["deliver"]);
  const [name, setName] = useState("");
  const [token, setToken] = useState<string | null>(null);

  if (token && kind) {
    return (
      <FlowDialog key="reveal" label="Key created" eyebrow={`${name.trim()}, ${ENV_LABEL[env]}`} title={kind === "secret" ? "Copy your secret key" : "Copy your publishable key"} onDismiss={null} foot={<DoneFoot onDone={onClose} />}>
        <Reveal kind={kind} token={token} />
      </FlowDialog>
    );
  }

  const steps = kind === "publishable" ? [STEP_TYPE, STEP_NAME] : [STEP_TYPE, STEP_SCOPES, STEP_NAME];
  const title = steps[step];
  const last = step === steps.length - 1;
  const canContinue = title === STEP_TYPE ? kind !== null : title === STEP_SCOPES ? scopes.length > 0 : name.trim() !== "";
  const create = () => {
    if (!kind || !canContinue) return;
    setToken(onCreate({ name: name.trim(), kind, scopes }));
  };
  const typeTile = (value: KeyKind, sub: string) => (
    <Tile selected={kind === value} onClick={() => setKind(value)}>
      <Mark icon={KIND_GLYPH[value]} />
      <TwoLine title={KIND_LABEL[value]} sub={sub} />
    </Tile>
  );

  return (
    <FlowDialog
      label="Create key"
      eyebrow={`Step ${step + 1} of ${steps.length}`}
      title={title}
      progress={{ step, of: steps.length }}
      onDismiss={onClose}
      foot={
        <>
          {step > 0 && (
            <Button variant="ghost" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          <Grow />
          <Button variant="ink" disabled={!canContinue} onClick={last ? create : () => setStep(step + 1)}>
            {last ? "Create key" : "Continue"}
          </Button>
        </>
      }
    >
      {title === STEP_TYPE && (
        <Tiles>
          {typeTile("secret", "Server only")}
          {typeTile("publishable", "Client code")}
        </Tiles>
      )}
      {title === STEP_SCOPES && (
        <Tiles>
          {KEY_SCOPES.map(({ id, name: scopeName }) => {
            const on = scopes.includes(id);
            return (
              <Tile key={id} selected={on} onClick={() => setScopes(on ? scopes.filter((s) => s !== id) : [...scopes, id])}>
                <Row>
                  <Mark icon={SCOPE_GLYPH[id]} />
                  <TwoLine title={scopeName} sub={id} />
                </Row>
              </Tile>
            );
          })}
        </Tiles>
      )}
      {title === STEP_NAME && (
        <Stack>
          <TextField autoFocus label="Key name" placeholder="Production backend" value={name} onChange={setName} onEnter={create} />
          <ReviewWell
            items={[
              ["Environment", ENV_LABEL[env]],
              ["Type", kind ? KIND_LABEL[kind] : ""],
            ]}
          />
          <ChipRow>
            {(kind === "publishable" ? ["connect"] : scopes).map((scope) => (
              <Badge key={scope} tone="ring">
                {scope}
              </Badge>
            ))}
          </ChipRow>
        </Stack>
      )}
    </FlowDialog>
  );
}

const usage = (row: ApiKeyRow) => `${row.prefix}, ${row.lastUsedAt ? `used ${since(row.lastUsedAt).toLowerCase()}` : "never used"}, ${fmt(row.calls7d)} calls in 7d`;

export function RevokeDialog({ row, onCancel, onConfirm }: { row: ApiKeyRow; onCancel: () => void; onConfirm: () => void }) {
  return (
    <ConfirmDialog
      label={`Revoke ${row.name}`}
      mark={<Mark icon={AlertTriangle} tone="danger" />}
      title={`Revoke ${row.name}?`}
      sub={usage(row)}
      onCancel={onCancel}
      action={
        <Button full variant="dangerFlat" onClick={onConfirm}>
          Revoke key
        </Button>
      }
    >
      {inUse(row) && (
        <Alert tone="error" icon={AlertTriangle}>
          In use. Its calls fail at once.
        </Alert>
      )}
    </ConfirmDialog>
  );
}

export function RotateDialog({ row, onCancel, onConfirm }: { row: ApiKeyRow; onCancel: () => void; onConfirm: (graceHours: number) => void }) {
  const [grace, setGrace] = useState(GRACE.length - 1);
  return (
    <ConfirmDialog
      label={`Rotate ${row.name}`}
      mark={<Mark icon={RefreshCw} />}
      title={`Rotate ${row.name}?`}
      sub={usage(row)}
      onCancel={onCancel}
      action={
        <Button full variant="ink" onClick={() => onConfirm(GRACE[grace].hours)}>
          Rotate key
        </Button>
      }
    >
      <Stack>
        <Text kind="strong">Old secret stops working</Text>
        <Segmented label="Old secret stops working" options={GRACE.map((g) => g.label)} value={grace} onChange={setGrace} />
      </Stack>
    </ConfirmDialog>
  );
}
