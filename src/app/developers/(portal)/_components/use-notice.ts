"use client";

import { useState } from "react";

const SHOWN_MS = 3200;

/** A page's one passing message, for its Toast. */
export function useNotice() {
  const [notice, setNotice] = useState<string | null>(null);
  const say = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((now) => (now === text ? null : now)), SHOWN_MS);
  };
  return { notice, say };
}
