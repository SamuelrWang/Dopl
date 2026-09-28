"use client";

import { useState } from "react";
import { userFacingMessage } from "@/shared/api/user-facing-message";
import { toast } from "@/shared/ui/toast";
import { cn } from "@/shared/lib/utils";
import { InlineUnderlineField } from "@/shared/ui/form-dialog";
import { SMALL_PRIMARY_PILL } from "@/shared/ui/small-action-button";
import {
  PAIRING_CODE_LENGTH,
  claimPairing,
  pairingCodeInput,
} from "./glasses-api";
import { useInvalidateGlassesDevices } from "./use-glasses";

/**
 * Pair a pair of glasses by the code on its lens (Settings > Connect > Devices). Code only: the
 * device picks its channel on the glasses (Samuel, 2026-09-28 — no channel picker here).
 */
export function PairGlasses() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalidate = useInvalidateGlassesDevices();
  const ready = code.length === PAIRING_CODE_LENGTH && !busy;

  async function pair() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await claimPairing({ code });
      setCode("");
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
      {/* One line (Samuel, 2026-09-28): "Pairing Code: ____________ (Pair)". */}
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-body font-medium text-text-primary">Pairing Code:</span>
        <InlineUnderlineField
          label="Pairing code"
          placeholder=""
          value={code}
          onChange={(next) => {
            setCode(pairingCodeInput(next));
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            e.preventDefault();
            void pair();
          }}
          className="flex-1"
          inputClassName="font-mono uppercase tracking-widest"
        />
        <button
          type="button"
          disabled={!ready}
          onClick={() => void pair()}
          className={cn(SMALL_PRIMARY_PILL, "shrink-0 disabled:cursor-not-allowed disabled:opacity-40")}
        >
          {busy ? "Pairing…" : "Pair"}
        </button>
      </div>
      {error && <p className="text-caption text-danger">{error}</p>}
    </div>
  );
}
