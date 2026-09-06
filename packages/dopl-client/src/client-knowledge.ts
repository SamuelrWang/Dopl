/**
 * Knowledge-base method group — link 3 of the chain in `client-base.ts`. Pure
 * delegation to `knowledge.ts`; no HTTP here.
 *
 * Path-based methods take a base id and a "/"-separated path; the server
 * resolves to folder/entry rows.
 */

import { WorkspaceMethods } from "./client-workspaces.js";
import * as kb from "./knowledge.js";
import type {
  KbShelf,
  KnowledgeBase,
  KnowledgeBaseCreateInput,
  KnowledgeBaseListPayload,
  KnowledgeBaseUpdateInput,
  KnowledgeDirListing,
  KnowledgeEntry,
  KnowledgeFolder,
  KnowledgePathOpResult,
  KnowledgeReadFileResult,
  KnowledgeSearchHit,
  KnowledgeTreeSnapshot,
  KnowledgeWriteFileInput,
  KnowledgeWriteFileResult,
  StartupContext,
} from "./knowledge-types.js";

export class KnowledgeMethods extends WorkspaceMethods {
  listKbBases(opts: { shelf?: KbShelf } = {}): Promise<KnowledgeBase[]> {
    return kb.listKbBases(this.transport, opts);
  }

  /** The rows PLUS the shelf sibling key. ⚠ Same single request as
   *  {@link listKbBases}; read `homeScopedBaseIds` as `?? []` (INVARIANTS §8). */
  listKbBasesPayload(
    opts: { shelf?: KbShelf } = {}
  ): Promise<KnowledgeBaseListPayload> {
    return kb.listKbBasesPayload(this.transport, opts);
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

  /** 🔒 {@link createKbBase}'s gates without its write — resolves if that body
   *  would be accepted, throws the create's own error if it would not. The
   *  confirm class asks this BEFORE minting a token, so a preview cannot
   *  promise a create the confirmed call refuses. */
  dryRunKbBase(input: KnowledgeBaseCreateInput): Promise<void> {
    return kb.dryRunKbBase(this.transport, input);
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

  /** Pin/unpin a base for the WORKSPACE's agent launches (T81). ⚠ `pinned`
   *  picks the verb — two idempotent verbs, never a toggle. */
  setKbBasePinned(baseId: string, pinned: boolean): Promise<void> {
    return kb.setKbBasePinned(this.transport, baseId, pinned);
  }

  /** The single-entry half of {@link setKbBasePinned}. */
  setKbEntryPinned(entryId: string, pinned: boolean): Promise<void> {
    return kb.setKbEntryPinned(this.transport, entryId, pinned);
  }

  /** The pinned reading list a session starts with. ⚠ Read `truncated` /
   *  `omitted` — see {@link StartupContext}. */
  getKbStartupContext(): Promise<StartupContext> {
    return kb.getKbStartupContext(this.transport);
  }

  readKbFileByPath(baseId: string, path: string): Promise<KnowledgeEntry> {
    return kb.readKbFileByPath(this.transport, baseId, path);
  }

  readKbFilePart(
    baseId: string,
    path: string,
    opts: { section?: string; outline?: boolean } = {}
  ): Promise<KnowledgeReadFileResult> {
    return kb.readKbFilePart(this.transport, baseId, path, opts);
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
