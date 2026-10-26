"use client";

/**
 * THE STAGING ONTOLOGY STORE — the one in-memory stand-in for everything the
 * desktop reads over the wire: `GET /api/ontology` (the graph), the share rows,
 * the changelog, and the create/patch/delete writes. Every staged hook reads it.
 *
 * Nothing persists: a reload resets to `data/demo-ontology-data.ts`.
 *
 * `scenario` is a staging-only switch (the floating panel in
 * `staging-scenario-panel.tsx`) that forces the states a real session reaches
 * only by accident — loading, errors, empty, not onboarded, object cap.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  graphReducer,
  type GraphAction,
  type GraphState,
} from "@/features/ontology/graph-state";
import type { OntologyCreateApi } from "@/features/ontology/optimistic-create";
import type {
  Ontology,
  OntologyObject,
  OntologyShare,
} from "@/features/ontology/types";
import type { Revision } from "@/features/revisions/types";
import { DEMO_SHARES, demoSnapshot } from "../data/demo-ontology-data";
import { demoRevisions, type StagedRevision } from "../data/demo-revisions";
import { diffGraphs } from "./revision-diff-recorder";

export type StagingScenario =
  | "board"
  | "pane-loading"
  | "list-error"
  | "board-loading"
  | "board-error"
  | "empty"
  | "not-onboarded"
  | "cap-near"
  | "cap-over"
  | "pinned-gone";

type StoreAction =
  | GraphAction
  | { type: "STAGING_SET_AGENTS"; id: string; agentsMayEdit: boolean }
  | { type: "STAGING_SET_SHARE_COUNT"; id: string; count: number };

function storeReducer(state: GraphState, action: StoreAction): GraphState {
  if (action.type === "STAGING_SET_AGENTS") {
    return {
      ...state,
      ontologies: state.ontologies.map((o) =>
        o.id === action.id ? { ...o, agentsMayEdit: action.agentsMayEdit } : o
      ),
    };
  }
  if (action.type === "STAGING_SET_SHARE_COUNT") {
    return {
      ...state,
      ontologies: state.ontologies.map((o) =>
        o.id === action.id ? { ...o, sharedChannelCount: action.count } : o
      ),
    };
  }
  return graphReducer(state, action);
}

export interface StagingOntologyStore {
  scenario: StagingScenario;
  setScenario: (s: StagingScenario) => void;
  graph: GraphState;
  /** Raw reducer dispatch — the in-memory "server" accepts every write. */
  dispatch: (action: GraphAction) => void;
  /** Fake transport for `optimistic-create.ts` (settles after a short delay). */
  api: OntologyCreateApi;
  /** `POST /api/ontology/ontologies` — an empty ontology, server-minted id. */
  createOntologyRow: (name: string) => Ontology;
  deleteOntologyRow: (id: string) => void;
  setAgentsMayEdit: (id: string, agentsMayEdit: boolean) => void;
  shares: Readonly<Record<string, OntologyShare[]>>;
  saveShare: (ontologyId: string, share: OntologyShare) => Promise<void>;
  revisions: readonly StagedRevision[];
  restore: (objectId: string, revision: Revision) => Promise<void>;
}

const Ctx = createContext<StagingOntologyStore | null>(null);

export function useStagingOntologyStore(): StagingOntologyStore {
  const store = useContext(Ctx);
  if (!store) throw new Error("StagingOntologyProvider is missing");
  return store;
}

