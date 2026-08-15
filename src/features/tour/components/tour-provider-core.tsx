"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
// ⚠ Deep import, never the `app-shell` barrel — the barrel re-exports
// `AppShell`, which binds `next/link` + `next/navigation` and drags Next into
// the desktop renderer's graph (same rule as `create-workspace-dialog-core`).
import type { NavSection } from "@/shared/layout/app-shell/app-sidebar-core";
import { sectionPath } from "@/shared/layout/app-shell/app-sidebar-core";
import { TOUR_START_EVENT, tourStepKey } from "../constants";
import { TOUR_FINISH, TOUR_STEPS } from "../tour-steps";
import { TourPopover } from "./tour-popover";

/** Finish card sits one past the last step. */
const FINISH_INDEX = TOUR_STEPS.length;

type TourContextValue = {
  /** 0..TOUR_STEPS.length-1 = steps, TOUR_STEPS.length = finish, null = inactive. */
  stepIndex: number | null;
  /** Start at step 1 — also fired by the TOUR_START_EVENT window event. */
  startTour: () => void;
  next: () => void;
  back: () => void;
  close: () => void;
};

const TourContext = createContext<TourContextValue | null>(null);

export function useTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useTour must be used within a TourProvider");
  return ctx;
}

function sectionForIndex(index: number): NavSection {
  return index >= FINISH_INDEX ? TOUR_FINISH.section : TOUR_STEPS[index].section;
}

export interface TourProviderCoreProps {
  workspaceSegment: string;
  /** Core owns WHICH path each step lands on (`sectionPath`); caller owns HOW
   *  — `next/navigation` on web, SPA router in the desktop renderer. */
  onNavigate: (path: string) => void;
  children: React.ReactNode;
}

/**
 * Tour state for a workspace shell. Mounted once by the shell so it survives
 * route changes; renders nothing until started (popover returns null while
 * `stepIndex` is null). Progress persists to localStorage, clears on
 * finish/skip.
 *
 * ⚠ Router-free by construction — navigation arrives as `onNavigate` so the
 * desktop SPA mounts this same provider. `./tour-provider` = Next binding.
 */
export function TourProviderCore({
  workspaceSegment,
  onNavigate,
  children,
}: TourProviderCoreProps) {
  const [stepIndex, setStepIndex] = useState<number | null>(null);

  const persist = useCallback(
    (index: number | null) => {
      try {
        const key = tourStepKey(workspaceSegment);
        if (index === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, String(index));
      } catch {
        // storage unavailable — tour still works this session
      }
    },
    [workspaceSegment]
  );

  const goTo = useCallback(
    (index: number) => {
      setStepIndex(index);
      persist(index);
      onNavigate(sectionPath(workspaceSegment, sectionForIndex(index)));
    },
    [persist, onNavigate, workspaceSegment]
  );

  const startTour = useCallback(() => goTo(0), [goTo]);

  const next = useCallback(() => {
    if (stepIndex !== null && stepIndex < FINISH_INDEX) goTo(stepIndex + 1);
  }, [goTo, stepIndex]);

  const back = useCallback(() => {
    if (stepIndex !== null && stepIndex > 0) goTo(stepIndex - 1);
  }, [goTo, stepIndex]);

  const close = useCallback(() => {
    setStepIndex(null);
    persist(null);
  }, [persist]);

  // Resume a mid-tour reload (scoped to this workspace). Restores the popover
  // WITHOUT navigating — the reload already landed on that page.
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(tourStepKey(workspaceSegment));
    } catch {
      return;
    }
    if (raw === null || raw === "") return;
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= FINISH_INDEX) {
      setStepIndex(parsed);
    }
    // ⚠ Mount-only: a workspace SWITCH abandons the tour (effect below) rather
    // than resuming another workspace's saved step mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tour walks ONE workspace: switching abandons both the open popover and the
  // old workspace's saved step.
  const tourSegment = useRef(workspaceSegment);
  useEffect(() => {
    if (tourSegment.current === workspaceSegment) return;
    try {
      window.localStorage.removeItem(tourStepKey(tourSegment.current));
    } catch {
      // storage unavailable — in-memory state resets below anyway
    }
    tourSegment.current = workspaceSegment;
    setStepIndex(null);
  }, [workspaceSegment]);

  // Decoupled entry point — welcome popup dispatches the event instead of
  // importing the tour (no sideways feature import).
  useEffect(() => {
    function onStart() {
      startTour();
    }
    window.addEventListener(TOUR_START_EVENT, onStart);
    return () => window.removeEventListener(TOUR_START_EVENT, onStart);
  }, [startTour]);

  const value = useMemo<TourContextValue>(
    () => ({ stepIndex, startTour, next, back, close }),
    [stepIndex, startTour, next, back, close]
  );

  return (
    <TourContext.Provider value={value}>
      {children}
      <TourPopover />
    </TourContext.Provider>
  );
}
