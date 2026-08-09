"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "@/shared/ui/toast";
import type { ResolvedSkill, Skill } from "@/features/skills/types";
import {
  SkillApiError,
  type UpdateSkillPatch,
  fetchSkill,
  updateSkill,
} from "@/features/skills/client/api";
import type { SkillScope } from "../scope";
import { errMessage } from "../components/skill-view-utils";

type DisplayedSharing = Pick<
  Skill,
  "visibility" | "accessMode" | "grantedTeamIds"
>;

interface Params {
  skill: Skill;
  workspaceId: string;
  /** A rename or refolder changed how the parent's list renders. */
  onListChanged?: () => void;
}

/**
 * The skill header's metadata: the displayed name / folder / sharing, and
 * every PATCH that changes them.
 *
 * Metadata rides its OWN optimistic-concurrency clock — the skill row's
 * `updated_at`, separate from the body's `body_updated_at`. Body saves move
 * it too (the touch trigger fires on any `skills` UPDATE), so the caller
 * feeds every `skillUpdatedAt` it sees back through `adoptBaseline`; that is
 * what stops a name/folder/sharing edit from false-412-ing right after a
 * body autosave (F-038 D9/D10).
 *
 * The mirrors track the props until the user commits a change, then drive the
 * bar locally so it updates without a route reload.
 */
export function useSkillMetadata({ skill, workspaceId, onListChanged }: Params) {
  const [name, setName] = useState(skill.name);
  const [folder, setFolder] = useState(skill.folder);
  const [sharing, setSharing] = useState<DisplayedSharing>({
    visibility: skill.visibility,
    accessMode: skill.accessMode,
    grantedTeamIds: skill.grantedTeamIds,
  });
  const metaBaselineRef = useRef(skill.updatedAt);

  // Re-sync the mirrors when the server prop changes (sanctioned
  // adjust-state-during-render pattern — no effect round-trip).
  const sharingKey = `${skill.visibility}:${skill.accessMode}:${skill.grantedTeamIds.join(",")}`;
  const [lastProps, setLastProps] = useState({
    name: skill.name,
    folder: skill.folder,
    sharingKey,
  });
  if (
    lastProps.name !== skill.name ||
    lastProps.folder !== skill.folder ||
    lastProps.sharingKey !== sharingKey
  ) {
    setLastProps({ name: skill.name, folder: skill.folder, sharingKey });
    setName(skill.name);
    setFolder(skill.folder);
    setSharing({
      visibility: skill.visibility,
      accessMode: skill.accessMode,
      grantedTeamIds: skill.grantedTeamIds,
    });
  }

  const slug = skill.slug;

  /**
   * Pull the freshest skill, adopt its metadata clock, and sync the bar —
   * remote renames / refolders / reshares from another tab or an MCP agent
   * surface here. Returns the full payload so the caller can also re-seed the
   * body editor (only ever when the editor is at rest). Never reseeds
   * anything itself, so it is safe to call mid-edit.
   */
  const pullLatest = useCallback(async (): Promise<ResolvedSkill | null> => {
    const fresh = await fetchSkill(slug, workspaceId).catch(() => null);
    if (!fresh) return null;
    metaBaselineRef.current = fresh.skill.updatedAt;
    setName(fresh.skill.name);
    setFolder(fresh.skill.folder);
    setSharing({
      visibility: fresh.skill.visibility,
      accessMode: fresh.skill.accessMode,
      grantedTeamIds: fresh.skill.grantedTeamIds,
    });
    return fresh;
  }, [slug, workspaceId]);

  /**
   * Single choke-point for metadata PATCHes: sends the metadata precondition
   * and, on a 412, refreshes the bar + baseline and surfaces the conflict as a
   * toast (the discrete-field analogue of the body editor's "Edited
   * elsewhere" banner) rather than silently overwriting. Returns null when
   * the 412 path swallowed the edit; other failures throw.
   */
  const commit = useCallback(
    async (patch: UpdateSkillPatch): Promise<Skill | null> => {
      try {
        const saved = await updateSkill(
          slug,
          patch,
          workspaceId,
          metaBaselineRef.current
        );
        metaBaselineRef.current = saved.updatedAt;
        return saved;
      } catch (err) {
        if (err instanceof SkillApiError && err.status === 412) {
          await pullLatest();
          toast({
            title: "Edited elsewhere",
            description:
              "This skill's details changed elsewhere — your edit wasn't applied. The latest is shown; reapply if you still want it.",
          });
          return null;
        }
        throw err;
      }
    },
    [slug, workspaceId, pullLatest]
  );

  // Throws on failure so EditableTitle's own onError handler can toast it.
  const rename = useCallback(
    async (next: string) => {
      const saved = await commit({ name: next });
      if (!saved) return;
      setName(saved.name);
      // The browser's list pane renders server-fetched names — refresh so
      // the row matches the new title.
      onListChanged?.();
    },
    [commit, onListChanged]
  );

  const refile = useCallback(
    async (next: string | null) => {
      try {
        const saved = await commit({ folder: next });
        if (!saved) return;
        setFolder(saved.folder);
        // Left list groups by folder — refresh so the row re-homes.
        onListChanged?.();
      } catch (err) {
        toast({ title: "Couldn't change folder", description: errMessage(err) });
      }
    },
    [commit, onListChanged]
  );

  const reshare = useCallback(
    async (scope: SkillScope, teamIds: string[]) => {
      try {
        const saved = await commit(
          scope === "private"
            ? { visibility: "private" }
            : scope === "team"
              ? { visibility: "public", accessMode: "teams", teamIds }
              : { visibility: "public", accessMode: "workspace" }
        );
        if (!saved) return;
        setSharing({
          visibility: saved.visibility,
          accessMode: saved.accessMode,
          grantedTeamIds: saved.grantedTeamIds,
        });
      } catch (err) {
        toast({ title: "Couldn't change sharing", description: errMessage(err) });
      }
    },
    [commit]
  );

  /** Adopt a `skills.updated_at` seen on a body-save response (F-038 D10). */
  const adoptBaseline = useCallback((skillUpdatedAt: string) => {
    metaBaselineRef.current = skillUpdatedAt;
  }, []);

  return {
    displayed: { name, folder, sharing },
    rename,
    refile,
    reshare,
    pullLatest,
    adoptBaseline,
  };
}
