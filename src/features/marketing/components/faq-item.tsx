"use client";

import { useState } from "react";
import { Plus, Minus } from "lucide-react";

export function FaqItem({
  question,
  answer,
}: {
  question: string;
  answer: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-white/[0.08]">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-6 text-left"
      >
        <span className="text-white text-[16px] font-medium">{question}</span>
        {open ? (
          <Minus size={18} className="text-white/40 shrink-0 ml-4" />
        ) : (
          <Plus size={18} className="text-white/40 shrink-0 ml-4" />
        )}
      </button>
      {open && (
        <div className="pb-6 text-white/50 text-[15px] leading-relaxed">
          {answer}
        </div>
      )}
    </div>
  );
}
