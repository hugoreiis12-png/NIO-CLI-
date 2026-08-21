/**
 * Tipos minimalistas das tabelas do NOS usadas pelo MCP.
 *
 * Não gerado automaticamente — `supabase gen types` exige credentials no projeto.
 * Quando tiver acesso, substitua este arquivo por `npm run gen:types`.
 *
 * Cobre apenas as colunas que o MCP server lê hoje. Adicione campos
 * conforme novas tools precisarem.
 */

export type SprintStatus = 'ativa' | 'encerrada';

export type TaskStatus =
  | 'backlog'
  | 'todo'
  | 'doing'
  | 'code_review'
  | 'rejected'
  | 'qa'
  | 'done'
  | 'production';

export type TaskPriority = 'none' | 'lowest' | 'low' | 'medium' | 'high' | 'urgent';

export type TaskType = 'story' | 'bug' | 'task' | 'epic' | 'subtask' | 'meeting';

export interface Database {
  public: {
    Tables: {
      projects: {
        Row: {
          id: string;
          name: string;
          color: string;
          logo_url: string | null;
          is_active: boolean;
          monthly_hours: number | null;
          notes: string | null;
          ai_context: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['projects']['Row']> & {
          name: string;
          color: string;
        };
        Update: Partial<Database['public']['Tables']['projects']['Row']>;
        Relationships: [];
      };
      repositories: {
        Row: {
          id: string;
          project_id: string;
          name: string;
          url: string;
          default_branch: string;
          ai_context: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['repositories']['Row']> & {
          project_id: string;
          name: string;
          url: string;
        };
        Update: Partial<Database['public']['Tables']['repositories']['Row']>;
        Relationships: [];
      };
      sprints: {
        Row: {
          id: string;
          project_id: string;
          name: string;
          status: SprintStatus;
          start_date: string | null;
          end_date: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['sprints']['Row']> & {
          project_id: string;
          name: string;
          status: SprintStatus;
        };
        Update: Partial<Database['public']['Tables']['sprints']['Row']>;
        Relationships: [];
      };
      project_members: {
        Row: {
          id: string;
          project_id: string;
          user_id: string;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['project_members']['Row']> & {
          project_id: string;
          user_id: string;
        };
        Update: Partial<Database['public']['Tables']['project_members']['Row']>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          username: string | null;
          avatar_url: string | null;
        };
        Insert: Partial<Database['public']['Tables']['profiles']['Row']> & {
          id: string;
        };
        Update: Partial<Database['public']['Tables']['profiles']['Row']>;
        Relationships: [];
      };
      tasks: {
        Row: {
          id: string;
          key: string;
          title: string;
          description: string;
          status: TaskStatus;
          priority: TaskPriority;
          type: TaskType;
          project_id: string;
          assignee_id: string | null;
          reporter_id: string;
          team: string | null;
          url: string | null;
          branch: string | null;
          sprint_id: string | null;
          start_date: string | null;
          end_date: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['tasks']['Row']> & {
          title: string;
          project_id: string;
          reporter_id: string;
        };
        Update: Partial<Database['public']['Tables']['tasks']['Row']>;
        Relationships: [];
      };
      task_assignees: {
        Row: {
          task_id: string;
          user_id: string;
        };
        Insert: {
          task_id: string;
          user_id: string;
        };
        Update: Partial<Database['public']['Tables']['task_assignees']['Row']>;
        Relationships: [];
      };
      task_repositories: {
        Row: {
          task_id: string;
          repository_id: string;
        };
        Insert: {
          task_id: string;
          repository_id: string;
        };
        Update: Partial<Database['public']['Tables']['task_repositories']['Row']>;
        Relationships: [];
      };
      task_label_assignments: {
        Row: {
          task_id: string;
          label_id: string;
        };
        Insert: {
          task_id: string;
          label_id: string;
        };
        Update: Partial<Database['public']['Tables']['task_label_assignments']['Row']>;
        Relationships: [];
      };
      task_labels: {
        Row: {
          id: string;
          project_id: string;
          name: string;
          color: string;
        };
        Insert: Partial<Database['public']['Tables']['task_labels']['Row']> & {
          project_id: string;
          name: string;
          color: string;
        };
        Update: Partial<Database['public']['Tables']['task_labels']['Row']>;
        Relationships: [];
      };
      task_checklist_items: {
        Row: {
          id: string;
          task_id: string;
          text: string;
          checked: boolean;
          order: number;
        };
        Insert: Partial<Database['public']['Tables']['task_checklist_items']['Row']> & {
          task_id: string;
          text: string;
        };
        Update: Partial<Database['public']['Tables']['task_checklist_items']['Row']>;
        Relationships: [];
      };
      task_comments: {
        Row: {
          id: string;
          task_id: string;
          author_id: string;
          content: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['task_comments']['Row']> & {
          task_id: string;
          author_id: string;
          content: string;
        };
        Update: Partial<Database['public']['Tables']['task_comments']['Row']>;
        Relationships: [];
      };
      task_history: {
        Row: {
          id: string;
          task_id: string;
          user_id: string;
          action: string;
          field: string | null;
          old_value: string | null;
          new_value: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['task_history']['Row']> & {
          task_id: string;
          user_id: string;
          action: string;
        };
        Update: Partial<Database['public']['Tables']['task_history']['Row']>;
        Relationships: [];
      };
      allocations: {
        Row: {
          id: string;
          user_id: string;
          start_time: string;
          end_time: string | null;
          auto_closed: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['allocations']['Row']> & {
          user_id: string;
        };
        Update: Partial<Database['public']['Tables']['allocations']['Row']>;
        Relationships: [];
      };
      task_allocations: {
        Row: {
          id: string;
          allocation_id: string;
          task_id: string;
          user_id: string;
          start_time: string;
          end_time: string | null;
          is_overtime: boolean;
          auto_closed: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['task_allocations']['Row']> & {
          allocation_id: string;
          task_id: string;
          user_id: string;
          start_time: string;
        };
        Update: Partial<Database['public']['Tables']['task_allocations']['Row']>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      sprint_status: SprintStatus;
      task_status: TaskStatus;
      task_priority: TaskPriority;
      task_type: TaskType;
    };
    CompositeTypes: Record<string, never>;
  };
}
