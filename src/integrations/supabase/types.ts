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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      error_log: {
        Row: {
          context: string | null
          created_at: string
          error_message: string
          function_name: string
          id: string
        }
        Insert: {
          context?: string | null
          created_at?: string
          error_message: string
          function_name: string
          id?: string
        }
        Update: {
          context?: string | null
          created_at?: string
          error_message?: string
          function_name?: string
          id?: string
        }
        Relationships: []
      }
      model_keywords: {
        Row: {
          context_words: string | null
          created_at: string
          id: string
          keyword: string
          model_id: string
          tier: string
        }
        Insert: {
          context_words?: string | null
          created_at?: string
          id?: string
          keyword: string
          model_id: string
          tier?: string
        }
        Update: {
          context_words?: string | null
          created_at?: string
          id?: string
          keyword?: string
          model_id?: string
          tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "model_keywords_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "models"
            referencedColumns: ["id"]
          },
        ]
      }
      models: {
        Row: {
          accent_color: string | null
          created_at: string
          id: string
          name: string
          slug: string
        }
        Insert: {
          accent_color?: string | null
          created_at?: string
          id?: string
          name: string
          slug: string
        }
        Update: {
          accent_color?: string | null
          created_at?: string
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      scraped_posts: {
        Row: {
          complaint_category: string | null
          confidence: number | null
          content: string | null
          content_type: string | null
          created_at: string
          id: string
          model_id: string
          posted_at: string | null
          score: number | null
          sentiment: string | null
          source: string
          source_url: string | null
          title: string | null
        }
        Insert: {
          complaint_category?: string | null
          confidence?: number | null
          content?: string | null
          content_type?: string | null
          created_at?: string
          id?: string
          model_id: string
          posted_at?: string | null
          score?: number | null
          sentiment?: string | null
          source: string
          source_url?: string | null
          title?: string | null
        }
        Update: {
          complaint_category?: string | null
          confidence?: number | null
          content?: string | null
          content_type?: string | null
          created_at?: string
          id?: string
          model_id?: string
          posted_at?: string | null
          score?: number | null
          sentiment?: string | null
          source?: string
          source_url?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scraped_posts_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "models"
            referencedColumns: ["id"]
          },
        ]
      }
      scraper_config: {
        Row: {
          created_at: string
          id: string
          key: string
          scraper: string
          value: string
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          scraper: string
          value: string
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          scraper?: string
          value?: string
        }
        Relationships: []
      }
      scraper_runs: {
        Row: {
          completed_at: string | null
          errors: string[] | null
          id: string
          posts_classified: number | null
          posts_found: number | null
          source: string
          started_at: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          errors?: string[] | null
          id?: string
          posts_classified?: number | null
          posts_found?: number | null
          source: string
          started_at?: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          errors?: string[] | null
          id?: string
          posts_classified?: number | null
          posts_found?: number | null
          source?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      user_reports: {
        Row: {
          comment: string | null
          complaint_category: string | null
          created_at: string
          id: string
          model_id: string
          sentiment: string
        }
        Insert: {
          comment?: string | null
          complaint_category?: string | null
          created_at?: string
          id?: string
          model_id: string
          sentiment: string
        }
        Update: {
          comment?: string | null
          complaint_category?: string | null
          created_at?: string
          id?: string
          model_id?: string
          sentiment?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_reports_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "models"
            referencedColumns: ["id"]
          },
        ]
      }
      vibes_scores: {
        Row: {
          created_at: string
          id: string
          model_id: string
          negative_count: number | null
          neutral_count: number | null
          period: string
          period_start: string
          positive_count: number | null
          score: number
          top_complaint: string | null
          total_posts: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          model_id: string
          negative_count?: number | null
          neutral_count?: number | null
          period: string
          period_start: string
          positive_count?: number | null
          score: number
          top_complaint?: string | null
          total_posts?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          model_id?: string
          negative_count?: number | null
          neutral_count?: number | null
          period?: string
          period_start?: string
          positive_count?: number | null
          score?: number
          top_complaint?: string | null
          total_posts?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vibes_scores_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "models"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_complaint_breakdown: {
        Args: { p_model_id: string }
        Returns: {
          category: string
          count: number
        }[]
      }
      get_landing_vibes: {
        Args: never
        Returns: {
          accent_color: string
          last_updated: string
          latest_score: number
          model_id: string
          model_name: string
          model_slug: string
          previous_score: number
          top_complaint: string
          total_posts: number
        }[]
      }
      get_source_breakdown: {
        Args: { p_model_id: string }
        Returns: {
          count: number
          source: string
        }[]
      }
      get_sparkline_scores: {
        Args: never
        Returns: {
          model_id: string
          period_start: string
          score: number
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
