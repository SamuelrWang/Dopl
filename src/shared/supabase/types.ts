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
      agent_trust_rules: {
        Row: {
          created_at: string
          id: string
          operator_user_id: string
          trusted_user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          operator_user_id: string
          trusted_user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          operator_user_id?: string
          trusted_user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_trust_rules_workspace_id_fkey"
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
          engaged_at: string | null
          engaged_by: string | null
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
          engaged_at?: string | null
          engaged_by?: string | null
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
          engaged_at?: string | null
          engaged_by?: string | null
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
      channel_members: {
        Row: {
          added_by: string | null
          agent_tool_profile: string
          channel_id: string
          joined_at: string
          last_read_at: string | null
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          added_by?: string | null
          agent_tool_profile?: string
          channel_id: string
          joined_at?: string
          last_read_at?: string | null
          role?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          added_by?: string | null
          agent_tool_profile?: string
          channel_id?: string
          joined_at?: string
          last_read_at?: string | null
          role?: string
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
          author_kind: string
          author_user_id: string | null
          body: string
          channel_id: string
          client_msg_id: string | null
          created_at: string
          id: string
          kind: string
          metadata: Json
          seq: number
          workspace_id: string
        }
        Insert: {
          author_kind?: string
          author_user_id?: string | null
          body?: string
          channel_id: string
          client_msg_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          metadata?: Json
          seq?: never
          workspace_id: string
        }
        Update: {
          author_kind?: string
          author_user_id?: string | null
          body?: string
          channel_id?: string
          client_msg_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          metadata?: Json
          seq?: never
          workspace_id?: string
        }
        Relationships: [
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
          created_at: string
          id: string
          name: string
          session_key: string
          state: string
          task_id: string | null
          thread_title: string | null
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          channel_id: string
          channel_name?: string | null
          created_at?: string
          id?: string
          name: string
          session_key: string
          state: string
          task_id?: string | null
          thread_title?: string | null
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          channel_id?: string
          channel_name?: string | null
          created_at?: string
          id?: string
          name?: string
          session_key?: string
          state?: string
          task_id?: string | null
          thread_title?: string | null
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
            foreignKeyName: "channel_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_task_participants: {
        Row: {
          added_by: string | null
          agent_id: string | null
          created_at: string
          id: string
          kind: string
          task_id: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          added_by?: string | null
          agent_id?: string | null
          created_at?: string
          id?: string
          kind: string
          task_id: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          added_by?: string | null
          agent_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          task_id?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_task_participants_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "channel_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_task_participants_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "channel_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_task_participants_workspace_id_fkey"
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
          archived_at: string | null
          created_at: string
          created_by: string
          deleted_at: string | null
          direct_key: string | null
          id: string
          is_direct: boolean
          name: string
          slug: string
          topic: string
          updated_at: string
          visibility: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by: string
          deleted_at?: string | null
          direct_key?: string | null
          id?: string
          is_direct?: boolean
          name: string
          slug: string
          topic?: string
          updated_at?: string
          visibility?: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          direct_key?: string | null
          id?: string
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
      knowledge_bases: {
        Row: {
          access_mode: string
          agent_write_enabled: boolean
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          id: string
          name: string
          public_id: string
          slug: string
          updated_at: string
          visibility: string
          workspace_id: string
        }
        Insert: {
          access_mode?: string
          agent_write_enabled?: boolean
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          name: string
          public_id: string
          slug: string
          updated_at?: string
          visibility?: string
          workspace_id: string
        }
        Update: {
          access_mode?: string
          agent_write_enabled?: boolean
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          name?: string
          public_id?: string
          slug?: string
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
          created_at: string
          family_id: string
          id: string
          last_used_at: string | null
          refresh_expires_at: string | null
          refresh_token_hash: string | null
          revoked_at: string | null
          scopes: string[]
          user_id: string
        }
        Insert: {
          access_expires_at: string
          access_token_hash: string
          client_id: string
          client_name?: string | null
          created_at?: string
          family_id?: string
          id?: string
          last_used_at?: string | null
          refresh_expires_at?: string | null
          refresh_token_hash?: string | null
          revoked_at?: string | null
          scopes?: string[]
          user_id: string
        }
        Update: {
          access_expires_at?: string
          access_token_hash?: string
          client_id?: string
          client_name?: string | null
          created_at?: string
          family_id?: string
          id?: string
          last_used_at?: string | null
          refresh_expires_at?: string | null
          refresh_token_hash?: string | null
          revoked_at?: string | null
          scopes?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_tokens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "oauth_clients"
            referencedColumns: ["client_id"]
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
      ontology_clusters: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          layout: Json
          name: string
          position: number
          purpose: string
          slug: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          layout?: Json
          name: string
          position?: number
          purpose?: string
          slug: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
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
            foreignKeyName: "ontology_clusters_workspace_id_fkey"
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
          cluster_id: string | null
          created_at: string
          id: string
          parent_object_id: string | null
          position: number
          workspace_id: string
        }
        Insert: {
          child_object_id: string
          cluster_id?: string | null
          created_at?: string
          id?: string
          parent_object_id?: string | null
          position?: number
          workspace_id: string
        }
        Update: {
          child_object_id?: string
          cluster_id?: string | null
          created_at?: string
          id?: string
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
            foreignKeyName: "ontology_memberships_cluster_id_fkey"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "ontology_clusters"
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
          ingestion_count: number | null
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
          ingestion_count?: number | null
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
          ingestion_count?: number | null
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
      team_resource_access: {
        Row: {
          level: string
          resource_id: string
          resource_type: string
          team_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          level: string
          resource_id: string
          resource_type: string
          team_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          level?: string
          resource_id?: string
          resource_type?: string
          team_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_resource_access_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_resource_access_workspace_id_fkey"
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
      user_preferences: {
        Row: {
          id: string
          key: string
          updated_at: string | null
          user_id: string
          value: Json
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string | null
          user_id: string
          value?: Json
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string | null
          user_id?: string
          value?: Json
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
      workspace_billing: {
        Row: {
          checkout_claim_at: string | null
          created_at: string
          current_period_end: string | null
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
          checkout_claim_at?: string | null
          created_at?: string
          current_period_end?: string | null
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
          checkout_claim_at?: string | null
          created_at?: string
          current_period_end?: string | null
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
      workspaces: {
        Row: {
          created_at: string
          description: string | null
          icon_url: string | null
          id: string
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
        Relationships: []
      }
    }
    Functions: {
      cascade_hard_delete_cluster: {
        Args: { p_cluster_id: string; p_workspace_id: string }
        Returns: number
      }
      cascade_hard_delete_folder: {
        Args: { p_folder_id: string; p_workspace_id: string }
        Returns: number
      }
      cascade_hard_delete_object: {
        Args: { p_object_id: string; p_workspace_id: string }
        Returns: number
      }
      cascade_purge_cluster: {
        Args: { p_cluster_ref: string; p_workspace_id: string }
        Returns: number
      }
      cascade_restore_base: { Args: { p_base_id: string }; Returns: undefined }
      cascade_restore_cluster: {
        Args: { p_cluster_ref: string; p_workspace_id: string }
        Returns: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          layout: Json
          name: string
          position: number
          purpose: string
          slug: string
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "ontology_clusters"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cascade_restore_folder: {
        Args: { p_folder_id: string }
        Returns: undefined
      }
      cascade_soft_delete_base: {
        Args: { p_base_id: string; p_deleted_at: string }
        Returns: undefined
      }
      cascade_soft_delete_cluster: {
        Args: { p_cluster_id: string; p_workspace_id: string }
        Returns: number
      }
      cascade_soft_delete_folder: {
        Args: { p_deleted_at: string; p_folder_id: string }
        Returns: undefined
      }
      channel_message_insert: {
        Args: {
          p_author_kind: string
          p_author_user_id: string
          p_body: string
          p_channel_id: string
          p_client_msg_id: string
          p_kind: string
          p_metadata: Json
          p_workspace_id: string
        }
        Returns: {
          author_kind: string
          author_user_id: string | null
          body: string
          channel_id: string
          client_msg_id: string | null
          created_at: string
          id: string
          kind: string
          metadata: Json
          seq: number
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
      chat_replace_messages: {
        Args: { p_chat_id: string; p_messages: Json; p_workspace_id: string }
        Returns: number
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
      ensure_default_workspace: {
        Args: {
          p_name: string
          p_owner_id: string
          p_public_id: string
          p_slug: string
        }
        Returns: {
          created: boolean
          created_at: string
          description: string
          icon_url: string
          id: string
          name: string
          owner_id: string
          public_id: string
          slug: string
          updated_at: string
        }[]
      }
      increment_fork_count: { Args: { pc_id: string }; Returns: undefined }
      increment_ingestion_count: {
        Args: { user_id_input: string }
        Returns: undefined
      }
      is_channel_member: { Args: { p_channel_id: string }; Returns: boolean }
      is_current_workspace_member: {
        Args: { p_min_role?: string; p_workspace_id: string }
        Returns: boolean
      }
      is_workspace_member: {
        Args: { p_min_role?: string; p_user_id: string; p_workspace_id: string }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
