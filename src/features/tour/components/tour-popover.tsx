"use client";

import { createPortal } from "react-dom";
import { cn } from "@/shared/lib/utils";
import { CopyButton } from "@/shared/ui/copy-button";
import { TOUR_FINISH, TOUR_STEPS } from "../tour-steps";
// From the CORE, not the `next/navigation` binding: the popover is rendered by
// the core provider, so importing the binding would pull Next back in.
import { useTour } from "./tour-provider-core";
import styles from "./tour.module.css";

/**
 * The fixed top-right tour card. Popover-only (no on-page spotlight in v1):
 * a `.bento` surface above page content but below modals. Returns null while
 * the tour is inactive, so it adds no DOM for users who never start it.
 * Portals to <body> so it escapes the shell's stacking context.
 */
export function TourPopover() {
  const { stepIndex, next, back, close } = useTour();

  if (stepIndex === null) return null;

  const isFinish = stepIndex >= TOUR_STEPS.length;

  return createPortal(
    <div className={cn("bento", styles.popover)} role="dialog" aria-label="Product tour">
      {isFinish ? (
        <>
          <h3 className="text-title font-semibold text-text-primary">
            {TOUR_FINISH.title}
          </h3>
          <p className="text-small leading-relaxed text-text-secondary">
            {TOUR_FINISH.body}
          </p>
          <div className={cn("concave-field", styles.promptWell)}>
            <span className={cn("text-caption leading-relaxed text-text-primary", styles.promptText)}>
              {TOUR_FINISH.prompt}
            </span>
            <CopyButton text={TOUR_FINISH.prompt} label="Copy prompt" size={14} className="mt-0.5" />
          </div>
          <div className={styles.footer}>
            <span className={styles.footerSpacer} />
            <button
              type="button"
              onClick={close}
              className="auth-btn-3d cursor-pointer rounded-lg px-3 py-1.5 text-small font-semibold text-white"
            >
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="text-label uppercase tracking-wide font-semibold text-text-secondary">
            Step {stepIndex + 1} of {TOUR_STEPS.length}
          </span>
          <h3 className="text-title font-semibold text-text-primary">
            {TOUR_STEPS[stepIndex].title}
          </h3>
          <p className="text-small leading-relaxed text-text-secondary">
            {TOUR_STEPS[stepIndex].body}
          </p>
          <div className={styles.footer}>
            <button
              type="button"
              onClick={close}
              className="cursor-pointer text-caption font-medium text-text-muted transition-colors hover:text-text-secondary"
            >
              Skip tour
            </button>
            <span className={styles.footerSpacer} />
            {stepIndex > 0 && (
              <button
                type="button"
                onClick={back}
                className="btn-light cursor-pointer rounded-md px-3 py-1.5 text-small font-medium text-text-primary"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={next}
              className="auth-btn-3d cursor-pointer rounded-lg px-3 py-1.5 text-small font-semibold text-white"
            >
              {stepIndex === TOUR_STEPS.length - 1 ? "Finish" : "Next"}
            </button>
          </div>
        </>
      )}
    </div>,
    document.body
  );
}
