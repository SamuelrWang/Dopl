"use client";

import { useState } from "react";

interface WorkspaceNameStepProps {
  submitting: boolean;
  /** Blank name is allowed — the server falls back to the auto-name. */
  onSubmit: (name: string, description: string) => void;
}

/**
 * Onboarding step 3 — name the auto-provisioned workspace and, optionally,
 * describe it. Light theme to match the survey/connect steps (auth-3D kit,
 * not the token surface). The name is encouraged but optional: leaving it
 * blank lets the server keep the "{FirstName}'s Workspace" fallback.
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
        Name Your Workspace
      </h2>
      <p className="mt-2.5 text-[14px] leading-relaxed text-[#9a9a9a]">
        Your knowledge bases, skills, and workflows all live here. You can
        rename it any time.
      </p>

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
              placeholder="My workspace"
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
              placeholder="What lives in this workspace?"
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
