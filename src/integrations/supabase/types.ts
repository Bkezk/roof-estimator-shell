export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      bids: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          commission_pct: number;
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          role: string;
          updated_at: string;
        };
        Insert: {
          commission_pct?: number;
          created_at?: string;
          email: string;
          full_name?: string | null;
          id: string;
          role?: string;
          updated_at?: string;
        };
        Update: {
          commission_pct?: number;
          created_at?: string;
          email?: string;
          full_name?: string | null;
          id?: string;
          role?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      company_settings: {
        Row: {
          address: string | null;
          city: string | null;
          company_name: string | null;
          dl_account: string | null;
          hours_per_man_day: number;
          id: number;
          labor_display: string;
          master_elite: boolean;
          only_tax_material: boolean;
          phone: string | null;
          sales_tax_rate: number;
          shipping_method: string;
          shipping_percent: number;
          state: string | null;
          updated_at: string;
          zip: string | null;
        };
        Insert: {
          address?: string | null;
          city?: string | null;
          company_name?: string | null;
          dl_account?: string | null;
          hours_per_man_day?: number;
          id?: number;
          labor_display?: string;
          master_elite?: boolean;
          only_tax_material?: boolean;
          phone?: string | null;
          sales_tax_rate?: number;
          shipping_method?: string;
          shipping_percent?: number;
          state?: string | null;
          updated_at?: string;
          zip?: string | null;
        };
        Update: {
          address?: string | null;
          city?: string | null;
          company_name?: string | null;
          dl_account?: string | null;
          hours_per_man_day?: number;
          id?: number;
          labor_display?: string;
          master_elite?: boolean;
          only_tax_material?: boolean;
          phone?: string | null;
          sales_tax_rate?: number;
          shipping_method?: string;
          shipping_percent?: number;
          state?: string | null;
          updated_at?: string;
          zip?: string | null;
        };
        Relationships: [];
      };
      shipping_steps: {
        Row: { id: string; material_threshold: number; shipping_cost: number; sort: number };
        Insert: { id?: string; material_threshold: number; shipping_cost?: number; sort?: number };
        Update: { id?: string; material_threshold?: number; shipping_cost?: number; sort?: number };
        Relationships: [];
      };
      markup_options: {
        Row: {
          created_at: string;
          hourly_rate: number;
          id: string;
          include_commission: boolean;
          include_per_diem: boolean;
          is_default: boolean;
          markup_amount: number;
          markup_type: string;
          name: string;
          sort: number;
        };
        Insert: {
          created_at?: string;
          hourly_rate?: number;
          id?: string;
          include_commission?: boolean;
          include_per_diem?: boolean;
          is_default?: boolean;
          markup_amount?: number;
          markup_type?: string;
          name: string;
          sort?: number;
        };
        Update: {
          created_at?: string;
          hourly_rate?: number;
          id?: string;
          include_commission?: boolean;
          include_per_diem?: boolean;
          is_default?: boolean;
          markup_amount?: number;
          markup_type?: string;
          name?: string;
          sort?: number;
        };
        Relationships: [];
      };
      warranties: {
        Row: {
          id: string;
          name: string;
          non_master_elite_surcharge: number;
          price_per_sqft: number;
          sort: number;
        };
        Insert: {
          id?: string;
          name: string;
          non_master_elite_surcharge?: number;
          price_per_sqft?: number;
          sort?: number;
        };
        Update: {
          id?: string;
          name?: string;
          non_master_elite_surcharge?: number;
          price_per_sqft?: number;
          sort?: number;
        };
        Relationships: [];
      };
      high_wind_upcharges: {
        Row: {
          adhered_per_sqft: number;
          id: string;
          mech_per_sqft: number;
          sort: number;
          term_years: number;
          wind_band: string;
        };
        Insert: {
          adhered_per_sqft?: number;
          id?: string;
          mech_per_sqft?: number;
          sort?: number;
          term_years: number;
          wind_band: string;
        };
        Update: {
          adhered_per_sqft?: number;
          id?: string;
          mech_per_sqft?: number;
          sort?: number;
          term_years?: number;
          wind_band?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
