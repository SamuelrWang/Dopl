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
      canvas_edges: {
        Row: {
          created_at: string
          created_by: string | null
          from_panel_id: string
          id: string
          to_panel_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          from_panel_id: string
          id?: string
          to_panel_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          from_panel_id?: string
          id?: string
          to_panel_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "canvas_edges_from_panel_fkey"
            columns: ["workspace_id", "from_panel_id"]
            isOneToOne: false
            referencedRelation: "canvas_panels"
            referencedColumns: ["workspace_id", "panel_id"]
          },
          {
            foreignKeyName: "canvas_edges_to_panel_fkey"
            columns: ["workspace_id", "to_panel_id"]
            isOneToOne: false
            referencedRelation: "canvas_panels"
            referencedColumns: ["workspace_id", "panel_id"]
          },
          {
            foreignKeyName: "canvas_edges_workspace_id_fkey"
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
          id: string
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
          id?: string
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
          id?: string
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
      chat_folders: {
        Row: {
          created_at: string
          id: string
          name: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          user_id?: string
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
          client_session_id: string | null
          created_at: string
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
          client_session_id?: string | null
          created_at?: string
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
          client_session_id?: string | null
          created_at?: string
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
      clusters: {
        Row: {
          created_at: string | null
          description: string | null
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
          description?: string | null
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
          description?: string | null
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
          object_type: string
          subtitle: string
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
          object_type?: string
          subtitle?: string
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
          object_type?: string
          subtitle?: string
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
          file_id: string | null
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
          file_id?: string | null
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
          file_id?: string | null
          id?: string
          skill_id?: string
          source?: string
          type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "skill_events_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "skill_files"
            referencedColumns: ["id"]
          },
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
      skill_file_versions: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          file_id: string
          file_name: string
          id: string
          skill_id: string
          source: string
          workspace_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          file_id: string
          file_name: string
          id?: string
          skill_id: string
          source: string
          workspace_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          file_id?: string
          file_name?: string
          id?: string
          skill_id?: string
          source?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "skill_file_versions_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "skill_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skill_file_versions_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skill_file_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      skill_files: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          last_edited_by: string | null
          last_edited_source: string
          name: string
          position: number
          skill_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          body?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          last_edited_by?: string | null
          last_edited_source?: string
          name: string
          position?: number
          skill_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          last_edited_by?: string | null
          last_edited_source?: string
          name?: string
          position?: number
          skill_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "skill_files_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skill_files_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      skills: {
        Row: {
          agent_write_enabled: boolean
          connectors: Json
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string
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
          agent_write_enabled?: boolean
          connectors?: Json
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description: string
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
          agent_write_enabled?: boolean
          connectors?: Json
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string
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
      workflow_knowledge_bases: {
        Row: {
          added_at: string
          added_by_user_id: string | null
          knowledge_base_id: string
          workflow_id: string
          workspace_id: string
        }
        Insert: {
          added_at?: string
          added_by_user_id?: string | null
          knowledge_base_id: string
          workflow_id: string
          workspace_id: string
        }
        Update: {
          added_at?: string
          added_by_user_id?: string | null
          knowledge_base_id?: string
          workflow_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_knowledge_bases_knowledge_base_id_fkey"
            columns: ["knowledge_base_id"]
            isOneToOne: false
            referencedRelation: "knowledge_bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_knowledge_bases_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_knowledge_bases_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_skills: {
        Row: {
          added_at: string
          added_by_user_id: string | null
          skill_id: string
          workflow_id: string
          workspace_id: string
        }
        Insert: {
          added_at?: string
          added_by_user_id?: string | null
          skill_id: string
          workflow_id: string
          workspace_id: string
        }
        Update: {
          added_at?: string
          added_by_user_id?: string | null
          skill_id?: string
          workflow_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_skills_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_skills_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workflows: {
        Row: {
          access_mode: string
          cluster_id: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          slug: string
          updated_at: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          access_mode?: string
          cluster_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          slug: string
          updated_at?: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          access_mode?: string
          cluster_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          slug?: string
          updated_at?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflows_cluster_id_fkey"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "clusters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflows_workspace_id_fkey"
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
      workspace_resource_access: {
        Row: {
          level: string
          resource_id: string
          resource_type: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          level: string
          resource_id: string
          resource_type: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          level?: string
          resource_id?: string
          resource_type?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_resource_access_workspace_id_fkey"
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
      chat_append_messages: {
        Args: { p_chat_id: string; p_messages: Json; p_workspace_id: string }
        Returns: number
      }
      chat_replace_messages: {
        Args: { p_chat_id: string; p_messages: Json; p_workspace_id: string }
        Returns: number
      }
      check_and_record_rate_limit_subject: {
        Args: { p_endpoint: string; p_rpm: number; p_subject: string }
        Returns: boolean
      }
      cleanup_system_events: { Args: never; Returns: number }
      increment_fork_count: { Args: { pc_id: string }; Returns: undefined }
      increment_ingestion_count: {
        Args: { user_id_input: string }
        Returns: undefined
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
  public: {
    Enums: {},
  },
} as const
