"use client";

import { useState } from "react";
import {
  makeBlankObject,
  newClusterId,
  newObjectId,
  useGraph,
} from "../graph-state";
import { Bento } from "./ontology-bits";
import { ClusterRail } from "./cluster-rail";
import { ObjectEditor } from "./object-editor";

/**
 * Ontology page root — static in-memory editor. Study-notes two-panel
 * bento layout: cluster rail + object editor, floating on the gray
 * frame. All edits live in local state; nothing persists yet.
 */
export function OntologyView() {
  const [graph, dispatch] = useGraph();
  const [clusterId, setClusterId] = useState(graph.clusters[0].id);
  const [objectId, setObjectId] = useState(graph.clusters[0].objectIds[0]);

  const cluster =
    graph.clusters.find((c) => c.id === clusterId) ?? graph.clusters[0];
  const object = graph.objects[objectId] ?? graph.objects[cluster.objectIds[0]];

  const selectObject = (id: string) => {
    setObjectId(id);
    const home = graph.clusters.find((c) => c.objectIds.includes(id));
    if (home && home.id !== clusterId) setClusterId(home.id);
  };

  const createObject = (inClusterId: string) => {
    const id = newObjectId();
    dispatch({
      type: "OBJECT_CREATE",
      clusterId: inClusterId,
      object: makeBlankObject(id, "person"),
    });
    setClusterId(inClusterId);
    setObjectId(id);
  };

  const createCluster = () => {
    const id = newClusterId();
    dispatch({
      type: "CLUSTER_CREATE",
      cluster: { id, name: "New cluster", purpose: "", objectIds: [] },
    });
    setClusterId(id);
  };

  const deleteObject = (id: string) => {
    dispatch({ type: "OBJECT_DELETE", id });
    const remaining = cluster.objectIds.filter((oid) => oid !== id);
    setObjectId(remaining[0] ?? "");
  };

  return (
    <div className="flex h-full min-h-0 w-full gap-2 overflow-hidden bg-[#e6e8eb] p-2">
      <ClusterRail
        graph={graph}
        selectedClusterId={clusterId}
        selectedObjectId={objectId}
        onSelectCluster={setClusterId}
        onSelectObject={selectObject}
        onCreateObject={createObject}
        onCreateCluster={createCluster}
      />
      <Bento className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {object ? (
          <ObjectEditor
            object={object}
            graph={graph}
            dispatch={dispatch}
            onSelectObject={selectObject}
            onDeleteObject={deleteObject}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-[13px] text-[#98a2ad]">
            Select or create an object.
          </div>
        )}
      </Bento>
    </div>
  );
}
