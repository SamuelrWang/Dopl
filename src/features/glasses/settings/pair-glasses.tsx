"use client";

import { useState } from "react";
import { userFacingMessage } from "@/shared/api/user-facing-message";
import { SelectMenu } from "@/shared/ui/select-menu";
import { toast } from "@/shared/ui/toast";
import { cn } from "@/shared/lib/utils";
import { PAGE_ACTION_BTN } from "@/shared/ui/page-action-button";
import { RAISED_INPUT } from "@/shared/ui/wells";
import {
  PAIRING_CODE_LENGTH,
  claimPairing,
  normalizePairingCode,
} from "./glasses-api";
import {
  NO_CHANNEL,
  useGlassesChannelOptions,
  useInvalidateGlassesDevices,
} from "./use-glasses";

/** Pair a pair of glasses by the code on its lens (Settings > Connect > Devices). */
export function PairGlasses() {
  const [code, setCode] = useState("");
  const [channelId, setChannelId] = useState(NO_CHANNEL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channelOptions = useGlassesChannelOptions();
  const invalidate = useInvalidateGlassesDevices();
  const ready = code.length === PAIRING_CODE_LENGTH && !busy;

  async function pair() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await claimPairing({
        code,
        ...(channelId !== NO_CHANNEL ? { channel_id: channelId } : {}),
      });
      setCode("");
      setChannelId(NO_CHANNEL);
      toast({ title: "Glasses paired" });
      await invalidate();
    } catch (err) {
      setError(userFacingMessage(err, "Couldn't pair"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="glasses-pair-code"
          type="text"
          value={code}
          onChange={(e) => {
            setCode(normalizePairingCode(e.target.value));
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            e.preventDefault();
            void pair();
          }}
          autoComplete="off"
          spellCheck={false}
          aria-label="Pairing code"
          placeholder="Code"
          className={cn(RAISED_INPUT, "w-28 px-2.5 py-1.5 font-mono uppercase tracking-widest")}
        />
        <SelectMenu
          value={channelId}
          options={channelOptions}
          onChange={setChannelId}
          prefix="Channel"
          ariaLabel="Channel for the new glasses"
          disabled={busy}
          menuClassName="max-h-[320px] overflow-y-auto"
        />
        <button
          type="button"
          disabled={!ready}
          onClick={() => void pair()}
          className={cn(PAGE_ACTION_BTN, "disabled:cursor-not-allowed disabled:opacity-40")}
        >
          {busy ? "Pairing…" : "Pair"}
        </button>
      </div>
      {error && <p className="text-caption text-danger">{error}</p>}
    </div>
  );
}
