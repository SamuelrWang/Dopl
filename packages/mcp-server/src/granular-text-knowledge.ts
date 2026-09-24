/** The knowledge, skill and version tools' text (`granular-text.ts › ToolText`). */

import type { ToolText } from "./granular-text.js";

export const KNOWLEDGE_TEXT: Readonly<Record<string, ToolText>> = {
  dopl_browse_knowledge: {
    description:
      'Knowledge bases without their bodies; open the cheapest view first. action="list_bases" the bases you can read, "tree" a base\'s folders and entries (400 entries a page), "list_dir" one folder, "outline" an entry\'s headings and sizes.',
    params: {
      base: "Knowledge base slug or id; required except for list_bases.",
      path: 'list_dir: a folder ("/" is the root). outline: an entry.',
      entry_limit: "tree: entries per page (default 400).",
      entry_cursor: "tree: the cursor the previous page printed.",
    },
  },
  dopl_read_entry: {
    description:
      'One knowledge entry\'s body, whole or one heading\'s `section`, optionally clipped. Prefer a section: action="outline" on dopl_browse_knowledge lists them. Prints the Version a write needs.',
    params: {
      section: "Only this heading's section, loose match, all served; an unknown one answers with the outline.",
      max_chars: "Stop after this many body characters; a clip says so.",
      offset: "Start the body at this character; pairs with max_chars.",
    },
    required: ["base", "path"],
    fenced: true,
  },
  dopl_write_entry: {
    description:
      "Create or overwrite a knowledge entry, or replace one `section`. Overwriting needs `expected_version` from your last read. An entry past ~1.5k chars needs ## headings, one topic each.",
    params: {
      path: "Entry path; omitted, the title.",
      section: "Replace only this heading's section; appended as ## if absent.",
      body: "Markdown body; a single space for a deliberate stub.",
      title: "Title (no '/'); renames the path's last segment.",
      excerpt: "Summary, max 300; required when creating an entry.",
      expected_version: "Version from your last read; required to overwrite.",
    },
    required: ["base", "body"],
  },
  dopl_manage_knowledge: {
    description:
      "Bases and folders: create_base, update_base, create_folder (mkdir -p), move_folder, move_entry, publish (a base public to every member, one way), grant (lend a base you made). Nothing here deletes.",
    params: {
      base: "Knowledge base slug or id; required except for create_base.",
      path: "create_folder: the folder path.",
      from_path: "Move: the source path.",
      to_path: "Move: the destination; its leaf is the new name.",
      name: "create_base, update_base: the base name.",
      description: "Base description (max 2,000), or create_folder: the folder summary (max 300).",
      slug: "update_base: a new slug.",
      visibility: 'create_base: "private" (default) or "public". publish: "public".',
    },
  },
  dopl_list_skills: {
    description:
      "Active skills you can see, with their triggers, grouped by folder; drafts and skills you have no grant on are absent. Check at every task boundary.",
    params: { folder: "Only skills in this folder." },
  },
  dopl_get_skill: {
    description:
      'One skill: view="details" its metadata and SKILL.md body, view="body" the body plus the Version dopl_update_skill needs.',
    params: { detail: 'view="details": "summary" leaves the body out.' },
    required: ["slug"],
    fenced: true,
  },
  dopl_create_skill: {
    description:
      'Create a skill: one SKILL.md procedure plus its triggers. Read dopl_get_guide topic="skill_authoring" first.',
    params: {
      name: "Skill name.",
      description: "What the skill does.",
      when_to_use: "When to use it: its trigger.",
      when_not_to_use: "When not to.",
      status: '"active" (default) or "draft".',
      agent_write_enabled: "Let agents edit it later; afterwards only a human can change this.",
      folder: "Folder label; empty, unfiled.",
      body: "The SKILL.md.",
    },
    required: ["name", "description", "when_to_use"],
  },
  dopl_update_skill: {
    description:
      'Change a skill: action="update" its metadata, "write" replace the SKILL.md (needs expected_version), "visibility" share it workspace-wide or make it private. Agents edit only skills with agent writes on.',
    params: {
      name: "Skill name.",
      description: "What the skill does.",
      when_to_use: "When to use it: its trigger.",
      when_not_to_use: "When not to.",
      new_slug: "A new slug.",
      status: '"active" or "draft".',
      folder: "Folder label; empty, unfiled.",
      body: 'action="write": the full new SKILL.md.',
      expected_version: 'action="write": the Version view="body" printed.',
      visibility: '"public" (workspace-wide) or "private".',
    },
    required: ["slug"],
  },
  dopl_list_versions: {
    description:
      'Version history: resource="entry" or "skill" (revision previews one snapshot), "object" an ontology object, or a whole ontology\'s roll-up.',
    params: {
      path: "entry: the entry path.",
      slug: "skill: skill slug or id.",
      object: "object: the object (or pass ontology instead).",
      ontology: "object: a whole ontology's roll-up instead of one object.",
      revision: "entry, skill: preview this revision.",
      limit: "entry, skill: rows per page (default 20).",
      entry_cursor: "entry: the cursor the previous page printed.",
    },
    fenced: true,
  },
  dopl_restore_version: {
    description:
      "Write an earlier revision of an entry, skill or ontology object back as a new revision. Needs the revision from dopl_list_versions and the current Version.",
    params: {
      path: "entry: the entry path.",
      slug: "skill: skill slug or id.",
      object: "object: the object.",
      expected_version: "The current Version; a stale one is refused.",
    },
    required: ["revision", "expected_version"],
  },
};
