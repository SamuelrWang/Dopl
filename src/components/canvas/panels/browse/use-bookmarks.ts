"use client";

import { useState, useCallback, useEffect, useRef } from "react";

const STORAGE_KEY = "dopl:bookmarks";
const DB_DEBOUNCE_MS = 1000;

function loadBookmarks(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveBookmarksLocal(ids: Set<string>) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
}

export function useBookmarks() {
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(loadBookmarks);
  const dbTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);

  // Load from DB on mount, merge with localStorage
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    fetch("/api/user/preferences/bookmarks")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.value && Array.isArray(data.value)) {
          setBookmarkedIds((prev) => {
            const merged = new Set([...prev, ...data.value]);
            saveBookmarksLocal(merged);
            return merged;
          });
        }
      })
      .catch(() => {});
  }, []);

  const isBookmarked = useCallback(
    (id: string) => bookmarkedIds.has(id),
    [bookmarkedIds]
  );

  const toggleBookmark = useCallback((id: string) => {
    setBookmarkedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);

      // Write to localStorage immediately
      saveBookmarksLocal(next);

      // Debounced write to DB
      if (dbTimerRef.current) clearTimeout(dbTimerRef.current);
      const value = [...next];
      dbTimerRef.current = setTimeout(() => {
        fetch("/api/user/preferences/bookmarks", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value }),
        }).catch(() => {});
      }, DB_DEBOUNCE_MS);

      return next;
    });
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      if (dbTimerRef.current) clearTimeout(dbTimerRef.current);
    };
  }, []);

  return { isBookmarked, toggleBookmark, bookmarkedIds };
}
