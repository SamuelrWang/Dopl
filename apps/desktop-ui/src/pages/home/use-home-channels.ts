import { useMemo } from "react";
import { useAccountChannels } from "@/features/channels/hooks/use-channels";
import type { Channel } from "@/features/channels/types";
import { homeChannels } from "./home-rows";

/**
 * THE OPERATOR'S HOME CHANNELS, for the two surfaces that want the channels
 * without the rows — the Ontology share popup and the Overview usage filter.
 *
 * ⚠ **THE SAME CACHE ENTRY THE LEFT PANE ALREADY MOUNTED**
 * (`GET /api/channels?scope=account`), so neither surface costs a request, and
 * the SAME G3 filter (`home-rows.ts › homeChannels`) — the account scope answers
 * every container kind, and a second `container.kind` test here would be a second
 * answer to the question R-26 made singular.
 *
 * ⚠ **MEMOISED ON THE PAYLOAD, AND THAT IS NOT A MICRO-OPTIMISATION.**
 * `homeChannels` allocates, so an un-memoised call hands a new array to a caller
 * whose own `useMemo` lists it as a dependency — the share popup's seeded draft —
 * and that memo would then recompute on every render.
 */
export function useHomeChannels(): readonly Channel[] {
  const query = useAccountChannels();
  const payload = query.data;
  return useMemo(() => (payload ? homeChannels(payload) : EMPTY), [payload]);
}

/** ⚠ FROZEN and shared, so "the read has not landed" is one stable reference. */
const EMPTY: readonly Channel[] = Object.freeze([]);
