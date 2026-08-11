/**
 * Knowledge-base method group (Item 4) — link 3 of the chain documented in
 * `client-base.ts`. Pure delegation to `knowledge.ts`; no HTTP here.
 *
 * User-authored, editable knowledge bases. Path-based methods accept a base
 * id and a "/"-separated path; the server resolves to folder/entry rows.
 */

import { WorkspaceMethods } from "./client-workspaces.js";
import * as kb from "./knowledge.js";
import type {
  KnowledgeBase,
  KnowledgeBaseCreateInput,
  KnowledgeBaseUpdateInput,
  KnowledgeDirListing,
  KnowledgeEntry,
  KnowledgeFolder,
  KnowledgePathOpResult,
  KnowledgeSearchHit,
  KnowledgeTreeSnapshot,
  KnowledgeWriteFileInput,
  KnowledgeWriteFileResult,
} from "./knowledge-types.js";

export class KnowledgeMethods extends WorkspaceMethods {
  listKbBases(): Promise<KnowledgeBase[]> {
    return kb.listKbBases(this.transport);
  }

  getKbBase(baseId: string): Promise<KnowledgeBase> {
    return kb.getKbBase(this.transport, baseId);
  }

  getKbTree(
    baseId: string,
    opts?: { entryLimit?: number; entryCursor?: string }
  ): Promise<KnowledgeTreeSnapshot> {
    return kb.getKbTree(this.transport, baseId, opts);
  }

  createKbBase(input: KnowledgeBaseCreateInput): Promise<KnowledgeBase> {
    return kb.createKbBase(this.transport, input);
  }

  updateKbBase(
    baseId: string,
    patch: KnowledgeBaseUpdateInput
  ): Promise<KnowledgeBase> {
    return kb.updateKbBase(this.transport, baseId, patch);
  }

  deleteKbBase(baseId: string): Promise<void> {
    return kb.deleteKbBase(this.transport, baseId);
  }

  readKbFileByPath(baseId: string, path: string): Promise<KnowledgeEntry> {
    return kb.readKbFileByPath(this.transport, baseId, path);
  }

  writeKbFileByPath(
    baseId: string,
    path: string,
    input: KnowledgeWriteFileInput = {},
    expectedVersion?: string | null
  ): Promise<KnowledgeWriteFileResult> {
    return kb.writeKbFileByPath(
      this.transport,
      baseId,
      path,
      input,
      expectedVersion
    );
  }

  listKbDirByPath(
    baseId: string,
    path: string = ""
  ): Promise<KnowledgeDirListing> {
    return kb.listKbDirByPath(this.transport, baseId, path);
  }

  createKbFolderByPath(
    baseId: string,
    path: string,
    description?: string | null
  ): Promise<KnowledgeFolder> {
    return kb.createKbFolderByPath(this.transport, baseId, path, description);
  }

  deleteKbByPath(
    baseId: string,
    path: string
  ): Promise<KnowledgePathOpResult> {
    return kb.deleteKbByPath(this.transport, baseId, path);
  }

  moveKbByPath(
    baseId: string,
    fromPath: string,
    toPath: string
  ): Promise<KnowledgePathOpResult> {
    return kb.moveKbByPath(this.transport, baseId, fromPath, toPath);
  }

  searchKb(
    query: string,
    opts: { baseSlug?: string; limit?: number } = {}
  ): Promise<KnowledgeSearchHit[]> {
    return kb.searchKb(this.transport, query, opts);
  }
}
