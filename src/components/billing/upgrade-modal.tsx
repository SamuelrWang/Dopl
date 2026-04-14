"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason?: "ingestion_limit" | "content_locked" | "build_locked" | "generic";
}

const REASON_TEXT: Record<string, { title: string; description: string }> = {
  ingestion_limit: {
    title: "You've used all your free ingestions",
    description:
      "Upgrade to Pro to ingest unlimited setups and build your knowledge base without limits.",
  },
  content_locked: {
    title: "Full details are a Pro feature",
    description:
      "Upgrade to Pro to access full READMEs, setup instructions, and implementation details.",
  },
  build_locked: {
    title: "Build Solution is a Pro feature",
    description:
      "Upgrade to Pro to compose custom solutions from the knowledge base with AI synthesis.",
  },
  generic: {
    title: "Upgrade to Pro",
    description: "Get unlimited access to the full Setup Intelligence Engine.",
  },
};

const PRO_FEATURES = [
  "Full READMEs & setup instructions",
  "Unlimited ingestions",
  "AI-powered Build Solution",
  "MCP server access",
  "Unlimited clusters",
];

export function UpgradeModal({ open, onOpenChange, reason = "generic" }: UpgradeModalProps) {
  const [loading, setLoading] = useState(false);
  const text = REASON_TEXT[reason] || REASON_TEXT.generic;

  async function handleUpgrade() {
    setLoading(true);
    try {
      const res = await fetch("/api/billing/checkout", { method: "POST" });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{text.title}</DialogTitle>
          <DialogDescription>{text.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <p className="text-xs font-medium text-text-secondary uppercase tracking-wider">
            What you get with Pro
          </p>
          <ul className="space-y-2">
            {PRO_FEATURES.map((feature) => (
              <li
                key={feature}
                className="flex items-center gap-2 text-sm text-text-primary"
              >
                <span className="text-emerald-400 text-xs">&#10003;</span>
                {feature}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-white/[0.06]">
          <div>
            <span className="text-lg font-semibold text-text-primary">$20</span>
            <span className="text-sm text-text-tertiary">/month</span>
          </div>
          <Button onClick={handleUpgrade} disabled={loading}>
            {loading ? "Redirecting..." : "Upgrade to Pro"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
