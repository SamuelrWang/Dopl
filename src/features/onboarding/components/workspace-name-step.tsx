"use client";

import { useState } from "react";

interface WorkspaceNameStepProps {
  submitting: boolean;
  /** Blank name is allowed — the server falls back to the auto-name. */
  onSubmit: (name: string, description: string) => void;
}

/**
 * Onboarding step 3 — name the caller's HOME SPACE (+ optional description).
 * Auth-3D kit, not the token surface, matching steps 1-2. Blank name keeps the
 * server's "Home" fallback (`onboarding/server/service.ts ›
 * HOME_SPACE_DEFAULT_NAME`).
 *
 * ⚠ **IT SAID "WORKSPACE" EVERYWHERE UNTIL 2026-09-10 AND NAMED NO WORKSPACE.**
 * What this step renames is the caller's `kind='home'` container — a SHELF,
 * not a workspace (`20260920120000`'s header) — and the word set the new user's
 * expectation wrong on the first screen they ever see: they finish, land on
 * /home, and the thing they named is not called what they were told.
 *
 * ⚠ **THE EXPLAINER PARAGRAPH IS DELETED, NOT REWRITTEN** (INVARIANTS §5's
 * minimal-copy ruling: label + control, no explainer paragraphs in product UI).
 * It was also false after the seed ruling — *"your knowledge bases and skills all
 * live here"* described a starter corpus a fresh home space no longer has.
 *
 * ⚠ The component, the file and the `step === "workspace"` key keep their names:
 * the ruling is about COPY. Renaming the step key is a change to
 * `onboarding-flow-core.tsx`'s state machine for no user-visible gain.
 */
export function WorkspaceNameStep({ submitting, onSubmit }: WorkspaceNameStepProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  function handleSubmit() {
    if (submitting) return;
    onSubmit(name.trim(), description.trim());
  }

  return (
    <div>
      <h2 className="text-[26px] font-bold leading-tight tracking-[-0.5px] text-[#181818]">
        Name your home space
      </h2>

      <div className="mt-7 space-y-5">
        {/* Name */}
        <div>
          <label
            htmlFor="workspace-name"
            className="mb-2 block text-[14px] font-medium text-[#181818]"
          >
            Name
          </label>
          <div className="auth-field-3d flex h-[46px] items-center rounded-[10px] px-[16px]">
            <input
              id="workspace-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
              }}
              maxLength={120}
              placeholder="Home"
              autoFocus
              className="w-full bg-transparent text-[14px] text-[#181818] placeholder:text-[#b3b3b3] focus:outline-none"
            />
          </div>
        </div>

        {/* Description (optional) */}
        <div>
          <label
            htmlFor="workspace-description"
            className="mb-2 block text-[14px] font-medium text-[#181818]"
          >
            Description{" "}
            <span className="font-normal text-[#9a9a9a]">(optional)</span>
          </label>
          <div className="auth-field-3d rounded-[10px] px-[16px] py-3">
            <textarea
              id="workspace-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="What lives here?"
              className="w-full resize-none bg-transparent text-[14px] leading-relaxed text-[#181818] placeholder:text-[#b3b3b3] focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Finish (no go-back, matching the survey/connect steps) */}
      <div className="mt-8 flex justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="auth-btn-3d cursor-pointer rounded-[10px] px-8 py-2.5 text-[14px] font-semibold text-white"
        >
          {submitting ? "Setting up…" : "Finish"}
        </button>
      </div>
    </div>
  );
}
