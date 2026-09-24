"use strict";
/** The agent-identity, ontology, member and chat tools' text (`granular-text.ts › ToolText`). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GRAPH_TEXT = void 0;
exports.GRAPH_TEXT = {
    dopl_list_agents: {
        description: 'Agent identities you can see here, grouped by sharing, your personal ones included. An identity is a role of the user that agents launch from; running agents are dopl_get_channel action="status".',
    },
    dopl_get_agent: {
        description: "One agent identity in full, its INSTRUCTIONS block included.",
        params: { max_chars: "Clip the instructions to this many characters; the result says so." },
        required: ["identity"],
        fenced: true,
    },
    dopl_manage_agent: {
        description: "Create or update an agent identity, or grant one you made into a channel or container. An update needs expected_version. Knowledge attaches by reference, and only what you can read.",
        params: {
            identity: "Identity id or exact name; required except on create.",
            name: "Identity name; names are not unique.",
            description: "Short human-facing description; null clears it.",
            instructions: "Markdown prepended to every turn of its sessions (max 32 KB); null clears it.",
            model: "Default model id from the runtime's roster; null, its default.",
            runtime: "Preferred runtime, e.g. claude or codex; null, the channel's.",
            fields: "Custom fields for the launch payload; replaces the set.",
            visibility: '"private" (you and admins) or "workspace" (this container; in a home channel, that room).',
            knowledge_bases: "Whole bases to attach, by id; replaces the set.",
            knowledge: "Scoped attachments ({base}, {base, folder} or {base, entry}); replaces the set. Not with knowledge_bases.",
            expected_version: 'action="update": the Version dopl_get_agent printed.',
        },
    },
    dopl_browse_ontology: {
        description: 'The object graph without opening objects. action="map" ontologies and their objects with direct items (two levels only), "anchor" your own object, "resolve" objects whose name or subtitle contains `query` (max 20).',
        params: { query: 'action="resolve": the text to match.' },
    },
    dopl_get_object: {
        description: "One ontology object: attributes, relationships, backlinks, children, actions and its Version.",
        required: ["object"],
        fenced: true,
    },
    dopl_edit_object: {
        description: "Edit one thing on the object graph: create or update an object, set or remove one attribute, relationship, action or template field, or claim_anchor (link yourself to it). remove_* strips a field, never the object.",
        params: {
            object: "Object id or exact name; required except on create.",
            parent: "create: the object to nest under.",
            name: "create, update: the object name. set_action, remove_action: the action.",
            subtitle: "update: the short description agents browse.",
            label: "The attribute, relationship or template-field label.",
            kind: "set_attribute, set_template_field: the value kind (default text).",
            value: "set_attribute, kind text or pill: the value.",
            values: "set_attribute, kind ref, knowledge or skill: ids, slugs or names (knowledge also `<base>/<path>`).",
            targets: "set_relationship: the target objects.",
            description: "set_action: what it does.",
            outcome: "set_action: its expected outcome.",
            tools: "set_action: the tools to use.",
            expected_version: "Version from dopl_get_object; omitted, last writer wins.",
        },
    },
    dopl_manage_ontology: {
        description: "Create or update an ontology (name, purpose), or add an object type to one (create_column).",
        params: {
            ontology: "update, create_column: the ontology's slug, id or exact name.",
            name: "The ontology name, or create_column: the object type's.",
            purpose: "Its routing one-liner.",
        },
    },
    dopl_get_member: {
        description: 'Who someone is: who="me" your id, role, teams and session runtime; "member" a profile and access (another member\'s: admin-only); "team" one team; "my_access" your level per resource.',
        params: { member: "User id, email or display name.", team: "Team id or name." },
    },
    dopl_list_members: {
        description: 'Rosters: list="members" (invited and deactivated included, so read status), "teams" with their grants, "access_matrix" knowledge bases and skills by access (every one for admins, your view otherwise).',
        params: { fields: 'list="members": comma-separated subset of name,role,status,teams.' },
    },
    dopl_list_chats: {
        description: 'The chat archive: list="chats" newest first (`query` matches titles and overviews, never transcripts) or "folders" with their sharing.',
        params: { scope: '"private", "shared" or "all" (default).', query: "Filter on titles and overviews." },
    },
    dopl_get_chat: {
        description: "One archived chat: header, deliverables, learnings and summarized transcript.",
        params: { chat_id: "Chat id." },
        required: ["chat_id"],
        fenced: true,
    },
    dopl_save_chat: {
        description: 'Archive a session: export (a header plus one summarized entry per message), append messages, update the header or sharing, create or update a folder. Read dopl_get_guide topic="chats" first; re-scoping a folder re-scopes its chats.',
        params: {
            chat_id: "append, update: the chat.",
            title: "export (required), update: a title specific enough to find later.",
            overview: "One paragraph on what the session was about.",
            messages: "export (required), append: one summarized entry per message; verbatim only when asked.",
            deliverables: "What was done (done=true) or agreed but unfinished.",
            learnings: "Durable facts worth recalling later.",
            client_session_id: "export: your stable session id, so a re-export updates. Always pass one.",
            session_date: "The session's date, YYYY-MM-DD.",
            source: "export: the client it ran in.",
            project: 'The repo or project; update: "" clears it.',
            folder: 'Folder name to file under (created if missing; the chat takes its sharing); update: "" unfiles.',
            visibility: '"private" (export default) or "public"; refused on a chat in a folder.',
            pinned: "update: pin or unpin.",
            name: "create_folder (required), update_folder: the folder name.",
            folder_id: "update_folder: the folder.",
        },
    },
};
