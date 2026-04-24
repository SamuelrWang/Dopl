"use client";

import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { useEarlySupporterModal } from "./use-early-supporter-modal";

export function EarlySupporterModal() {
  const { open, markSeen } = useEarlySupporterModal();

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) markSeen(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>You&apos;re one of our first 100 supporters 🎉</DialogTitle>
          <DialogDescription>
            As a thank-you, we&apos;ve added{" "}
            <span className="text-emerald-400 font-medium">500 credits</span>{" "}
            to your account — the same monthly amount Pro members get. They&apos;re yours
            to keep, no expiration. When you run low, you can upgrade to Pro to keep
            the credits flowing.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm text-text-primary">
          <div className="flex items-baseline justify-between">
            <span className="text-text-tertiary text-xs uppercase tracking-wider">
              Your bonus
            </span>
            <span className="text-emerald-400 font-semibold">+500 credits</span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Link href="/pricing" onClick={markSeen}>
            <Button variant="ghost">See pricing</Button>
          </Link>
          <Button onClick={markSeen}>Got it</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
