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
  public: {
    Tables: {
      api_key_usage: {
        Row: {
          api_key_id: string | null
          endpoint: string
          id: string
          requested_at: string | null
        }
        Insert: {
          api_key_id?: string | null
          endpoint: string
          id?: string
          requested_at?: string | null
        }
        Update: {
          api_key_id?: string | null
          endpoint?: string
          id?: string
          requested_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_key_usage_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          rate_limit_rpm: number | null
          revoked_at: string | null
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          rate_limit_rpm?: number | null
          revoked_at?: string | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          rate_limit_rpm?: number | null
          revoked_at?: string | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      canvas_panels: {
        Row: {
          added_at: string | null
          entry_id: string | null
          height: number | null
          id: string
          panel_data: Json
          panel_id: string
          panel_type: string
          source_url: string | null
          summary: string | null
          title: string | null
          user_id: string
          width: number | null
          workspace_id: string
          x: number | null
          y: number | null
        }
        Insert: {
          added_at?: string | null
          entry_id?: string | null
          height?: number | null
          id?: string
          panel_data?: Json
          panel_id: string
          panel_type?: string
          source_url?: string | null
          summary?: string | null
          title?: string | null
          user_id: string
          width?: number | null
          workspace_id: string
          x?: number | null
          y?: number | null
        }
        Update: {
          added_at?: string | null
          entry_id?: string | null
          height?: number | null
          id?: string
          panel_data?: Json
          panel_id?: string
          panel_type?: string
          source_url?: string | null
          summary?: string | null
          title?: string | null
          user_id?: string
          width?: number | null
          workspace_id?: string
          x?: number | null
          y?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "canvas_panels_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "canvas_panels_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      canvas_state: {
        Row: {
          camera_x: number
          camera_y: number
          camera_zoom: number
          clusters: Json
          id: string
          next_cluster_id: number
          next_panel_id: number
          sidebar_open: boolean
          updated_at: string | null
          user_id: string
          version: number
          workspace_id: string
        }
        Insert: {
          camera_x?: number
          camera_y?: number
          camera_zoom?: number
          clusters?: Json
          id?: string
          next_cluster_id?: number
          next_panel_id?: number
          sidebar_open?: boolean
          updated_at?: string | null
          user_id: string
          version?: number
          workspace_id: string
        }
        Update: {
          camera_x?: number
          camera_y?: number
          camera_zoom?: number
          clusters?: Json
          id?: string
          next_cluster_id?: number
          next_panel_id?: number
          sidebar_open?: boolean
          updated_at?: string | null
          user_id?: string
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "canvas_state_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      canvases: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "canvases_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_attachments: {
        Row: {
          created_at: string | null
          file_name: string
          file_size: number
          id: string
          mime_type: string
          panel_id: string
          storage_path: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          file_name: string
          file_size: number
          id?: string
          mime_type: string
          panel_id: string
          storage_path: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          file_name?: string
          file_size?: number
          id?: string
          mime_type?: string
          panel_id?: string
          storage_path?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_attachments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      chunks: {
        Row: {
          chunk_index: number | null
          chunk_type: string | null
          content: string
          created_at: string | null
          embedding: string | null
          entry_id: string | null
          id: string
        }
        Insert: {
          chunk_index?: number | null
          chunk_type?: string | null
          content: string
          created_at?: string | null
          embedding?: string | null
          entry_id?: string | null
          id?: string
        }
        Update: {
          chunk_index?: number | null
          chunk_type?: string | null
          content?: string
          created_at?: string | null
          embedding?: string | null
          entry_id?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chunks_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
        ]
      }
      cluster_brain_memories: {
        Row: {
          author_id: string
          cluster_brain_id: string
          cluster_id: string
          content: string
          created_at: string
          id: string
          scope: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          author_id: string
          cluster_brain_id: string
          cluster_id: string
          content: string
          created_at?: string
          id?: string
          scope?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          author_id?: string
          cluster_brain_id?: string
          cluster_id?: string
          content?: string
          created_at?: string
          id?: string
          scope?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cluster_brain_memories_cluster_brain_id_fkey"
            columns: ["cluster_brain_id"]
            isOneToOne: false
            referencedRelation: "cluster_brains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cluster_brain_memories_cluster_id_fkey"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "clusters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cluster_brain_memories_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cluster_brains: {
        Row: {
          brain_version: number
          cluster_id: string
          created_at: string
          id: string
          instructions: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          brain_version?: number
          cluster_id: string
          created_at?: string
          id?: string
          instructions?: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          brain_version?: number
          cluster_id?: string
          created_at?: string
          id?: string
          instructions?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cluster_brains_cluster_id_fkey"
            columns: ["cluster_id"]
            isOneToOne: true
            referencedRelation: "clusters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cluster_brains_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cluster_forks: {
        Row: {
          created_at: string | null
          created_cluster_id: string | null
          forked_by_user_id: string
          id: string
          source_published_cluster_id: string
        }
        Insert: {
          created_at?: string | null
          created_cluster_id?: string | null
          forked_by_user_id: string
          id?: string
          source_published_cluster_id: string
        }
        Update: {
          created_at?: string | null
          created_cluster_id?: string | null
          forked_by_user_id?: string
          id?: string
          source_published_cluster_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cluster_forks_created_cluster_id_fkey"
            columns: ["created_cluster_id"]
            isOneToOne: false
            referencedRelation: "clusters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cluster_forks_source_published_cluster_id_fkey"
            columns: ["source_published_cluster_id"]
            isOneToOne: false
            referencedRelation: "published_clusters"
            referencedColumns: ["id"]
          },
        ]
      }
      cluster_panels: {
        Row: {
          added_at: string | null
          cluster_id: string
          entry_id: string
        }
        Insert: {
          added_at?: string | null
          cluster_id: string
          entry_id: string
        }
        Update: {
          added_at?: string | null
          cluster_id?: string
          entry_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cluster_panels_cluster_id_fkey"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "clusters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cluster_panels_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
        ]
      }
      clusters: {
        Row: {
          created_at: string | null
          forked_from_slug: string | null
          forked_from_title: string | null
          id: string
          name: string
          slug: string
          updated_at: string | null
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          forked_from_slug?: string | null
          forked_from_title?: string | null
          id?: string
          name: string
          slug: string
          updated_at?: string | null
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          forked_from_slug?: string | null
          forked_from_title?: string | null
          id?: string
          name?: string
          slug?: string
          updated_at?: string | null
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clusters_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string | null
          expires_at: string
          id: string
          messages: Json
          panel_id: string
          pinned: boolean
          title: string
          updated_at: string | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at?: string
          id?: string
          messages?: Json
          panel_id: string
          pinned?: boolean
          title?: string
          updated_at?: string | null
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          id?: string
          messages?: Json
          panel_id?: string
          pinned?: boolean
          title?: string
          updated_at?: string | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_workspace_id_fkey"
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
      credit_ledger: {
        Row: {
          action: string
          amount: number
          created_at: string | null
          id: string
          metadata: Json | null
          user_id: string
        }
        Insert: {
          action: string
          amount: number
          created_at?: string | null
          id?: string
          metadata?: Json | null
          user_id: string
        }
        Update: {
          action?: string
          amount?: number
          created_at?: string | null
          id?: string
          metadata?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      entries: {
        Row: {
          agents_md: string | null
          canonical_score: number | null
          chunks_attempted: number | null
          chunks_embedded: number | null
          complexity: string | null
          content_type: string | null
          created_at: string | null
          descriptor: string | null
          descriptor_prompt_version: string | null
          github_sha: string | null
          id: string
          ingested_at: string | null
          ingested_by: string | null
          ingestion_tier: Database["public"]["Enums"]["ingestion_tier"]
          manifest: Json | null
          moderated_at: string | null
          moderated_by: string | null
          moderation_status: string
          raw_content: Json | null
          readme: string | null
          slug: string
          source_author: string | null
          source_date: string | null
          source_platform: string | null
          source_url: string
          status: string | null
          summary: string | null
          thumbnail_url: string | null
          title: string | null
          updated_at: string | null
          use_case: string | null
          writeback_at: string | null
          writeback_by: string | null
        }
        Insert: {
          agents_md?: string | null
          canonical_score?: number | null
          chunks_attempted?: number | null
          chunks_embedded?: number | null
          complexity?: string | null
          content_type?: string | null
          created_at?: string | null
          descriptor?: string | null
          descriptor_prompt_version?: string | null
          github_sha?: string | null
          id?: string
          ingested_at?: string | null
          ingested_by?: string | null
          ingestion_tier?: Database["public"]["Enums"]["ingestion_tier"]
          manifest?: Json | null
          moderated_at?: string | null
          moderated_by?: string | null
          moderation_status?: string
          raw_content?: Json | null
          readme?: string | null
          slug: string
          source_author?: string | null
          source_date?: string | null
          source_platform?: string | null
          source_url: string
          status?: string | null
          summary?: string | null
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string | null
          use_case?: string | null
          writeback_at?: string | null
          writeback_by?: string | null
        }
        Update: {
          agents_md?: string | null
          canonical_score?: number | null
          chunks_attempted?: number | null
          chunks_embedded?: number | null
          complexity?: string | null
          content_type?: string | null
          created_at?: string | null
          descriptor?: string | null
          descriptor_prompt_version?: string | null
          github_sha?: string | null
          id?: string
          ingested_at?: string | null
          ingested_by?: string | null
          ingestion_tier?: Database["public"]["Enums"]["ingestion_tier"]
          manifest?: Json | null
          moderated_at?: string | null
          moderated_by?: string | null
          moderation_status?: string
          raw_content?: Json | null
          readme?: string | null
          slug?: string
          source_author?: string | null
          source_date?: string | null
          source_platform?: string | null
          source_url?: string
          status?: string | null
          summary?: string | null
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string | null
          use_case?: string | null
          writeback_at?: string | null
          writeback_by?: string | null
        }
        Relationships: []
      }
      ingestion_logs: {
        Row: {
          created_at: string | null
          details: Json | null
          duration_ms: number | null
          entry_id: string | null
          id: string
          status: string | null
          step: string
        }
        Insert: {
          created_at?: string | null
          details?: Json | null
          duration_ms?: number | null
          entry_id?: string | null
          id?: string
          status?: string | null
          step: string
        }
        Update: {
          created_at?: string | null
          details?: Json | null
          duration_ms?: number | null
          entry_id?: string | null
          id?: string
          status?: string | null
          step?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_logs_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_bases: {
        Row: {
          agent_write_enabled: boolean
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          id: string
          name: string
          slug: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          agent_write_enabled?: boolean
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          name: string
          slug: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          agent_write_enabled?: boolean
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          name?: string
          slug?: string
          updated_at?: string
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
      knowledge_folders: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
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
      knowledge_pack_files: {
        Row: {
          body: string
          category: string | null
          frontmatter: Json
          pack_id: string
          path: string
          summary: string | null
          tags: string[]
          title: string | null
          updated_at: string
        }
        Insert: {
          body: string
          category?: string | null
          frontmatter?: Json
          pack_id: string
          path: string
          summary?: string | null
          tags?: string[]
          title?: string | null
          updated_at?: string
        }
        Update: {
          body?: string
          category?: string | null
          frontmatter?: Json
          pack_id?: string
          path?: string
          summary?: string | null
          tags?: string[]
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_pack_files_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "knowledge_packs"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_packs: {
        Row: {
          created_at: string
          default_branch: string
          description: string | null
          id: string
          last_commit_sha: string | null
          last_synced_at: string | null
          manifest: Json | null
          name: string
          repo_name: string
          repo_owner: string
          repo_url: string
          sdk_version: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_branch?: string
          description?: string | null
          id: string
          last_commit_sha?: string | null
          last_synced_at?: string | null
          manifest?: Json | null
          name: string
          repo_name: string
          repo_owner: string
          repo_url: string
          sdk_version?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_branch?: string
          description?: string | null
          id?: string
          last_commit_sha?: string | null
          last_synced_at?: string | null
          manifest?: Json | null
          name?: string
          repo_name?: string
          repo_owner?: string
          repo_url?: string
          sdk_version?: string | null
          updated_at?: string
        }
        Relationships: []
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
        }
        Relationships: [
          {
            foreignKeyName: "mcp_events_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
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
          early_supporter_granted_at: string | null
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
          early_supporter_granted_at?: string | null
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
          early_supporter_granted_at?: string | null
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
      published_cluster_brains: {
        Row: {
          created_at: string | null
          id: string
          instructions: string
          published_cluster_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          instructions?: string
          published_cluster_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          instructions?: string
          published_cluster_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "published_cluster_brains_published_cluster_id_fkey"
            columns: ["published_cluster_id"]
            isOneToOne: true
            referencedRelation: "published_clusters"
            referencedColumns: ["id"]
          },
        ]
      }
      published_cluster_panels: {
        Row: {
          entry_id: string
          height: number | null
          id: string
          published_cluster_id: string
          source_url: string | null
          summary: string | null
          title: string | null
          width: number | null
          x: number | null
          y: number | null
        }
        Insert: {
          entry_id: string
          height?: number | null
          id?: string
          published_cluster_id: string
          source_url?: string | null
          summary?: string | null
          title?: string | null
          width?: number | null
          x?: number | null
          y?: number | null
        }
        Update: {
          entry_id?: string
          height?: number | null
          id?: string
          published_cluster_id?: string
          source_url?: string | null
          summary?: string | null
          title?: string | null
          width?: number | null
          x?: number | null
          y?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "published_cluster_panels_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "published_cluster_panels_published_cluster_id_fkey"
            columns: ["published_cluster_id"]
            isOneToOne: false
            referencedRelation: "published_clusters"
            referencedColumns: ["id"]
          },
        ]
      }
      published_clusters: {
        Row: {
          category: string | null
          cluster_id: string
          created_at: string | null
          description: string | null
          embedding: string | null
          fork_count: number
          id: string
          slug: string
          status: string
          thumbnail_url: string | null
          title: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          category?: string | null
          cluster_id: string
          created_at?: string | null
          description?: string | null
          embedding?: string | null
          fork_count?: number
          id?: string
          slug: string
          status?: string
          thumbnail_url?: string | null
          title: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          category?: string | null
          cluster_id?: string
          created_at?: string | null
          description?: string | null
          embedding?: string | null
          fork_count?: number
          id?: string
          slug?: string
          status?: string
          thumbnail_url?: string | null
          title?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "published_clusters_cluster_id_fkey"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "clusters"
            referencedColumns: ["id"]
          },
        ]
      }
      sources: {
        Row: {
          content_metadata: Json | null
          created_at: string | null
          depth: number | null
          entry_id: string | null
          extracted_content: string | null
          fetch_status_code: number | null
          id: string
          mime_type: string | null
          normalized_url: string | null
          parent_source_id: string | null
          raw_content: string | null
          source_type: string
          status: string
          status_reason: string | null
          storage_path: string | null
          url: string | null
        }
        Insert: {
          content_metadata?: Json | null
          created_at?: string | null
          depth?: number | null
          entry_id?: string | null
          extracted_content?: string | null
          fetch_status_code?: number | null
          id?: string
          mime_type?: string | null
          normalized_url?: string | null
          parent_source_id?: string | null
          raw_content?: string | null
          source_type: string
          status?: string
          status_reason?: string | null
          storage_path?: string | null
          url?: string | null
        }
        Update: {
          content_metadata?: Json | null
          created_at?: string | null
          depth?: number | null
          entry_id?: string | null
          extracted_content?: string | null
          fetch_status_code?: number | null
          id?: string
          mime_type?: string | null
          normalized_url?: string | null
          parent_source_id?: string | null
          raw_content?: string | null
          source_type?: string
          status?: string
          status_reason?: string | null
          storage_path?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sources_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sources_parent_source_id_fkey"
            columns: ["parent_source_id"]
            isOneToOne: false
            referencedRelation: "sources"
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
      tags: {
        Row: {
          created_at: string | null
          entry_id: string | null
          id: string
          tag_type: string
          tag_value: string
        }
        Insert: {
          created_at?: string | null
          entry_id?: string | null
          id?: string
          tag_type: string
          tag_value: string
        }
        Update: {
          created_at?: string | null
          entry_id?: string | null
          id?: string
          tag_type?: string
          tag_value?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
        ]
      }
      user_credits: {
        Row: {
          balance: number
          cycle_credits_granted: number
          cycle_start: string
          last_daily_bonus: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          balance?: number
          cycle_credits_granted?: number
          cycle_start?: string
          last_daily_bonus?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          balance?: number
          cycle_credits_granted?: number
          cycle_start?: string
          last_daily_bonus?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
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
      workspace_members: {
        Row: {
          id: string
          invited_at: string | null
          invited_by: string | null
          joined_at: string
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
          id: string
          name: string
          owner_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          owner_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          owner_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      writeback_audits: {
        Row: {
          accepted: boolean
          audit_passed: boolean
          audit_reasons: Json | null
          audit_score: number
          created_at: string
          entry_id: string
          id: string
          incoming_byte_len: number | null
          prompt_version: string | null
          rejection_reason: string | null
          submitted_by: string | null
        }
        Insert: {
          accepted: boolean
          audit_passed: boolean
          audit_reasons?: Json | null
          audit_score: number
          created_at?: string
          entry_id: string
          id?: string
          incoming_byte_len?: number | null
          prompt_version?: string | null
          rejection_reason?: string | null
          submitted_by?: string | null
        }
        Update: {
          accepted?: boolean
          audit_passed?: boolean
          audit_reasons?: Json | null
          audit_score?: number
          created_at?: string
          entry_id?: string
          id?: string
          incoming_byte_len?: number | null
          prompt_version?: string | null
          rejection_reason?: string | null
          submitted_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "writeback_audits_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cascade_restore_base: { Args: { p_base_id: string }; Returns: undefined }
      cascade_restore_folder: {
        Args: { p_folder_id: string }
        Returns: undefined
      }
      cascade_soft_delete_base: {
        Args: { p_base_id: string; p_deleted_at: string }
        Returns: undefined
      }
      cascade_soft_delete_folder: {
        Args: { p_deleted_at: string; p_folder_id: string }
        Returns: undefined
      }
      check_and_record_rate_limit: {
        Args: { p_api_key_id: string; p_endpoint: string; p_rpm: number }
        Returns: boolean
      }
      claim_early_supporter_grant: {
        Args: { p_user_id: string }
        Returns: Json
      }
      cleanup_system_events: { Args: never; Returns: number }
      create_cluster_with_entries: {
        Args: {
          p_entry_ids: string[]
          p_name: string
          p_slug: string
          p_user_id: string
          p_workspace_id: string
        }
        Returns: {
          created_at: string
          id: string
          name: string
          slug: string
          updated_at: string
        }[]
      }
      deduct_credits_atomic: {
        Args: {
          p_action: string
          p_amount: number
          p_metadata: Json
          p_user_id: string
        }
        Returns: {
          new_balance: number
          success: boolean
        }[]
      }
      grant_credits_atomic: {
        Args: {
          p_action: string
          p_amount: number
          p_metadata?: Json
          p_user_id: string
        }
        Returns: {
          new_balance: number
          success: boolean
        }[]
      }
      grant_daily_bonus_atomic: {
        Args: { p_amount: number; p_user_id: string }
        Returns: {
          granted: boolean
          new_balance: number
        }[]
      }
      handle_upgrade_atomic: {
        Args: { p_new_monthly: number; p_new_tier: string; p_user_id: string }
        Returns: {
          granted: number
          new_balance: number
        }[]
      }
      increment_fork_count: { Args: { pc_id: string }; Returns: undefined }
      increment_ingestion_count: {
        Args: { user_id_input: string }
        Returns: undefined
      }
      init_credits_atomic: {
        Args: { p_amount: number; p_user_id: string }
        Returns: {
          balance: number
          inserted: boolean
        }[]
      }
      is_workspace_member: {
        Args: { p_min_role?: string; p_user_id: string; p_workspace_id: string }
        Returns: boolean
      }
      reset_cycle_atomic: {
        Args: {
          p_monthly: number
          p_rollover: boolean
          p_tier: string
          p_user_id: string
        }
        Returns: {
          new_balance: number
        }[]
      }
      search_entries: {
        Args: {
          caller_user_id?: string
          filter_complexity?: string
          filter_entry_ids?: string[]
          filter_tags?: string[]
          filter_use_case?: string
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          agents_md: string
          complexity: string
          entry_id: string
          manifest: Json
          readme: string
          similarity: number
          summary: string
          title: string
          use_case: string
        }[]
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
      search_published_clusters: {
        Args: {
          filter_category?: string
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          category: string
          created_at: string
          description: string
          fork_count: number
          id: string
          similarity: number
          slug: string
          thumbnail_url: string
          title: string
          updated_at: string
          user_id: string
        }[]
      }
    }
    Enums: {
      ingestion_tier: "skeleton" | "full"
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
  public: {
    Enums: {
      ingestion_tier: ["skeleton", "full"],
    },
  },
} as const
