/**
 * **GENERATED FROM THE DEPLOYED DATABASE — NOT FROM `supabase/migrations/`.**
 * Do not hand-edit; re-generate.
 *
 *   npx supabase gen types typescript --linked > src/shared/supabase/types.ts
 *
 * ⚠ **SO "STALE" HERE MEANS TWO DIFFERENT THINGS AND ONLY ONE OF THEM IS A BUG**
 * (recorded 2026-09-02, in the wave-B batch-2 review, which flagged the file as
 * out of date). This file describes what PRODUCTION HOLDS. Wave B's eleven
 * migrations are UNAPPLIED, so the absence of `resource_grants` and
 * `ensure_home_space`, and the presence of `team_resource_access`, are
 * this file being CORRECT about a database that has not moved yet.
 * Re-generating it now would rewrite it to the same thing.
 * ⚠ **IT BECOMES A REAL DEFECT THE MOMENT THOSE MIGRATIONS APPLY**, and it will
 * not announce itself: the repositories that touch the new tables take a
 * `SupabaseClient` as a parameter rather than the typed singleton
 * (`knowledge/server/repository-channel-grants.ts` says why), so a missing table
 * here is not a compile error anywhere — it is `never` inference nobody meets.
 * **Re-generate in the same change that applies them.**
 * ⚠ Deploy state is a MEASUREMENT (CLAUDE.md doc rule 4): the command above is
 * the claim this comment makes, not the table list below it.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      agent_identities: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          fields: Json
          id: string
          instructions: string | null
          model: string | null
          name: string
          runtime: string | null
          updated_at: string
          visibility: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          fields?: Json
          id?: string
          instructions?: string | null
          model?: string | null
          name: string
          runtime?: string | null
          updated_at?: string
          visibility?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          fields?: Json
          id?: string
          instructions?: string | null
          model?: string | null
          name?: string
          runtime?: string | null
          updated_at?: string
          visibility?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_identities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_identity_knowledge_bases: {
        Row: {
          added_at: string
          added_by_user_id: string | null
          entry_id: string | null
          folder_id: string | null
          id: string
          identity_id: string
          knowledge_base_id: string
          scope_kind: string
          workspace_id: string
        }
        Insert: {
          added_at?: string
          added_by_user_id?: string | null
          entry_id?: string | null
          folder_id?: string | null
          id?: string
          identity_id: string
          knowledge_base_id: string
          scope_kind?: string
          workspace_id: string
        }
        Update: {
          added_at?: string
          added_by_user_id?: string | null
          entry_id?: string | null
          folder_id?: string | null
          id?: string
          identity_id?: string
          knowledge_base_id?: string
          scope_kind?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_identity_knowledge_bases_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "knowledge_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_identity_knowledge_bases_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "knowledge_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_identity_knowledge_bases_identity_id_fkey"
            columns: ["identity_id"]
            isOneToOne: false
            referencedRelation: "agent_identities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_identity_knowledge_bases_knowledge_base_id_fkey"
            columns: ["knowledge_base_id"]
            isOneToOne: false
            referencedRelation: "knowledge_bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_identity_knowledge_bases_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_presence: {
        Row: {
          last_seen_at: string
          status: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          last_seen_at?: string
          status?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          last_seen_at?: string
          status?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_presence_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_agent_directions: {
        Row: {
          agent_id: string
          body: string
          channel_id: string
          claimed_at: string | null
          client_msg_id: string | null
          created_at: string
          decided_at: string | null
          expires_at: string
          id: string
          operator_user_id: string
          refusal_reason: string | null
          reply: string | null
          sender_agent_id: string | null
          status: string
          task_id: string | null
          workspace_id: string
        }
        Insert: {
          agent_id: string
          body: string
          channel_id: string
          claimed_at?: string | null
          client_msg_id?: string | null
          created_at?: string
          decided_at?: string | null
          expires_at: string
          id?: string
          operator_user_id: string
          refusal_reason?: string | null
          reply?: string | null
          sender_agent_id?: string | null
          status?: string
          task_id?: string | null
          workspace_id: string
        }
        Update: {
          agent_id?: string
          body?: string
          channel_id?: string
          claimed_at?: string | null
          client_msg_id?: string | null
          created_at?: string
          decided_at?: string | null
          expires_at?: string
          id?: string
          operator_user_id?: string
          refusal_reason?: string | null
          reply?: string | null
          sender_agent_id?: string | null
          status?: string
          task_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_agent_directions_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_agent_directions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "channel_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_agent_directions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "channel_tasks_activity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_agent_directions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_agents: {
        Row: {
          channel_id: string
          created_at: string
          id: string
          name: string
          owner_user_id: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          channel_id: string
          created_at?: string
          id?: string
          name: string
          owner_user_id: string
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          channel_id?: string
          created_at?: string
          id?: string
          name?: string
          owner_user_id?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_agents_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_agents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_artifacts: {
        Row: {
          channel_id: string
          client_msg_id: string | null
          created_at: string
          created_by: string
          created_by_agent: string | null
          dissolved_at: string | null
          id: string
          name: string
          summary: string
          workspace_id: string
        }
        Insert: {
          channel_id: string
          client_msg_id?: string | null
          created_at?: string
          created_by: string
          created_by_agent?: string | null
          dissolved_at?: string | null
          id?: string
          name: string
          summary?: string
          workspace_id: string
        }
        Update: {
          channel_id?: string
          client_msg_id?: string | null
          created_at?: string
          created_by?: string
          created_by_agent?: string | null
          dissolved_at?: string | null
          id?: string
          name?: string
          summary?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_artifacts_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_artifacts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_consent_requests: {
        Row: {
          body_preview: string
          channel_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          expires_at: string | null
          id: string
          kind: string
          message_seq: number | null
          operator_user_id: string
          proposed_reply: string | null
          requester_user_id: string | null
          status: string
          summary: string
          workspace_id: string
        }
        Insert: {
          body_preview?: string
          channel_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          expires_at?: string | null
          id?: string
          kind: string
          message_seq?: number | null
          operator_user_id: string
          proposed_reply?: string | null
          requester_user_id?: string | null
          status?: string
          summary?: string
          workspace_id: string
        }
        Update: {
          body_preview?: string
          channel_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          expires_at?: string | null
          id?: string
          kind?: string
          message_seq?: number | null
          operator_user_id?: string
          proposed_reply?: string | null
          requester_user_id?: string | null
          status?: string
          summary?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_consent_requests_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_consent_requests_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_launch_directives: {
        Row: {
          agent_id: string | null
          agent_name: string | null
          applied_agent_name: string | null
          applied_chain: boolean | null
          applied_message_mode: string | null
          applied_model: string | null
          applied_runtime: string | null
          applied_setting: string | null
          applied_tool_mode: string | null
          chain: boolean | null
          channel_id: string
          claimed_at: string | null
          client_msg_id: string | null
          color: string | null
          created_at: string
          decided_at: string | null
          expires_at: string
          goal: string | null
          id: string
          identity_id: string | null
          identity_name: string | null
          kind: string
          model: string | null
          operator_user_id: string
          refusal_reason: string | null
          resolved_chain: boolean | null
          resolved_message_mode: string | null
          resolved_model: string | null
          resolved_tool_mode: string | null
          runtime: string | null
          start_message_mode: string | null
          start_tool_mode: string | null
          status: string
          target_agent_id: string | null
          target_message_mode: string | null
          target_name: string | null
          target_tool_mode: string | null
          task_id: string | null
          workspace_id: string
        }
        Insert: {
          agent_id?: string | null
          agent_name?: string | null
          applied_agent_name?: string | null
          applied_chain?: boolean | null
          applied_message_mode?: string | null
          applied_model?: string | null
          applied_runtime?: string | null
          applied_setting?: string | null
          applied_tool_mode?: string | null
          chain?: boolean | null
          channel_id: string
          claimed_at?: string | null
          client_msg_id?: string | null
          color?: string | null
          created_at?: string
          decided_at?: string | null
          expires_at: string
          goal?: string | null
          id?: string
          identity_id?: string | null
          identity_name?: string | null
          kind?: string
          model?: string | null
          operator_user_id: string
          refusal_reason?: string | null
          resolved_chain?: boolean | null
          resolved_message_mode?: string | null
          resolved_model?: string | null
          resolved_tool_mode?: string | null
          runtime?: string | null
          start_message_mode?: string | null
          start_tool_mode?: string | null
          status?: string
          target_agent_id?: string | null
          target_message_mode?: string | null
          target_name?: string | null
          target_tool_mode?: string | null
          task_id?: string | null
          workspace_id: string
        }
        Update: {
          agent_id?: string | null
          agent_name?: string | null
          applied_agent_name?: string | null
          applied_chain?: boolean | null
          applied_message_mode?: string | null
          applied_model?: string | null
          applied_runtime?: string | null
          applied_setting?: string | null
          applied_tool_mode?: string | null
          chain?: boolean | null
          channel_id?: string
          claimed_at?: string | null
          client_msg_id?: string | null
          color?: string | null
          created_at?: string
          decided_at?: string | null
          expires_at?: string
          goal?: string | null
          id?: string
          identity_id?: string | null
          identity_name?: string | null
          kind?: string
          model?: string | null
          operator_user_id?: string
          refusal_reason?: string | null
          resolved_chain?: boolean | null
          resolved_message_mode?: string | null
          resolved_model?: string | null
          resolved_tool_mode?: string | null
          runtime?: string | null
          start_message_mode?: string | null
          start_tool_mode?: string | null
          status?: string
          target_agent_id?: string | null
          target_message_mode?: string | null
          target_name?: string | null
          target_tool_mode?: string | null
          task_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_launch_directives_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_launch_directives_identity_id_fkey"
            columns: ["identity_id"]
            isOneToOne: false
            referencedRelation: "agent_identities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_launch_directives_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "channel_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_launch_directives_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "channel_tasks_activity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_launch_directives_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_link_claims: {
        Row: {
          claimed_by: string
          created_at: string
          id: string
          link_id: string
          workspace_id: string
        }
        Insert: {
          claimed_by: string
          created_at?: string
          id?: string
          link_id: string
          workspace_id: string
        }
        Update: {
          claimed_by?: string
          created_at?: string
          id?: string
          link_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_link_claims_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "channel_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_link_claims_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_links: {
        Row: {
          created_at: string
          creator_user_id: string
          expires_at: string | null
          granted_role: string
          id: string
          label: string | null
          max_uses: number | null
          revoked_at: string | null
          token: string
          use_count: number
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          creator_user_id: string
          expires_at?: string | null
          granted_role?: string
          id?: string
          label?: string | null
          max_uses?: number | null
          revoked_at?: string | null
          token: string
          use_count?: number
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          creator_user_id?: string
          expires_at?: string | null
          granted_role?: string
          id?: string
          label?: string | null
          max_uses?: number | null
          revoked_at?: string | null
          token?: string
          use_count?: number
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "channel_links_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_members: {
        Row: {
          added_by: string | null
          agent_tool_profile: string
          channel_id: string
          favorited_at: string | null
          joined_at: string
          last_read_at: string | null
          role: string
          unaddressed_responder: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          added_by?: string | null
          agent_tool_profile?: string
          channel_id: string
          favorited_at?: string | null
          joined_at?: string
          last_read_at?: string | null
          role?: string
          unaddressed_responder?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          added_by?: string | null
          agent_tool_profile?: string
          channel_id?: string
          favorited_at?: string | null
          joined_at?: string
          last_read_at?: string | null
          role?: string
          unaddressed_responder?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_members_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_mention_reads: {
        Row: {
          channel_id: string
          message_id: string
          read_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          channel_id: string
          message_id: string
          read_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          channel_id?: string
          message_id?: string
          read_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_mention_reads_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_mention_reads_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "channel_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_mention_reads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_messages: {
        Row: {
          artifact_id: string | null
          author_kind: string
          author_user_id: string | null
          body: string
          channel_id: string
          client_msg_id: string | null
          created_at: string
          delivery: string | null
          delivery_at: string | null
          id: string
          kind: string
          metadata: Json
          recipient_agent_ids: string[] | null
          recipient_user_ids: string[] | null
          search_tsv: unknown
          seq: number
          wake_verdict: string | null
          workspace_id: string
        }
        Insert: {
          artifact_id?: string | null
          author_kind?: string
          author_user_id?: string | null
          body?: string
          channel_id: string
          client_msg_id?: string | null
          created_at?: string
          delivery?: string | null
          delivery_at?: string | null
          id?: string
          kind?: string
          metadata?: Json
          recipient_agent_ids?: string[] | null
          recipient_user_ids?: string[] | null
          search_tsv?: unknown
          seq?: never
          wake_verdict?: string | null
          workspace_id: string
        }
        Update: {
          artifact_id?: string | null
          author_kind?: string
          author_user_id?: string | null
          body?: string
          channel_id?: string
          client_msg_id?: string | null
          created_at?: string
          delivery?: string | null
          delivery_at?: string | null
          id?: string
          kind?: string
          metadata?: Json
          recipient_agent_ids?: string[] | null
          recipient_user_ids?: string[] | null
          search_tsv?: unknown
          seq?: never
          wake_verdict?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_messages_artifact_id_fkey"
            columns: ["artifact_id"]
            isOneToOne: false
            referencedRelation: "channel_artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_sessions: {
        Row: {
          channel_id: string
          channel_name: string | null
          color: string | null
          context_used: number | null
          context_window: number | null
          created_at: string
          denied_calls: number | null
          detail: string | null
          display_name: string | null
          id: string
          identity_name: string | null
          last_activity_at: string | null
          last_denied_tool: string | null
          last_wake_at: string | null
          last_wake_seq: number | null
          model: string | null
          name: string
          session_key: string
          stale: boolean | null
          started_at: string | null
          state: string
          task_id: string | null
          thread_title: string | null
          tokens_delta: number | null
          tokens_spent: number | null
          tool_label: string | null
          turns: number | null
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          channel_id: string
          channel_name?: string | null
          color?: string | null
          context_used?: number | null
          context_window?: number | null
          created_at?: string
          denied_calls?: number | null
          detail?: string | null
          display_name?: string | null
          id?: string
          identity_name?: string | null
          last_activity_at?: string | null
          last_denied_tool?: string | null
          last_wake_at?: string | null
          last_wake_seq?: number | null
          model?: string | null
          name: string
          session_key: string
          stale?: boolean | null
          started_at?: string | null
          state: string
          task_id?: string | null
          thread_title?: string | null
          tokens_delta?: number | null
          tokens_spent?: number | null
          tool_label?: string | null
          turns?: number | null
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          channel_id?: string
          channel_name?: string | null
          color?: string | null
          context_used?: number | null
          context_window?: number | null
          created_at?: string
          denied_calls?: number | null
          detail?: string | null
          display_name?: string | null
          id?: string
          identity_name?: string | null
          last_activity_at?: string | null
          last_denied_tool?: string | null
          last_wake_at?: string | null
          last_wake_seq?: number | null
          model?: string | null
          name?: string
          session_key?: string
          stale?: boolean | null
          started_at?: string | null
          state?: string
          task_id?: string | null
          thread_title?: string | null
          tokens_delta?: number | null
          tokens_spent?: number | null
          tool_label?: string | null
          turns?: number | null
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_sessions_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_sessions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "channel_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_sessions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "channel_tasks_activity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_tasks: {
        Row: {
          channel_id: string
          client_msg_id: string | null
          closed_at: string | null
          created_at: string
          created_by: string
          id: string
          mode: string
          outcome: string | null
          outcome_summary: string | null
          status: string
          target_user_id: string | null
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          channel_id: string
          client_msg_id?: string | null
          closed_at?: string | null
          created_at?: string
          created_by: string
          id?: string
          mode?: string
          outcome?: string | null
          outcome_summary?: string | null
          status?: string
          target_user_id?: string | null
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          channel_id?: string
          client_msg_id?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string
          id?: string
          mode?: string
          outcome?: string | null
          outcome_summary?: string | null
          status?: string
          target_user_id?: string | null
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_tasks_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          agent_chain_allowed: boolean | null
          agent_message_ceiling: string | null
          agent_tool_ceiling: string | null
          archived_at: string | null
          created_at: string
          created_by: string
          default_responder_agent_name: string | null
          deleted_at: string | null
          direct_key: string | null
          id: string
          info_card: Json
          is_direct: boolean
          name: string
          slug: string
          topic: string
          updated_at: string
          visibility: string
          workspace_id: string
        }
        Insert: {
          agent_chain_allowed?: boolean | null
          agent_message_ceiling?: string | null
          agent_tool_ceiling?: string | null
          archived_at?: string | null
          created_at?: string
          created_by: string
          default_responder_agent_name?: string | null
          deleted_at?: string | null
          direct_key?: string | null
          id?: string
          info_card?: Json
          is_direct?: boolean
          name: string
          slug: string
          topic?: string
          updated_at?: string
          visibility?: string
          workspace_id: string
        }
        Update: {
          agent_chain_allowed?: boolean | null
          agent_message_ceiling?: string | null
          agent_tool_ceiling?: string | null
          archived_at?: string | null
          created_at?: string
          created_by?: string
          default_responder_agent_name?: string | null
          deleted_at?: string | null
          direct_key?: string | null
          id?: string
          info_card?: Json
          is_direct?: boolean
          name?: string
          slug?: string
          topic?: string
          updated_at?: string
          visibility?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channels_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_folders: {
        Row: {
          access_mode: string
          created_at: string
          id: string
          name: string
          user_id: string
          visibility: string
          workspace_id: string
        }
        Insert: {
          access_mode?: string
          created_at?: string
          id?: string
          name: string
          user_id: string
          visibility?: string
          workspace_id: string
        }
        Update: {
          access_mode?: string
          created_at?: string
          id?: string
          name?: string
          user_id?: string
          visibility?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_folders_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          chat_id: string
          created_at: string
          id: string
          position: number
          role: string
          summary: string
          verbatim: string | null
          workspace_id: string
        }
        Insert: {
          chat_id: string
          created_at?: string
          id?: string
          position: number
          role: string
          summary: string
          verbatim?: string | null
          workspace_id: string
        }
        Update: {
          chat_id?: string
          created_at?: string
          id?: string
          position?: number
          role?: string
          summary?: string
          verbatim?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      chats: {
        Row: {
          access_mode: string
          client_session_id: string | null
          created_at: string
          deleted_at: string | null
          deliverables: Json
          exported_at: string
          folder_id: string | null
          format: string
          id: string
          learnings: Json
          overview: string
          owner_id: string
          pinned: boolean
          project: string | null
          session_date: string
          source: string
          title: string
          updated_at: string
          visibility: string
          workspace_id: string
        }
        Insert: {
          access_mode?: string
          client_session_id?: string | null
          created_at?: string
          deleted_at?: string | null
          deliverables?: Json
          exported_at?: string
          folder_id?: string | null
          format?: string
          id?: string
          learnings?: Json
          overview?: string
          owner_id: string
          pinned?: boolean
          project?: string | null
          session_date?: string
          source?: string
          title: string
          updated_at?: string
          visibility?: string
          workspace_id: string
        }
        Update: {
          access_mode?: string
          client_session_id?: string | null
          created_at?: string
          deleted_at?: string | null
          deliverables?: Json
          exported_at?: string
          folder_id?: string | null
          format?: string
          id?: string
          learnings?: Json
          overview?: string
          owner_id?: string
          pinned?: boolean
          project?: string | null
          session_date?: string
          source?: string
          title?: string
          updated_at?: string
          visibility?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chats_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "chat_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chats_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      conversion_events: {
        Row: {
          event_type: string
          id: string
          metadata: Json
          occurred_at: string
          user_id: string
        }
        Insert: {
          event_type: string
          id?: string
          metadata?: Json
          occurred_at?: string
          user_id: string
        }
        Update: {
          event_type?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          user_id?: string
        }
        Relationships: []
      }
      credit_usage_events: {
        Row: {
          amount: number
          channel_id: string | null
          created_at: string
          id: string
          origin_workspace_id: string | null
          payer_user_id: string | null
          period_start: string
          user_id: string | null
          wallet: string
          workspace_id: string
        }
        Insert: {
          amount: number
          channel_id?: string | null
          created_at?: string
          id?: string
          origin_workspace_id?: string | null
          payer_user_id?: string | null
          period_start: string
          user_id?: string | null
          wallet?: string
          workspace_id: string
        }
        Update: {
          amount?: number
          channel_id?: string | null
          created_at?: string
          id?: string
          origin_workspace_id?: string | null
          payer_user_id?: string | null
          period_start?: string
          user_id?: string | null
          wallet?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_usage_events_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_usage_events_origin_workspace_id_fkey"
            columns: ["origin_workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_usage_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      desktop_devices: {
        Row: {
          app_version: string | null
          arch: string | null
          auth_session_id: string | null
          created_at: string
          display_name: string | null
          id: string
          install_id: string
          last_seen: string | null
          name: string
          os_version: string | null
          platform: string
          revoked_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          app_version?: string | null
          arch?: string | null
          auth_session_id?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          install_id: string
          last_seen?: string | null
          name: string
          os_version?: string | null
          platform: string
          revoked_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          app_version?: string | null
          arch?: string | null
          auth_session_id?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          install_id?: string
          last_seen?: string | null
          name?: string
          os_version?: string | null
          platform?: string
          revoked_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      glasses_device_channel_activity: {
        Row: {
          channel_id: string
          cursor_at: string
          device_id: string
          last_posted_at: string | null
          reply_cursor_seq: number
        }
        Insert: {
          channel_id: string
          cursor_at: string
          device_id: string
          last_posted_at?: string | null
          reply_cursor_seq: number
        }
        Update: {
          channel_id?: string
          cursor_at?: string
          device_id?: string
          last_posted_at?: string | null
          reply_cursor_seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "glasses_device_channel_activity_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "glasses_device_links"
            referencedColumns: ["id"]
          },
        ]
      }
      glasses_device_links: {
        Row: {
          created_at: string
          current_target_agent: string | null
          current_target_at: string | null
          current_target_channel_id: string | null
          hey_even_key_hash: string | null
          id: string
          last_seen: string | null
          linked_channel_id: string | null
          linked_container_id: string | null
          name: string
          platform: string
          reply_cursor_seq: number | null
          revoked_at: string | null
          token_hash: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          current_target_agent?: string | null
          current_target_at?: string | null
          current_target_channel_id?: string | null
          hey_even_key_hash?: string | null
          id?: string
          last_seen?: string | null
          linked_channel_id?: string | null
          linked_container_id?: string | null
          name?: string
          platform?: string
          reply_cursor_seq?: number | null
          revoked_at?: string | null
          token_hash?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          current_target_agent?: string | null
          current_target_at?: string | null
          current_target_channel_id?: string | null
          hey_even_key_hash?: string | null
          id?: string
          last_seen?: string | null
          linked_channel_id?: string | null
          linked_container_id?: string | null
          name?: string
          platform?: string
          reply_cursor_seq?: number | null
          revoked_at?: string | null
          token_hash?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "glasses_device_links_linked_channel_id_fkey"
            columns: ["linked_channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "glasses_device_links_linked_container_id_fkey"
            columns: ["linked_container_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      glasses_messages: {
        Row: {
          answer: Json | null
          card_id: string | null
          channel_message_id: string | null
          created_at: string
          expires_at: string
          id: string
          kind: string
          payload: Json
          spec: Json | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          answer?: Json | null
          card_id?: string | null
          channel_message_id?: string | null
          created_at?: string
          expires_at: string
          id?: string
          kind: string
          payload: Json
          spec?: Json | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          answer?: Json | null
          card_id?: string | null
          channel_message_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          kind?: string
          payload?: Json
          spec?: Json | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      glasses_pairings: {
        Row: {
          claimed_at: string | null
          code: string
          created_at: string
          device_id: string | null
          expires_at: string
          id: string
          poll_secret_hash: string
          status: string
          token_issued_at: string | null
        }
        Insert: {
          claimed_at?: string | null
          code: string
          created_at?: string
          device_id?: string | null
          expires_at: string
          id?: string
          poll_secret_hash: string
          status?: string
          token_issued_at?: string | null
        }
        Update: {
          claimed_at?: string | null
          code?: string
          created_at?: string
          device_id?: string | null
          expires_at?: string
          id?: string
          poll_secret_hash?: string
          status?: string
          token_issued_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "glasses_pairings_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "glasses_device_links"
            referencedColumns: ["id"]
          },
        ]
      }
      glasses_templates: {
        Row: {
          created_at: string
          name: string
          spec: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          name: string
          spec: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          name?: string
          spec?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      knowledge_base_stars: {
        Row: {
          created_at: string
          knowledge_base_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          knowledge_base_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          knowledge_base_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_base_stars_knowledge_base_id_fkey"
            columns: ["knowledge_base_id"]
            isOneToOne: false
            referencedRelation: "knowledge_bases"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_bases: {
        Row: {
          access_mode: string
          agent_write_enabled: boolean
          client_write_by: string | null
          client_write_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          id: string
          name: string
          public_id: string
          slug: string
          storage_bytes: number
          updated_at: string
          visibility: string
          workspace_id: string
        }
        Insert: {
          access_mode?: string
          agent_write_enabled?: boolean
          client_write_by?: string | null
          client_write_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          name: string
          public_id: string
          slug: string
          storage_bytes?: number
          updated_at?: string
          visibility?: string
          workspace_id: string
        }
        Update: {
          access_mode?: string
          agent_write_enabled?: boolean
          client_write_by?: string | null
          client_write_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          name?: string
          public_id?: string
          slug?: string
          storage_bytes?: number
          updated_at?: string
          visibility?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_bases_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_entries: {
        Row: {
          body: string
          client_write_by: string | null
          client_write_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          entry_type: string
          excerpt: string | null
          folder_id: string | null
          id: string
          knowledge_base_id: string
          last_edited_by: string | null
          last_edited_source: string
          position: number
          search_tsv: unknown
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          body?: string
          client_write_by?: string | null
          client_write_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          entry_type?: string
          excerpt?: string | null
          folder_id?: string | null
          id?: string
          knowledge_base_id: string
          last_edited_by?: string | null
          last_edited_source?: string
          position?: number
          search_tsv?: unknown
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          body?: string
          client_write_by?: string | null
          client_write_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          entry_type?: string
          excerpt?: string | null
          folder_id?: string | null
          id?: string
          knowledge_base_id?: string
          last_edited_by?: string | null
          last_edited_source?: string
          position?: number
          search_tsv?: unknown
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_entries_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "knowledge_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_entries_knowledge_base_id_fkey"
            columns: ["knowledge_base_id"]
            isOneToOne: false
            referencedRelation: "knowledge_bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_entries_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_entry_chunks: {
        Row: {
          chunk_index: number
          content: string
          content_hash: string
          embedding: string
          entry_id: string
          id: string
          knowledge_base_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          chunk_index: number
          content: string
          content_hash: string
          embedding: string
          entry_id: string
          id?: string
          knowledge_base_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          chunk_index?: number
          content?: string
          content_hash?: string
          embedding?: string
          entry_id?: string
          id?: string
          knowledge_base_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_entry_chunks_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "knowledge_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_entry_chunks_knowledge_base_id_fkey"
            columns: ["knowledge_base_id"]
            isOneToOne: false
            referencedRelation: "knowledge_bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_entry_chunks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_folders: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          id: string
          knowledge_base_id: string
          name: string
          parent_id: string | null
          position: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          knowledge_base_id: string
          name: string
          parent_id?: string | null
          position?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          knowledge_base_id?: string
          name?: string
          parent_id?: string | null
          position?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_folders_knowledge_base_id_fkey"
            columns: ["knowledge_base_id"]
            isOneToOne: false
            referencedRelation: "knowledge_bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "knowledge_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_folders_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_events: {
        Row: {
          api_key_id: string | null
          arguments: Json | null
          created_at: string | null
          endpoint: string
          error: string | null
          id: string
          latency_ms: number | null
          response_status: number | null
          response_summary: Json | null
          session_id: string | null
          source: string
          tool_name: string
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          api_key_id?: string | null
          arguments?: Json | null
          created_at?: string | null
          endpoint: string
          error?: string | null
          id?: string
          latency_ms?: number | null
          response_status?: number | null
          response_summary?: Json | null
          session_id?: string | null
          source?: string
          tool_name: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          api_key_id?: string | null
          arguments?: Json | null
          created_at?: string | null
          endpoint?: string
          error?: string | null
          id?: string
          latency_ms?: number | null
          response_status?: number | null
          response_summary?: Json | null
          session_id?: string | null
          source?: string
          tool_name?: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mcp_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_tokens: {
        Row: {
          access_expires_at: string
          access_token_hash: string
          client_id: string
          client_name: string | null
          container_id: string | null
          created_at: string
          device_id: string | null
          family_id: string
          id: string
          last_used_at: string | null
          refresh_expires_at: string | null
          refresh_token_hash: string | null
          revoked_at: string | null
          scopes: string[]
          subject_user_id: string | null
          user_id: string
          workspace_id: string | null
          workspace_lock_kind: string | null
        }
        Insert: {
          access_expires_at: string
          access_token_hash: string
          client_id: string
          client_name?: string | null
          container_id?: string | null
          created_at?: string
          device_id?: string | null
          family_id?: string
          id?: string
          last_used_at?: string | null
          refresh_expires_at?: string | null
          refresh_token_hash?: string | null
          revoked_at?: string | null
          scopes?: string[]
          subject_user_id?: string | null
          user_id: string
          workspace_id?: string | null
          workspace_lock_kind?: string | null
        }
        Update: {
          access_expires_at?: string
          access_token_hash?: string
          client_id?: string
          client_name?: string | null
          container_id?: string | null
          created_at?: string
          device_id?: string | null
          family_id?: string
          id?: string
          last_used_at?: string | null
          refresh_expires_at?: string | null
          refresh_token_hash?: string | null
          revoked_at?: string | null
          scopes?: string[]
          subject_user_id?: string | null
          user_id?: string
          workspace_id?: string | null
          workspace_lock_kind?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mcp_tokens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "oauth_clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "mcp_tokens_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_tokens_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "desktop_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_tokens_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_tool_calls: {
        Row: {
          created_at: string
          id: string
          is_write: boolean
          op: string
          tool: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_write?: boolean
          op?: string
          tool: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_write?: boolean
          op?: string
          tool?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_tool_calls_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_authorization_codes: {
        Row: {
          client_id: string
          code_challenge: string
          code_challenge_method: string
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          redirect_uri: string
          scopes: string[]
          user_id: string
        }
        Insert: {
          client_id: string
          code_challenge: string
          code_challenge_method?: string
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          redirect_uri: string
          scopes?: string[]
          user_id: string
        }
        Update: {
          client_id?: string
          code_challenge?: string
          code_challenge_method?: string
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          redirect_uri?: string
          scopes?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_authorization_codes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "oauth_clients"
            referencedColumns: ["client_id"]
          },
        ]
      }
      oauth_clients: {
        Row: {
          client_id: string
          client_name: string | null
          created_at: string
          grant_types: string[]
          redirect_uris: string[]
          token_endpoint_auth_method: string
        }
        Insert: {
          client_id: string
          client_name?: string | null
          created_at?: string
          grant_types?: string[]
          redirect_uris: string[]
          token_endpoint_auth_method?: string
        }
        Update: {
          client_id?: string
          client_name?: string | null
          created_at?: string
          grant_types?: string[]
          redirect_uris?: string[]
          token_endpoint_auth_method?: string
        }
        Relationships: []
      }
      ontologies: {
        Row: {
          agents_may_edit: boolean
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          last_edited_by: string | null
          last_edited_source: string
          layout: Json
          name: string
          position: number
          purpose: string
          slug: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          agents_may_edit?: boolean
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          last_edited_by?: string | null
          last_edited_source?: string
          layout?: Json
          name: string
          position?: number
          purpose?: string
          slug: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          agents_may_edit?: boolean
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          last_edited_by?: string | null
          last_edited_source?: string
          layout?: Json
          name?: string
          position?: number
          purpose?: string
          slug?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ontologies_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ontology_channel_shares: {
        Row: {
          channel_id: string
          created_at: string
          created_by: string | null
          guests_level: string
          members_level: string
          ontology_id: string
          owner_agents_level: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          channel_id: string
          created_at?: string
          created_by?: string | null
          guests_level?: string
          members_level?: string
          ontology_id: string
          owner_agents_level?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          channel_id?: string
          created_at?: string
          created_by?: string | null
          guests_level?: string
          members_level?: string
          ontology_id?: string
          owner_agents_level?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ontology_channel_shares_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ontology_channel_shares_ontology_id_fkey"
            columns: ["ontology_id"]
            isOneToOne: false
            referencedRelation: "ontologies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ontology_channel_shares_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ontology_memberships: {
        Row: {
          child_object_id: string
          created_at: string
          id: string
          ontology_id: string | null
          parent_object_id: string | null
          position: number
          workspace_id: string
        }
        Insert: {
          child_object_id: string
          created_at?: string
          id?: string
          ontology_id?: string | null
          parent_object_id?: string | null
          position?: number
          workspace_id: string
        }
        Update: {
          child_object_id?: string
          created_at?: string
          id?: string
          ontology_id?: string | null
          parent_object_id?: string | null
          position?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ontology_memberships_child_object_id_fkey"
            columns: ["child_object_id"]
            isOneToOne: false
            referencedRelation: "ontology_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ontology_memberships_ontology_id_fkey"
            columns: ["ontology_id"]
            isOneToOne: false
            referencedRelation: "ontologies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ontology_memberships_parent_object_id_fkey"
            columns: ["parent_object_id"]
            isOneToOne: false
            referencedRelation: "ontology_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ontology_memberships_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ontology_objects: {
        Row: {
          attributes: Json
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          last_edited_by: string | null
          last_edited_source: string
          methods: Json
          name: string
          subtitle: string
          template: Json
          updated_at: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          attributes?: Json
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          last_edited_by?: string | null
          last_edited_source?: string
          methods?: Json
          name: string
          subtitle?: string
          template?: Json
          updated_at?: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          attributes?: Json
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          last_edited_by?: string | null
          last_edited_source?: string
          methods?: Json
          name?: string
          subtitle?: string
          template?: Json
          updated_at?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ontology_objects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ontology_relationships: {
        Row: {
          created_at: string
          id: string
          label: string
          position: number
          source_object_id: string
          target_object_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          position?: number
          source_object_id: string
          target_object_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          position?: number
          source_object_id?: string
          target_object_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ontology_relationships_source_object_id_fkey"
            columns: ["source_object_id"]
            isOneToOne: false
            referencedRelation: "ontology_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ontology_relationships_target_object_id_fkey"
            columns: ["target_object_id"]
            isOneToOne: false
            referencedRelation: "ontology_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ontology_relationships_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string | null
          display_name: string | null
          email: string | null
          github_username: string | null
          id: string
          mcp_connected_at: string | null
          onboarded_at: string | null
          reactivation_email_sent_at: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_period_end: string | null
          subscription_status: string | null
          subscription_tier: string | null
          trial_expires_at: string | null
          trial_started_at: string | null
          twitter_handle: string | null
          updated_at: string | null
          website_url: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          display_name?: string | null
          email?: string | null
          github_username?: string | null
          id: string
          mcp_connected_at?: string | null
          onboarded_at?: string | null
          reactivation_email_sent_at?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_period_end?: string | null
          subscription_status?: string | null
          subscription_tier?: string | null
          trial_expires_at?: string | null
          trial_started_at?: string | null
          twitter_handle?: string | null
          updated_at?: string | null
          website_url?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          display_name?: string | null
          email?: string | null
          github_username?: string | null
          id?: string
          mcp_connected_at?: string | null
          onboarded_at?: string | null
          reactivation_email_sent_at?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_period_end?: string | null
          subscription_status?: string | null
          subscription_tier?: string | null
          trial_expires_at?: string | null
          trial_started_at?: string | null
          twitter_handle?: string | null
          updated_at?: string | null
          website_url?: string | null
        }
        Relationships: []
      }
      rate_limit_events: {
        Row: {
          endpoint: string | null
          id: string
          requested_at: string
          subject: string
        }
        Insert: {
          endpoint?: string | null
          id?: string
          requested_at?: string
          subject: string
        }
        Update: {
          endpoint?: string | null
          id?: string
          requested_at?: string
          subject?: string
        }
        Relationships: []
      }
      resource_grants: {
        Row: {
          created_at: string
          created_by: string | null
          guest_write: boolean
          level: string
          resource_id: string
          resource_type: string
          scope_id: string
          scope_type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          guest_write?: boolean
          level: string
          resource_id: string
          resource_type: string
          scope_id: string
          scope_type: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          guest_write?: boolean
          level?: string
          resource_id?: string
          resource_type?: string
          scope_id?: string
          scope_type?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_grants_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      revisions: {
        Row: {
          actor_kind: string
          actor_user_id: string | null
          agent_session_id: string | null
          content_hash: string
          created_at: string
          id: string
          op: string
          payload: Json
          resource_id: string
          resource_type: string
          summary: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          actor_kind: string
          actor_user_id?: string | null
          agent_session_id?: string | null
          content_hash: string
          created_at?: string
          id?: string
          op: string
          payload?: Json
          resource_id: string
          resource_type: string
          summary?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          actor_kind?: string
          actor_user_id?: string | null
          agent_session_id?: string | null
          content_hash?: string
          created_at?: string
          id?: string
          op?: string
          payload?: Json
          resource_id?: string
          resource_type?: string
          summary?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "revisions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      skill_events: {
        Row: {
          author_id: string | null
          created_at: string
          detail: Json
          id: string
          skill_id: string
          source: string
          type: string
          workspace_id: string
        }
        Insert: {
          author_id?: string | null
          created_at?: string
          detail?: Json
          id?: string
          skill_id: string
          source: string
          type: string
          workspace_id: string
        }
        Update: {
          author_id?: string | null
          created_at?: string
          detail?: Json
          id?: string
          skill_id?: string
          source?: string
          type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "skill_events_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skill_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      skill_versions: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          skill_id: string
          source: string
          workspace_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          skill_id: string
          source: string
          workspace_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          skill_id?: string
          source?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "skill_versions_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skill_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      skills: {
        Row: {
          access_mode: string
          agent_write_enabled: boolean
          body: string
          body_edited_by: string | null
          body_edited_source: string
          body_updated_at: string
          connectors: Json
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string
          folder: string | null
          id: string
          last_edited_by: string | null
          last_edited_source: string
          name: string
          public_id: string
          slug: string
          status: string
          updated_at: string
          visibility: string
          when_not_to_use: string | null
          when_to_use: string
          workspace_id: string
        }
        Insert: {
          access_mode?: string
          agent_write_enabled?: boolean
          body?: string
          body_edited_by?: string | null
          body_edited_source?: string
          body_updated_at?: string
          connectors?: Json
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description: string
          folder?: string | null
          id?: string
          last_edited_by?: string | null
          last_edited_source?: string
          name: string
          public_id: string
          slug: string
          status?: string
          updated_at?: string
          visibility?: string
          when_not_to_use?: string | null
          when_to_use: string
          workspace_id: string
        }
        Update: {
          access_mode?: string
          agent_write_enabled?: boolean
          body?: string
          body_edited_by?: string | null
          body_edited_source?: string
          body_updated_at?: string
          connectors?: Json
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string
          folder?: string | null
          id?: string
          last_edited_by?: string | null
          last_edited_source?: string
          name?: string
          public_id?: string
          slug?: string
          status?: string
          updated_at?: string
          visibility?: string
          when_not_to_use?: string | null
          when_to_use?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "skills_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      system_events: {
        Row: {
          category: string
          created_at: string | null
          fingerprint: string
          id: string
          message: string
          metadata: Json | null
          severity: string
          source: string
          user_id: string | null
        }
        Insert: {
          category: string
          created_at?: string | null
          fingerprint: string
          id?: string
          message: string
          metadata?: Json | null
          severity: string
          source: string
          user_id?: string | null
        }
        Update: {
          category?: string
          created_at?: string | null
          fingerprint?: string
          id?: string
          message?: string
          metadata?: Json | null
          severity?: string
          source?: string
          user_id?: string | null
        }
        Relationships: []
      }
      team_members: {
        Row: {
          added_at: string
          added_by: string | null
          team_id: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          team_id: string
          user_id: string
          workspace_id: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          team_id?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          color: string | null
          created_at: string
          created_by: string | null
          description: string | null
          icon: string | null
          id: string
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_credit_usage: {
        Row: {
          period_start: string
          updated_at: string
          used: number
          user_id: string
        }
        Insert: {
          period_start: string
          updated_at?: string
          used?: number
          user_id: string
        }
        Update: {
          period_start?: string
          updated_at?: string
          used?: number
          user_id?: string
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          completed_at: string | null
          event_id: string
          event_type: string
          last_error: string | null
          processed: boolean
          processed_at: string | null
        }
        Insert: {
          completed_at?: string | null
          event_id: string
          event_type: string
          last_error?: string | null
          processed?: boolean
          processed_at?: string | null
        }
        Update: {
          completed_at?: string | null
          event_id?: string
          event_type?: string
          last_error?: string | null
          processed?: boolean
          processed_at?: string | null
        }
        Relationships: []
      }
      workspace_activity_events: {
        Row: {
          actor_user_id: string
          created_at: string
          id: string
          metadata: Json
          resource_id: string | null
          resource_type: string | null
          verb: string
          workspace_id: string
        }
        Insert: {
          actor_user_id: string
          created_at?: string
          id?: string
          metadata?: Json
          resource_id?: string | null
          resource_type?: string | null
          verb: string
          workspace_id: string
        }
        Update: {
          actor_user_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          resource_id?: string | null
          resource_type?: string | null
          verb?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_activity_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_billing: {
        Row: {
          cancel_at_period_end: boolean
          checkout_claim_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          last_stripe_event_created: number | null
          plan: string
          seat_count: number | null
          status: string
          stripe_customer_id: string | null
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          checkout_claim_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          last_stripe_event_created?: number | null
          plan?: string
          seat_count?: number | null
          status?: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          checkout_claim_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          last_stripe_event_created?: number | null
          plan?: string
          seat_count?: number | null
          status?: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_billing_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_credit_usage: {
        Row: {
          period_start: string
          updated_at: string
          used: number
          workspace_id: string
        }
        Insert: {
          period_start: string
          updated_at?: string
          used?: number
          workspace_id: string
        }
        Update: {
          period_start?: string
          updated_at?: string
          used?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_credit_usage_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_invitation_teams: {
        Row: {
          invitation_id: string
          team_id: string
        }
        Insert: {
          invitation_id: string
          team_id: string
        }
        Update: {
          invitation_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invitation_teams_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: false
            referencedRelation: "workspace_invitations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_invitation_teams_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          invited_role: string
          revoked_at: string | null
          token: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by: string
          invited_role: string
          revoked_at?: string | null
          token: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          invited_role?: string
          revoked_at?: string | null
          token?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invitations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_join_links: {
        Row: {
          created_at: string
          created_by: string | null
          rotated_at: string | null
          token: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          rotated_at?: string | null
          token: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          rotated_at?: string | null
          token?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_join_links_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_join_requests: {
        Row: {
          id: string
          pending_acknowledged_at: string | null
          requested_at: string
          resolved_acknowledged_at: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          id?: string
          pending_acknowledged_at?: string | null
          requested_at?: string
          resolved_acknowledged_at?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          id?: string
          pending_acknowledged_at?: string | null
          requested_at?: string
          resolved_acknowledged_at?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_join_requests_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_member_credit_usage: {
        Row: {
          period_start: string
          updated_at: string
          used: number
          user_id: string
          workspace_id: string
        }
        Insert: {
          period_start: string
          updated_at?: string
          used?: number
          user_id: string
          workspace_id: string
        }
        Update: {
          period_start?: string
          updated_at?: string
          used?: number
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_member_credit_usage_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          id: string
          invited_at: string | null
          invited_by: string | null
          joined_at: string
          last_seen_at: string | null
          role: string
          status: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          joined_at?: string
          last_seen_at?: string | null
          role: string
          status?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          joined_at?: string
          last_seen_at?: string | null
          role?: string
          status?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_token_spend: {
        Row: {
          agent_name: string | null
          channel_id: string | null
          first_seen_at: string
          session_key: string
          started_at: string
          tokens: number
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          agent_name?: string | null
          channel_id?: string | null
          first_seen_at?: string
          session_key: string
          started_at: string
          tokens?: number
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          agent_name?: string | null
          channel_id?: string | null
          first_seen_at?: string
          session_key?: string
          started_at?: string
          tokens?: number
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_token_spend_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_token_spend_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          description: string | null
          icon_url: string | null
          id: string
          kind: string
          name: string
          owner_id: string
          public_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          icon_url?: string | null
          id?: string
          kind?: string
          name: string
          owner_id: string
          public_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          icon_url?: string | null
          id?: string
          kind?: string
          name?: string
          owner_id?: string
          public_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      channel_tasks_activity: {
        Row: {
          channel_id: string | null
          client_msg_id: string | null
          closed_at: string | null
          created_at: string | null
          created_by: string | null
          id: string | null
          last_activity_at: string | null
          mode: string | null
          outcome: string | null
          outcome_summary: string | null
          status: string | null
          target_user_id: string | null
          title: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "channel_tasks_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      can_current_user_read_agent_identity: {
        Args: { p_identity_id: string }
        Returns: boolean
      }
      cascade_hard_delete_folder: {
        Args: { p_folder_id: string; p_workspace_id: string }
        Returns: number
      }
      cascade_hard_delete_object: {
        Args: { p_object_id: string; p_workspace_id: string }
        Returns: number
      }
      cascade_hard_delete_ontology: {
        Args: { p_ontology_id: string; p_workspace_id: string }
        Returns: number
      }
      channel_artifact_spans: {
        Args: { p_artifact_ids: string[]; p_channel_id: string }
        Returns: {
          artifact_id: string
          count: number
          first_seq: number
          last_seq: number
        }[]
      }
      channel_message_insert: {
        Args: {
          p_author_kind: string
          p_author_user_id: string
          p_body: string
          p_channel_id: string
          p_client_msg_id: string
          p_delivery?: string
          p_kind: string
          p_metadata: Json
          p_recipient_agent_ids?: string[]
          p_recipient_user_ids?: string[]
          p_wake_verdict?: string
          p_workspace_id: string
        }
        Returns: {
          artifact_id: string | null
          author_kind: string
          author_user_id: string | null
          body: string
          channel_id: string
          client_msg_id: string | null
          created_at: string
          delivery: string | null
          delivery_at: string | null
          id: string
          kind: string
          metadata: Json
          recipient_agent_ids: string[] | null
          recipient_user_ids: string[] | null
          search_tsv: unknown
          seq: number
          wake_verdict: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "channel_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      channel_tasks_stale: {
        Args: { p_before: string; p_limit: number }
        Returns: {
          anchor_seq: number
          channel_id: string
          id: string
          last_activity_at: string
          title: string
          workspace_id: string
        }[]
      }
      channels_last_message: {
        Args: { p_channel_ids: string[] }
        Returns: {
          channel_id: string
          last_at: string
          last_seq: number
        }[]
      }
      chat_append_messages: {
        Args: { p_chat_id: string; p_messages: Json; p_workspace_id: string }
        Returns: number
      }
      chat_create_with_messages: {
        Args: { p_chat: Json; p_messages: Json }
        Returns: {
          access_mode: string
          client_session_id: string | null
          created_at: string
          deleted_at: string | null
          deliverables: Json
          exported_at: string
          folder_id: string | null
          format: string
          id: string
          learnings: Json
          overview: string
          owner_id: string
          pinned: boolean
          project: string | null
          session_date: string
          source: string
          title: string
          updated_at: string
          visibility: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "chats"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chats_retention_cutoff: {
        Args: { p_window_days: number }
        Returns: string
      }
      check_and_record_rate_limit_subject: {
        Args: { p_endpoint: string; p_rpm: number; p_subject: string }
        Returns: boolean
      }
      claim_workspace_checkout: {
        Args: { p_workspace_id: string }
        Returns: boolean
      }
      cleanup_system_events: { Args: never; Returns: number }
      consume_channel_link: {
        Args: { p_link_id: string }
        Returns: {
          use_count: number
        }[]
      }
      consume_member_credits: {
        Args: {
          p_amount: number
          p_caller_user_id: string
          p_channel_id: string
          p_limit: number
          p_origin_workspace_id: string
          p_period_start: string
          p_user_id: string
          p_workspace_id: string
        }
        Returns: {
          allowed: boolean
          used: number
        }[]
      }
      consume_user_credits: {
        Args: {
          p_amount: number
          p_caller_user_id: string
          p_channel_id: string
          p_limit: number
          p_origin_workspace_id: string
          p_period_start: string
          p_user_id: string
        }
        Returns: {
          allowed: boolean
          used: number
        }[]
      }
      consume_workspace_credits: {
        Args: {
          p_amount: number
          p_limit: number
          p_period_start: string
          p_workspace_id: string
        }
        Returns: {
          allowed: boolean
          used: number
        }[]
      }
      credit_ledger_sum: {
        Args: {
          p_payer_user_id: string
          p_period_start: string
          p_wallet: string
        }
        Returns: number
      }
      dopl_can_see_visibility: {
        Args: { p_created_by: string; p_visibility: string }
        Returns: boolean
      }
      dopl_channel_scope_allowed: {
        Args: { p_channel_id: string }
        Returns: boolean
      }
      dopl_chat_readable: { Args: { p_chat_id: string }; Returns: boolean }
      dopl_credential_is_shared: { Args: never; Returns: boolean }
      dopl_grant_admits: {
        Args: { p_resource_id: string; p_resource_type: string }
        Returns: boolean
      }
      dopl_knowledge_base_readable: {
        Args: { p_base_id: string }
        Returns: boolean
      }
      dopl_ontology_level_rank: { Args: { p_level: string }; Returns: number }
      dopl_ontology_object_ontologies: {
        Args: { p_object_id: string }
        Returns: string[]
      }
      dopl_ontology_readable: {
        Args: { p_ontology_id: string }
        Returns: boolean
      }
      dopl_ontology_share_level: {
        Args: { p_ontology_id: string }
        Returns: string
      }
      dopl_ontology_writable: {
        Args: { p_ontology_id: string }
        Returns: boolean
      }
      dopl_public_teams_admits: {
        Args: {
          p_access_mode: string
          p_owner: string
          p_resource_id: string
          p_resource_type: string
          p_visibility: string
          p_workspace_id: string
        }
        Returns: boolean
      }
      dopl_revision_readable: {
        Args: { p_resource_id: string; p_resource_type: string }
        Returns: boolean
      }
      dopl_skill_readable: { Args: { p_skill_id: string }; Returns: boolean }
      dopl_teams_mode_visible: {
        Args: {
          p_created_by: string
          p_resource_id: string
          p_resource_type: string
          p_workspace_id: string
        }
        Returns: boolean
      }
      dopl_teams_visible_for_user: {
        Args: {
          p_created_by: string
          p_resource_id: string
          p_resource_type: string
          p_user_id: string
          p_workspace_id: string
        }
        Returns: boolean
      }
      dopl_user_may_share_resource: {
        Args: {
          p_resource_id: string
          p_resource_type: string
          p_user_id: string
        }
        Returns: boolean
      }
      end_auth_session: {
        Args: { p_session_id: string; p_user_id: string }
        Returns: boolean
      }
      ensure_home_space: {
        Args: { p_owner_id: string; p_public_id: string }
        Returns: {
          created: boolean
          created_at: string
          description: string
          icon_url: string
          id: string
          kind: string
          name: string
          owner_id: string
          public_id: string
          slug: string
          updated_at: string
        }[]
      }
      home_space_origin_of: { Args: { p_owner_id: string }; Returns: string }
      is_channel_member: { Args: { p_channel_id: string }; Returns: boolean }
      is_current_workspace_member: {
        Args: { p_min_role?: string; p_workspace_id: string }
        Returns: boolean
      }
      is_workspace_member: {
        Args: { p_min_role?: string; p_user_id: string; p_workspace_id: string }
        Returns: boolean
      }
      merge_channel_message_display: {
        Args: { p_author_user_id: string; p_message_id: string; p_patch: Json }
        Returns: boolean
      }
      presence_heartbeat_all: {
        Args: { p_status: string; p_user_id: string }
        Returns: {
          last_seen_at: string
          workspace_id: string
        }[]
      }
      record_token_spend: {
        Args: { p_marks: Json; p_user_id: string; p_workspace_id: string }
        Returns: number
      }
      replace_channel_message_display: {
        Args: {
          p_author_user_id: string
          p_body: string
          p_display: Json
          p_escalation: Json
          p_message_id: string
        }
        Returns: boolean
      }
      search_knowledge_entries: {
        Args: {
          p_base_id?: string
          p_limit?: number
          p_query: string
          p_workspace_id: string
        }
        Returns: {
          entry_id: string
          excerpt: string
          folder_id: string
          knowledge_base_id: string
          rank: number
          snippet: string
          title: string
          updated_at: string
        }[]
      }
      search_knowledge_hybrid: {
        Args: {
          p_base_id?: string
          p_embedding: string
          p_limit?: number
          p_query: string
          p_workspace_id: string
        }
        Returns: {
          entry_id: string
          excerpt: string
          folder_id: string
          knowledge_base_id: string
          rank: number
          snippet: string
          title: string
          updated_at: string
        }[]
      }
      stamp_channel_message_display_answer: {
        Args: { p_answer: Json; p_message_id: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
