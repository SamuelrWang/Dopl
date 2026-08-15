"use client";

import { useEffect, useState } from "react";
import { evaluatePassword } from "../password-policy";

// zxcvbn score 0–4 → meter presentation.
const STRENGTH_META = [
  { label: "Very weak", color: "#e5534b", bars: 1 },
  { label: "Weak", color: "#e5534b", bars: 1 },
  { label: "Fair", color: "#d99b2b", bars: 2 },
  { label: "Good", color: "#3e8e5a", bars: 3 },
  { label: "Strong", color: "#2f7d4f", bars: 4 },
] as const;

// zxcvbn heavy (dictionaries) — load once, lazily, off initial bundle.
// Until resolved, fall back to policy check-count so meter still moves.
type Scorer = (pw: string) => number;
let scorer: Scorer | null = null;
let loading: Promise<void> | null = null;

function ensureScorer(): Promise<void> {
  if (scorer) return Promise.resolve();
  if (!loading) {
    loading = (async () => {
      const [core, common, en] = await Promise.all([
        import("@zxcvbn-ts/core"),
        import("@zxcvbn-ts/language-common"),
        import("@zxcvbn-ts/language-en"),
      ]);
      const factory = new core.ZxcvbnFactory({
        dictionary: { ...common.dictionary, ...en.dictionary },
        graphs: common.adjacencyGraphs,
        translations: en.translations,
      });
      scorer = (pw) => factory.check(pw).score;
    })();
  }
  return loading;
}

/** Strength meter (zxcvbn entropy estimate) + optional requirements checklist
 *  for set-password surfaces. Renders nothing for an empty password. */
export function PasswordRequirements({
  password,
  showChecklist = true,
}: {
  password: string;
  showChecklist?: boolean;
}) {
  const [score, setScore] = useState<number | null>(null);

  useEffect(() => {
    if (!password) return;
    let active = true;
    void ensureScorer().then(() => {
      if (active && scorer) setScore(scorer(password));
    });
    return () => {
      active = false;
    };
  }, [password]);

  if (!password) return null;

  const { checks } = evaluatePassword(password);
  // Fallback before zxcvbn loads: rough score from met-requirement count.
  const fallback = Math.min(4, Math.max(0, checks.filter((c) => c.met).length - 1));
  const meta = STRENGTH_META[score ?? fallback];

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
