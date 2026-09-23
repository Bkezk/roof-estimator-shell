export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      accessory_labor: {
        Row: {
          category: string;
          data: Json;
          id: string;
          sort: number;
        };
        Insert: {
          category: string;
          data?: Json;
          id: string;
          sort?: number;
        };
        Update: {
          category?: string;
          data?: Json;
          id?: string;
          sort?: number;
        };
        Relationships: [];
      };
      bid_locks: {
        Row: {
          acquired_at: string;
          bid_id: string;
          heartbeat_at: string;
          holder_name: string;
          session_key: string;
          user_id: string;
        };
        Insert: {
          acquired_at?: string;
          bid_id: string;
          heartbeat_at?: string;
          holder_name: string;
          session_key: string;
          user_id: string;
        };
        Update: {
          acquired_at?: string;
          bid_id?: string;
          heartbeat_at?: string;
          holder_name?: string;
          session_key?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      bids: {
        Row: {
          created_at: string;
          created_by: string | null;
          data: Json;
          deleted_at: string | null;
          grand_total: number;
          id: string;
          name: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          data?: Json;
          deleted_at?: string | null;
          grand_total?: number;
          id?: string;
          name: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          data?: Json;
          deleted_at?: string | null;
          grand_total?: number;
          id?: string;
          name?: string;
          status?: string;
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
      inventory_movements: {
        Row: {
          bid_id: string | null;
          bid_name: string | null;
          counted_note: string | null;
          created_at: string;
          created_by: string | null;
          created_by_name: string | null;
          id: number;
          item_no: string | null;
          note: string | null;
          price_col: string;
          qty: number;
          reason: string;
          row_label: string;
          screen_id: string;
          unit: string;
        };
        Insert: {
          bid_id?: string | null;
          bid_name?: string | null;
          counted_note?: string | null;
          created_at?: string;
          created_by?: string | null;
          created_by_name?: string | null;
          id?: number;
          item_no?: string | null;
          note?: string | null;
          price_col: string;
          qty: number;
          reason: string;
          row_label: string;
          screen_id: string;
          unit: string;
        };
        Update: {
          bid_id?: string | null;
          bid_name?: string | null;
          counted_note?: string | null;
          created_at?: string;
          created_by?: string | null;
          created_by_name?: string | null;
          id?: number;
          item_no?: string | null;
          note?: string | null;
          price_col?: string;
          qty?: number;
          reason?: string;
          row_label?: string;
          screen_id?: string;
          unit?: string;
        };
        Relationships: [];
      };
      inventory_settings: {
        Row: { id: number; opened_box_rule: string; updated_at: string };
        Insert: { id?: number; opened_box_rule?: string; updated_at?: string };
        Update: { id?: number; opened_box_rule?: string; updated_at?: string };
        Relationships: [];
      };
      labor_curb: {
        Row: {
          id: number;
          setup_minutes: number;
        };
        Insert: {
          id?: number;
          setup_minutes?: number;
        };
        Update: {
          id?: number;
          setup_minutes?: number;
        };
        Relationships: [];
      };
      labor_curb_deck: {
        Row: {
          deck_type: string;
          id: string;
          minutes: number;
          setup_minutes: number | null;
          sort: number;
        };
        Insert: {
          deck_type: string;
          id?: string;
          minutes?: number;
          setup_minutes?: number | null;
          sort?: number;
        };
        Update: {
          deck_type?: string;
          id?: string;
          minutes?: number;
          setup_minutes?: number | null;
          sort?: number;
        };
        Relationships: [];
      };
      labor_curb_type: {
        Row: {
          curb_type: string;
          id: string;
          multiplier: number;
          sort: number;
        };
        Insert: {
          curb_type: string;
          id?: string;
          multiplier?: number;
          sort?: number;
        };
        Update: {
          curb_type?: string;
          id?: string;
          multiplier?: number;
          sort?: number;
        };
        Relationships: [];
      };
      labor_inspection_steps: {
        Row: {
          hours: number;
          id: string;
          sort: number;
          sqft: number;
        };
        Insert: {
          hours?: number;
          id?: string;
          sort?: number;
          sqft: number;
        };
        Update: {
          hours?: number;
          id?: string;
          sort?: number;
          sqft?: number;
        };
        Relationships: [];
      };
      labor_parapet: {
        Row: {
          deck_type: string;
          id: string;
          no_drill_canted: number;
          no_drill_no_cant: number;
          predrill_canted: number;
          predrill_no_cant: number;
          sort: number;
          wall_height_band: string;
        };
        Insert: {
          deck_type: string;
          id?: string;
          no_drill_canted?: number;
          no_drill_no_cant?: number;
          predrill_canted?: number;
          predrill_no_cant?: number;
          sort?: number;
          wall_height_band: string;
        };
        Update: {
          deck_type?: string;
          id?: string;
          no_drill_canted?: number;
          no_drill_no_cant?: number;
          predrill_canted?: number;
          predrill_no_cant?: number;
          sort?: number;
          wall_height_band?: string;
        };
        Relationships: [];
      };
      labor_setup: {
        Row: {
          id: number;
          minimum_hours: number;
        };
        Insert: {
          id?: number;
          minimum_hours?: number;
        };
        Update: {
          id?: number;
          minimum_hours?: number;
        };
        Relationships: [];
      };
      labor_setup_steps: {
        Row: {
          id: string;
          multiplier: number;
          sort: number;
          sqft: number;
        };
        Insert: {
          id?: string;
          multiplier?: number;
          sort?: number;
          sqft: number;
        };
        Update: {
          id?: string;
          multiplier?: number;
          sort?: number;
          sqft?: number;
        };
        Relationships: [];
      };
      labor_template_adjustments: {
        Row: {
          area: string;
          id: string;
          sort: number;
          template_id: string;
          value: number;
        };
        Insert: {
          area: string;
          id?: string;
          sort?: number;
          template_id: string;
          value?: number;
        };
        Update: {
          area?: string;
          id?: string;
          sort?: number;
          template_id?: string;
          value?: number;
        };
        Relationships: [
          {
            foreignKeyName: "labor_template_adjustments_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "labor_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      labor_templates: {
        Row: {
          id: string;
          is_default: boolean;
          name: string;
          sort: number;
        };
        Insert: {
          id?: string;
          is_default?: boolean;
          name: string;
          sort?: number;
        };
        Update: {
          id?: string;
          is_default?: boolean;
          name?: string;
          sort?: number;
        };
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
      catalog_item_numbers: {
        Row: {
          confirmed_at: string | null;
          confirmed_description: string | null;
          created_at: string;
          dl_description: string | null;
          item_no: string;
          last_import_at: string | null;
          last_price: number | null;
          price_col: string;
          row_label: string;
          screen_id: string;
        };
        Insert: {
          confirmed_at?: string | null;
          confirmed_description?: string | null;
          created_at?: string;
          dl_description?: string | null;
          item_no: string;
          last_import_at?: string | null;
          last_price?: number | null;
          price_col: string;
          row_label: string;
          screen_id: string;
        };
        Update: {
          confirmed_at?: string | null;
          confirmed_description?: string | null;
          created_at?: string;
          dl_description?: string | null;
          item_no?: string;
          last_import_at?: string | null;
          last_price?: number | null;
          price_col?: string;
          row_label?: string;
          screen_id?: string;
        };
        Relationships: [];
      };
      price_import_changes: {
        Row: {
          id: number;
          item_no: string;
          new_price: number;
          old_price: number | null;
          price_col: string;
          reverted_at: string | null;
          row_label: string;
          run_id: string;
          screen_id: string;
          sheet_description: string | null;
        };
        Insert: {
          id?: number;
          item_no: string;
          new_price: number;
          old_price?: number | null;
          price_col: string;
          reverted_at?: string | null;
          row_label: string;
          run_id: string;
          screen_id: string;
          sheet_description?: string | null;
        };
        Update: {
          id?: number;
          item_no?: string;
          new_price?: number;
          old_price?: number | null;
          price_col?: string;
          reverted_at?: string | null;
          row_label?: string;
          run_id?: string;
          screen_id?: string;
          sheet_description?: string | null;
        };
        Relationships: [];
      };
      price_import_runs: {
        Row: {
          cells_changed: number;
          cells_written: number;
          created_at: string;
          created_by: string | null;
          created_by_name: string | null;
          file_name: string;
          id: string;
          revert_note: string | null;
          reverted_at: string | null;
          reverted_by: string | null;
        };
        Insert: {
          cells_changed?: number;
          cells_written?: number;
          created_at?: string;
          created_by?: string | null;
          created_by_name?: string | null;
          file_name: string;
          id?: string;
          revert_note?: string | null;
          reverted_at?: string | null;
          reverted_by?: string | null;
        };
        Update: {
          cells_changed?: number;
          cells_written?: number;
          created_at?: string;
          created_by?: string | null;
          created_by_name?: string | null;
          file_name?: string;
          id?: string;
          revert_note?: string | null;
          reverted_at?: string | null;
          reverted_by?: string | null;
        };
        Relationships: [];
      };
      pricing_catalog: {
        Row: {
          branch: string;
          category: string;
          data: Json;
          id: string;
          sort: number;
        };
        Insert: {
          branch: string;
          category: string;
          data?: Json;
          id: string;
          sort?: number;
        };
        Update: {
          branch?: string;
          category?: string;
          data?: Json;
          id?: string;
          sort?: number;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          access: string[];
          commission_pct: number;
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          role: string;
          updated_at: string;
        };
        Insert: {
          access?: string[];
          commission_pct?: number;
          created_at?: string;
          email: string;
          full_name?: string | null;
          id: string;
          role?: string;
          updated_at?: string;
        };
        Update: {
          access?: string[];
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
      rdl_combos: {
        Row: {
          attachment: string;
          data: Json;
          formula: string | null;
          id: string;
          roof_system: string;
          sort: number;
        };
        Insert: {
          attachment: string;
          data?: Json;
          formula?: string | null;
          id?: string;
          roof_system: string;
          sort?: number;
        };
        Update: {
          attachment?: string;
          data?: Json;
          formula?: string | null;
          id?: string;
          roof_system?: string;
          sort?: number;
        };
        Relationships: [];
      };
      rdl_labor_tables: {
        Row: {
          data: Json;
          id: string;
          sort: number;
          title: string;
        };
        Insert: {
          data?: Json;
          id: string;
          sort?: number;
          title: string;
        };
        Update: {
          data?: Json;
          id?: string;
          sort?: number;
          title?: string;
        };
        Relationships: [];
      };
      shipping_steps: {
        Row: {
          id: string;
          material_threshold: number;
          shipping_cost: number;
          sort: number;
        };
        Insert: {
          id?: string;
          material_threshold: number;
          shipping_cost?: number;
          sort?: number;
        };
        Update: {
          id?: string;
          material_threshold?: number;
          shipping_cost?: number;
          sort?: number;
        };
        Relationships: [];
      };
      warranties: {
        Row: {
          id: string;
          is_high_wind: boolean;
          name: string;
          non_master_elite_surcharge: number;
          price_per_sqft: number;
          req_thickness: number;
          sort: number;
          term_years: number;
        };
        Insert: {
          id?: string;
          is_high_wind?: boolean;
          name: string;
          non_master_elite_surcharge?: number;
          price_per_sqft?: number;
          req_thickness?: number;
          sort?: number;
          term_years?: number;
        };
        Update: {
          id?: string;
          is_high_wind?: boolean;
          name?: string;
          non_master_elite_surcharge?: number;
          price_per_sqft?: number;
          req_thickness?: number;
          sort?: number;
          term_years?: number;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      acquire_bid_lock: {
        Args: { p_bid: string; p_session: string; p_name: string; p_ttl_seconds?: number };
        Returns: {
          acquired: boolean;
          holder_name: string;
          holder_user: string;
          holder_session: string;
          heartbeat_at: string;
        }[];
      };
      current_user_role: { Args: never; Returns: string };
      has_access: { Args: { page: string }; Returns: boolean };
      inventory_bid_options: {
        Args: never;
        Returns: { id: string; name: string; status: string; updated_at: string }[];
      };
      is_admin: { Args: never; Returns: boolean };
      release_bid_lock: { Args: { p_bid: string; p_session: string }; Returns: undefined };
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
