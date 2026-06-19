"use client";

import { evaluatePassword, type PasswordStrength } from "../password-policy";

const STRENGTH_META: Record<PasswordStrength, { label: string; color: string; bars: number }> = {
  weak: { label: "Weak", color: "#e5534b", bars: 1 },
  fair: { label: "Fair", color: "#d99b2b", bars: 2 },
  good: { label: "Good", color: "#3e8e5a", bars: 3 },
  strong: { label: "Strong", color: "#2f7d4f", bars: 4 },
};

/** Strength meter + (optional) live requirements checklist for set-password
 *  surfaces. Light Arcana styling. Renders nothing for an empty password. */
export function PasswordRequirements({
  password,
  showChecklist = true,
}: {
  password: string;
  showChecklist?: boolean;
}) {
  if (!password) return null;
  const { checks, strength } = evaluatePassword(password);
  const meta = STRENGTH_META[strength];

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="h-1.5 flex-1 rounded-full transition-colors"
              style={{ background: i < meta.bars ? meta.color : "#e2e2e2" }}
            />
          ))}
        </div>
        <span className="text-[12px] font-medium" style={{ color: meta.color }}>
          {meta.label}
        </span>
      </div>

      {showChecklist && (
        <ul className="mt-3 space-y-1.5">
          {checks.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-[13px]">
              <CheckDot met={c.met} />
              <span className={c.met ? "text-[#3e8e5a]" : "text-[#9a9a9a]"}>{c.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CheckDot({ met }: { met: boolean }) {
  return (
    <svg className="h-[15px] w-[15px] flex-none" viewBox="0 0 24 24" fill="none" stroke={met ? "#3e8e5a" : "#c4c4c4"} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      {met ? <path d="M20 6 9 17l-5-5" /> : <circle cx="12" cy="12" r="8" />}
    </svg>
  );
}