const LATENCY_MS = 350;
const RECORD_DELAY_MS = 800;
const wait = (ms = LATENCY_MS) => new Promise((r) => setTimeout(r, ms));
let mint = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(mint += 1)}`;

export function StagingOntologyProvider({ children }: { children: ReactNode }) {
  const [scenario, setScenario] = useState<StagingScenario>("board");
  const [graph, rawDispatch] = useReducer(storeReducer, undefined, () =>
    storeReducer({ ontologies: [], objects: {} }, { type: "SNAPSHOT_SET", snapshot: demoSnapshot() })
  );
  const [shares, setShares] = useState<Record<string, OntologyShare[]>>(() => ({
    ...DEMO_SHARES,
  }));
  const [revisions, setRevisions] = useState<StagedRevision[]>(() => demoRevisions());

  // ── live changelog: diff the graph after each pause, like the debounced PATCH ──
  const committed = useRef(graph);
  const restoreMarks = useRef(new Set<string>());
  useEffect(() => {
    const t = setTimeout(() => {
      const rows = diffGraphs(committed.current, graph, restoreMarks.current);
      committed.current = graph;
      restoreMarks.current.clear();
      if (rows.length > 0) setRevisions((prev) => [...prev, ...rows]);
    }, RECORD_DELAY_MS);
    return () => clearTimeout(t);
  }, [graph]);

  const dispatch = useCallback((action: GraphAction) => rawDispatch(action), []);

  const graphRef = useRef(graph);
  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);

  const api = useMemo<OntologyCreateApi>(
    () => ({
      async createOntology({ name }) {
        await wait();
        const id = newId("ont");
        return { id, slug: id, name, purpose: "", columnIds: [], layout: {} };
      },
      async createObject({ name }) {
        await wait();
        return {
          id: newId("obj"),
          name,
          subtitle: "",
          attributes: [],
          relationships: [],
          methods: [],
          childIds: [],
          template: [],
        } satisfies OntologyObject;
      },
      async updateObject(objectId) {
        await wait(120);
        return graphRef.current.objects[objectId] as OntologyObject;
      },
      async deleteOntology() {
        await wait(120);
      },
    }),
    []
  );
  const createOntologyRow = useCallback((name: string): Ontology => {
    const id = newId("ont");
    const row: Ontology = {
      id,
      slug: id,
      name,
      purpose: "",
      columnIds: [],
      layout: {},
      agentsMayEdit: true,
      sharedChannelCount: 0,
    };
    rawDispatch({ type: "ONTOLOGY_ADD", ontology: row });
    return row;
  }, []);

  const deleteOntologyRow = useCallback((id: string) => {
    rawDispatch({ type: "ONTOLOGY_DELETE", id });
    setShares((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const setAgentsMayEdit = useCallback((id: string, agentsMayEdit: boolean) => {
    rawDispatch({ type: "STAGING_SET_AGENTS", id, agentsMayEdit });
  }, []);

  const saveShare = useCallback(async (ontologyId: string, share: OntologyShare) => {
    await wait();
    const unshared =
      share.membersLevel === "none" &&
      share.guestsLevel === "none" &&
      share.ownerAgentsLevel === "none";
    setShares((prev) => {
      const rest = (prev[ontologyId] ?? []).filter((s) => s.channelId !== share.channelId);
      const list = unshared ? rest : [...rest, share];
      rawDispatch({ type: "STAGING_SET_SHARE_COUNT", id: ontologyId, count: list.length });
      return { ...prev, [ontologyId]: list };
    });
  }, []);

  const restore = useCallback(async (objectId: string, revision: Revision) => {
    await wait();
    const { field, before } = revision.payload;
    const object = graphRef.current.objects[objectId];
    if (!object || field === undefined) return;
    restoreMarks.current.add(`${objectId}|${field}`);
    if (field.startsWith("attribute:")) {
      const key = field.slice("attribute:".length);
      const index = object.attributes.findIndex((a) => a.key === key);
      if (index < 0) return;
      const attribute = object.attributes[index];
      rawDispatch({
        type: "ATTRIBUTE_UPSERT",
        id: objectId,
        index,
        attribute: { ...attribute, value: before as typeof attribute.value },
      });
      return;
    }
    rawDispatch({
      type: "OBJECT_UPDATE",
      id: objectId,
      patch: { [field]: before } as Partial<OntologyObject>,
    });
  }, []);

  // No manual memo: the React Compiler memoizes this object.
  const value: StagingOntologyStore = {
    scenario,
    setScenario,
    graph,
    dispatch,
    api,
    createOntologyRow,
    deleteOntologyRow,
    setAgentsMayEdit,
    shares,
    saveShare,
    revisions,
    restore,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
