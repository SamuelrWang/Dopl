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
// Deep import, never the `app-shell` barrel: the barrel re-exports `AppShell`,
// which binds `next/link` + `next/navigation` and would drag Next into the
// desktop renderer's import graph (same rule as
// `create-workspace-dialog-core`).
import type { NavSection } from "@/shared/layout/app-shell/app-sidebar-core";
import { sectionPath } from "@/shared/layout/app-shell/app-sidebar-core";
import { TOUR_START_EVENT, tourStepKey } from "../constants";
import { TOUR_FINISH, TOUR_STEPS } from "../tour-steps";
import { TourPopover } from "./tour-popover";

/** Finish card sits one past the last step. */
const FINISH_INDEX = TOUR_STEPS.length;

type TourContextValue = {
  /** Current screen: 0..TOUR_STEPS.length-1 = steps, TOUR_STEPS.length = finish, null = inactive. */
  stepIndex: number | null;
  /** Begin the tour at step 1 (also triggered by the TOUR_START_EVENT window event). */
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
  /**
   * Navigate to an in-app path. The core owns WHICH path each step lands on
   * (`sectionPath`); the caller owns HOW to get there — `next/navigation` on
   * the web, the SPA router in the desktop renderer.
   */
  onNavigate: (path: string) => void;
  children: React.ReactNode;
}

/**
 * Owns the tour state for a workspace shell. Mounted once by the shell so it
 * survives route changes; renders nothing until the tour starts (the popover
 * returns null while `stepIndex` is null), so it has zero impact on users who
 * never start it. Progress persists to localStorage so a mid-tour reload
 * resumes, and clears on finish/skip.
 *
 * Router-free by construction (the wave-1 core/binding pattern): navigation
 * arrives as `onNavigate`, so the desktop SPA mounts this same provider with
 * its own router. `./tour-provider` is the `next/navigation` binding.
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
        // storage unavailable — tour still works for this session
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

  // Resume a mid-tour reload from storage (scoped to this workspace).
  // Restores the popover at the saved screen without navigating (the user is
  // already on that page after the reload); advancing navigates as usual.
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
    // Mount-only on purpose: a workspace SWITCH abandons the tour (effect
    // below) instead of resuming another workspace's saved step mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A tour walks ONE workspace. Switching workspaces mid-tour abandons it —
  // both the open popover and the old workspace's saved step.
  const tourSegment = useRef(workspaceSegment);
  useEffect(() => {
    if (tourSegment.current === workspaceSegment) return;
    try {
      window.localStorage.removeItem(tourStepKey(tourSegment.current));
    } catch {
      // storage unavailable — in-memory state still resets below
    }
    tourSegment.current = workspaceSegment;
    setStepIndex(null);
  }, [workspaceSegment]);

  // Decoupled entry point: the onboarding welcome popup dispatches this event
  // instead of importing the tour (avoids a sideways feature import).
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
