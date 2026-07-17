"use client";

import { useEffect } from "react";
import { PricingContent } from "./pricing-content";

/**
 * Site-nav pricing popup — the full pricing body (plan cards + embedded
 * checkout) in a light overlay instead of a page navigation. Backdrop
 * click and Escape close it; body scroll is locked while open. The nav
 * link keeps `/pricing` as its href so middle-click / no-JS still lands
 * on the standalone page.
 */
export function PricingModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div className="lp-modal-overlay" onClick={onClose} role="presentation">
      <div
        className="lp-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Pricing"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="lp-btn--3d-light lp-modal-close"
          onClick={onClose}
          aria-label="Close pricing"
        >
          <CloseIcon />
        </button>
        <PricingContent />
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M4 4L12 12M12 4L4 12" />
    </svg>
  );
}
