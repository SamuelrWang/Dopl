"use client";

/** Add an endpoint, one decision per page: where, which events, then its signing secret once. */
import { AlertTriangle, Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button, ICON_SM } from "../_design/ui";
import { Alert, FlowDialog, Grow, SecretWell, Stack, Text, TextField, Tile, Tiles } from "../_design/ui-page";
import { ALL_WEBHOOK_EVENTS } from "../_data/misc";

const SECRET = "whsec_9Kp2mXv7Lq4Rt8Nc3Yb6Hd";

export function AddEndpointFlow({ onClose, onAdd }: { onClose: () => void; onAdd: (url: string, description: string, events: string[]) => void }) {
  const [step, setStep] = useState(0);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [events, setEvents] = useState<string[]>(["ask.answered", "action.completed", "action.failed"]);
  const [copied, setCopied] = useState(false);
  const validUrl = /^https:\/\/\S+\.\S+/.test(url);

  if (step === 2) {
    return (
      <FlowDialog
        key="secret"
        label="Signing secret"
        eyebrow={name}
        title="Copy your signing secret"
        onDismiss={null}
        foot={
          <>
            <Grow />
            <Button variant="ink" onClick={onClose}>
              Done
            </Button>
          </>
        }
      >
        <Stack>
          <SecretWell
            value={SECRET}
            action={
              <Button
                size="sm"
                label="Copy secret"
                onClick={() => {
                  void navigator.clipboard?.writeText(SECRET);
                  setCopied(true);
                }}
              >
                {copied ? <Check {...ICON_SM} aria-hidden="true" /> : <Copy {...ICON_SM} aria-hidden="true" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            }
          />
          <Alert tone="warn" icon={AlertTriangle}>
            Shown once. Store it now.
          </Alert>
        </Stack>
      </FlowDialog>
    );
  }
  return (
    <FlowDialog
      label="Add endpoint"
      eyebrow={`Step ${step + 1} of 2`}
      title={step === 0 ? "Where should events go?" : "Choose events"}
      progress={{ step, of: 2 }}
      onDismiss={onClose}
      foot={
        <>
          {step > 0 && (
            <Button variant="ghost" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          <Grow />
          {step === 0 ? (
            <Button variant="ink" disabled={!validUrl || name.trim() === ""} onClick={() => setStep(1)}>
              Continue
            </Button>
          ) : (
            <Button
              variant="ink"
              disabled={events.length === 0}
              onClick={() => {
                onAdd(url, name.trim(), events);
                setStep(2);
              }}
            >
              Add endpoint
            </Button>
          )}
        </>
      }
    >
      {step === 0 ? (
        <Stack>
          <Text kind="strong">Name</Text>
          <TextField autoFocus label="Name" placeholder="Production backend" value={name} onChange={setName} />
          <Text kind="strong">URL</Text>
          <TextField label="URL" placeholder="https://" value={url} onChange={setUrl} />
        </Stack>
      ) : (
        <Tiles>
          {ALL_WEBHOOK_EVENTS.map((event) => {
            const on = events.includes(event);
            return (
              <Tile key={event} selected={on} onClick={() => setEvents(on ? events.filter((x) => x !== event) : [...events, event])}>
                <Text kind="mono" clip>
                  {event}
                </Text>
              </Tile>
            );
          })}
        </Tiles>
      )}
    </FlowDialog>
  );
}
