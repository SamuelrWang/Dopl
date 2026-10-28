"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** One word in a sentence that cycles through `words`: the outgoing word rolls
 *  up like a prism face and fades out while the next rolls up from below. The slot
 *  eases to each word's own width so the rest of the line follows it.
 *  Reduced motion: the word swaps in place, no flip. SSR: the first word. */
export function RotatingWord({ words, intervalMs = 2200 }: { words: readonly string[]; intervalMs?: number }) {
  const [index, setIndex] = useState(0);
  const [prev, setPrev] = useState<number | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const indexRef = useRef(0);

  useEffect(() => {
    if (words.length < 2) return;
    const id = window.setInterval(() => {
      const current = indexRef.current;
      const next = (current + 1) % words.length;
      indexRef.current = next;
      setPrev(current);
      setIndex(next);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [words.length, intervalMs]);

  // Width of the incoming word, measured from a hidden copy in the same font
  // and written straight to the slot (CSS eases it).
  useLayoutEffect(() => {
    const el = measureRef.current?.children[index] as HTMLElement | undefined;
    if (el && rootRef.current) rootRef.current.style.width = `${el.getBoundingClientRect().width}px`;
  }, [index]);

  return (
    <span className="lp-rot" ref={rootRef}>
      <span className="lp-rot-measure" ref={measureRef} aria-hidden="true">
        {words.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </span>
      {prev !== null && prev !== index ? (
        <span key={`out-${prev}-${index}`} className="lp-rot-word" data-phase="out" aria-hidden="true">
          {words[prev]}
        </span>
      ) : null}
      <span key={`in-${index}`} className="lp-rot-word" data-phase={prev === null ? undefined : "in"}>
        {words[index]}
      </span>
    </span>
  );
}
