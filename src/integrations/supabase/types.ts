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
      address_points: {
        Row: {
          address: string;
          building_id: string | null;
          city: string | null;
          county: string | null;
          id: string;
          imported_at: string;
          kind: string | null;
          landmark: string | null;
          lat: number;
          lng: number;
          place_type: string | null;
          source_key: string;
          source_layer: string | null;
          zip: string | null;
        };
        Insert: {
          address: string;
          building_id?: string | null;
          city?: string | null;
          county?: string | null;
          id?: string;
          imported_at?: string;
          kind?: string | null;
          landmark?: string | null;
          lat: number;
          lng: number;
          place_type?: string | null;
          source_key: string;
          source_layer?: string | null;
          zip?: string | null;
        };
        Update: {
          address?: string;
          building_id?: string | null;
          city?: string | null;
          county?: string | null;
          id?: string;
          imported_at?: string;
          kind?: string | null;
          landmark?: string | null;
          lat?: number;
          lng?: number;
          place_type?: string | null;
          source_key?: string;
          source_layer?: string | null;
          zip?: string | null;
        };
        Relationships: [];
      };
      adhesive_allowed_under: {
        Row: {
          adhesive_id: number;
          underlayment_group_id: number;
        };
        Insert: {
          adhesive_id: number;
          underlayment_group_id: number;
        };
        Update: {
          adhesive_id?: number;
          underlayment_group_id?: number;
        };
        Relationships: [];
      };
      adhesive_coverage_deck: {
        Row: {
          adhesive_id: number;
          coverage_sqft: number;
          custom_value: number;
          deck_type_id: number;
          default_value: number;
          roof_system_id: number;
        };
        Insert: {
          adhesive_id: number;
          coverage_sqft: number;
          custom_value: number;
          deck_type_id: number;
          default_value: number;
          roof_system_id: number;
        };
        Update: {
          adhesive_id?: number;
          coverage_sqft?: number;
          custom_value?: number;
          deck_type_id?: number;
          default_value?: number;
          roof_system_id?: number;
        };
        Relationships: [];
      };
      adhesive_coverage_underlayment: {
        Row: {
          adhesive_id: number;
          coverage_sqft: number;
          custom_value: number;
          default_value: number;
          roof_system_id: number;
          underlayment_group_id: number;
        };
        Insert: {
          adhesive_id: number;
          coverage_sqft: number;
          custom_value: number;
          default_value: number;
          roof_system_id: number;
          underlayment_group_id: number;
        };
        Update: {
          adhesive_id?: number;
          coverage_sqft?: number;
          custom_value?: number;
          default_value?: number;
          roof_system_id?: number;
          underlayment_group_id?: number;
        };
        Relationships: [];
      };
      adhesive_labor_per_ksqft: {
        Row: {
          adhesive_id: number;
          custom_hours: number;
          hours_per_ksqft: number;
          roof_system_id: number;
        };
        Insert: {
          adhesive_id: number;
          custom_hours: number;
          hours_per_ksqft: number;
          roof_system_id: number;
        };
        Update: {
          adhesive_id?: number;
          custom_hours?: number;
          hours_per_ksqft?: number;
          roof_system_id?: number;
        };
        Relationships: [];
      };
      adhesive_ribbon_spacing: {
        Row: {
          adhesive_id: number;
          custom_multi: number;
          labor_multi: number;
          spacing_in: number;
        };
        Insert: {
          adhesive_id: number;
          custom_multi: number;
          labor_multi: number;
          spacing_in: number;
        };
        Update: {
          adhesive_id?: number;
          custom_multi?: number;
          labor_multi?: number;
          spacing_in?: number;
        };
        Relationships: [];
      };
      adhesive_wall_coverage: {
        Row: {
          adhesive_id: number;
          coverage_sqft: number;
          roof_system_id: number;
        };
        Insert: {
          adhesive_id: number;
          coverage_sqft: number;
          roof_system_id: number;
        };
        Update: {
          adhesive_id?: number;
          coverage_sqft?: number;
          roof_system_id?: number;
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
        Relationships: [
          {
            foreignKeyName: "bid_locks_bid_id_fkey";
            columns: ["bid_id"];
            isOneToOne: true;
            referencedRelation: "bids";
            referencedColumns: ["id"];
          },
        ];
      };
      bids: {
        Row: {
          building_id: string | null;
          created_at: string;
          created_by: string | null;
          data: Json;
          deleted_at: string | null;
          grand_total: number;
          lost_reason: string | null;
          id: string;
          name: string;
          opportunity_id: string | null;
          roof_id: string | null;
          status: string;
          takeoff_id: string | null;
          updated_at: string;
          updated_by_name: string | null;
        };
        Insert: {
          building_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          data?: Json;
          deleted_at?: string | null;
          grand_total?: number;
          lost_reason?: string | null;
          id?: string;
          name: string;
          opportunity_id?: string | null;
          roof_id?: string | null;
          status?: string;
          takeoff_id?: string | null;
          updated_at?: string;
          updated_by_name?: string | null;
        };
        Update: {
          building_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          data?: Json;
          deleted_at?: string | null;
          grand_total?: number;
          lost_reason?: string | null;
          id?: string;
          name?: string;
          opportunity_id?: string | null;
          roof_id?: string | null;
          status?: string;
          takeoff_id?: string | null;
          updated_at?: string;
          updated_by_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "bids_building_id_fkey";
            columns: ["building_id"];
            isOneToOne: false;
            referencedRelation: "buildings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bids_roof_id_fkey";
            columns: ["roof_id"];
            isOneToOne: false;
            referencedRelation: "roofs";
            referencedColumns: ["id"];
          },
        ];
      };
      data_refreshes: {
        Row: {
          addressed: number | null;
          buildings: number | null;
          county: string;
          facilities: number | null;
          id: number;
          notes: string | null;
          points_kept: number | null;
          promoted: number | null;
          ran_at: string;
          ran_by: string | null;
        };
        Insert: {
          addressed?: number | null;
          buildings?: number | null;
          county: string;
          facilities?: number | null;
          id?: number;
          notes?: string | null;
          points_kept?: number | null;
          promoted?: number | null;
          ran_at?: string;
          ran_by?: string | null;
        };
        Update: {
          addressed?: number | null;
          buildings?: number | null;
          county?: string;
          facilities?: number | null;
          id?: number;
          notes?: string | null;
          points_kept?: number | null;
          promoted?: number | null;
          ran_at?: string;
          ran_by?: string | null;
        };
        Relationships: [];
      };
      buildings: {
        Row: {
          address1: string;
          address2: string | null;
          address_checked_at: string | null;
          prospect_owner_name: string | null;
          prospect_stage: string | null;
          prospected_at: string | null;
          building_sqft: number | null;
          centroid_lat: number | null;
          centroid_lng: number | null;
          city: string | null;
          county: string | null;
          created_at: string;
          created_by: string | null;
          created_by_name: string | null;
          deed: string | null;
          deleted_at: string | null;
          footprint: Json | null;
          height_ft: number | null;
          id: string;
          imported_at: string | null;
          land_use: string | null;
          lot_sqft: number | null;
          name: string;
          notes: string | null;
          own_book: boolean;
          owner_address: string | null;
          owner_name: string | null;
          parcel_id: string | null;
          perimeter_ft: number | null;
          roof_sqft: number | null;
          source: string;
          source_key: string | null;
          source_layer: string | null;
          state: string;
          stories: number | null;
          tax_year: number | null;
          updated_at: string;
          roof_year: number | null;
          year_built: number | null;
          zip: string | null;
        };
        Insert: {
          address1?: string;
          address2?: string | null;
          address_checked_at?: string | null;
          prospect_owner_name?: string | null;
          prospect_stage?: string | null;
          prospected_at?: string | null;
          building_sqft?: number | null;
          centroid_lat?: number | null;
          centroid_lng?: number | null;
          city?: string | null;
          county?: string | null;
          created_at?: string;
          created_by?: string | null;
          created_by_name?: string | null;
          deed?: string | null;
          deleted_at?: string | null;
          footprint?: Json | null;
          height_ft?: number | null;
          id?: string;
          imported_at?: string | null;
          land_use?: string | null;
          lot_sqft?: number | null;
          name?: string;
          notes?: string | null;
          own_book?: boolean;
          owner_address?: string | null;
          owner_name?: string | null;
          parcel_id?: string | null;
          perimeter_ft?: number | null;
          roof_sqft?: number | null;
          source?: string;
          source_key?: string | null;
          source_layer?: string | null;
          state?: string;
          stories?: number | null;
          tax_year?: number | null;
          updated_at?: string;
          roof_year?: number | null;
          year_built?: number | null;
          zip?: string | null;
        };
        Update: {
          address1?: string;
          address2?: string | null;
          address_checked_at?: string | null;
          prospect_owner_name?: string | null;
          prospect_stage?: string | null;
          prospected_at?: string | null;
          building_sqft?: number | null;
          centroid_lat?: number | null;
          centroid_lng?: number | null;
          city?: string | null;
          county?: string | null;
          created_at?: string;
          created_by?: string | null;
          created_by_name?: string | null;
          deed?: string | null;
          deleted_at?: string | null;
          footprint?: Json | null;
          height_ft?: number | null;
          id?: string;
          imported_at?: string | null;
          land_use?: string | null;
          lot_sqft?: number | null;
          name?: string;
          notes?: string | null;
          own_book?: boolean;
          owner_address?: string | null;
          owner_name?: string | null;
          parcel_id?: string | null;
          perimeter_ft?: number | null;
          roof_sqft?: number | null;
          source?: string;
          source_key?: string | null;
          source_layer?: string | null;
          state?: string;
          stories?: number | null;
          tax_year?: number | null;
          updated_at?: string;
          roof_year?: number | null;
          year_built?: number | null;
          zip?: string | null;
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
        Relationships: [
          {
            foreignKeyName: "catalog_item_numbers_screen_id_fkey";
            columns: ["screen_id"];
            isOneToOne: false;
            referencedRelation: "pricing_catalog";
            referencedColumns: ["id"];
          },
        ];
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
      inventory_locations: {
        Row: {
          active: boolean;
          id: string;
          kind: string;
          name: string;
          sort: number;
        };
        Insert: {
          active?: boolean;
          id: string;
          kind: string;
          name: string;
          sort?: number;
        };
        Update: {
          active?: boolean;
          id?: string;
          kind?: string;
          name?: string;
          sort?: number;
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
          location_id: string;
          note: string | null;
          pair_id: string | null;
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
          location_id?: string;
          note?: string | null;
          pair_id?: string | null;
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
          location_id?: string;
          note?: string | null;
          pair_id?: string | null;
          price_col?: string;
          qty?: number;
          reason?: string;
          row_label?: string;
          screen_id?: string;
          unit?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_movements_bid_id_fkey";
            columns: ["bid_id"];
            isOneToOne: false;
            referencedRelation: "bids";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "inventory_locations";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory_settings: {
        Row: {
          id: number;
          opened_box_rule: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          opened_box_rule?: string;
          updated_at?: string;
        };
        Update: {
          id?: number;
          opened_box_rule?: string;
          updated_at?: string;
        };
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
      legacy_adhesive: {
        Row: {
          adhesive_id: number;
          field_spacing_in: number;
          long_name: string;
          part_number: string | null;
          perim_spacing_in: number;
          price: number;
          short_name: string;
          unit_type: string;
          used_with_wall: number;
        };
        Insert: {
          adhesive_id: number;
          field_spacing_in: number;
          long_name: string;
          part_number?: string | null;
          perim_spacing_in: number;
          price: number;
          short_name: string;
          unit_type: string;
          used_with_wall: number;
        };
        Update: {
          adhesive_id?: number;
          field_spacing_in?: number;
          long_name?: string;
          part_number?: string | null;
          perim_spacing_in?: number;
          price?: number;
          short_name?: string;
          unit_type?: string;
          used_with_wall?: number;
        };
        Relationships: [];
      };
      legacy_roof_system: {
        Row: {
          is_insulation: number;
          lap_over: number;
          long_name: string;
          mech_wall_fasteners: number | null;
          needs_vents: number;
          roof_system_id: number;
          short_name: string;
          sort_order: number;
        };
        Insert: {
          is_insulation: number;
          lap_over: number;
          long_name: string;
          mech_wall_fasteners?: number | null;
          needs_vents: number;
          roof_system_id: number;
          short_name: string;
          sort_order: number;
        };
        Update: {
          is_insulation?: number;
          lap_over?: number;
          long_name?: string;
          mech_wall_fasteners?: number | null;
          needs_vents?: number;
          roof_system_id?: number;
          short_name?: string;
          sort_order?: number;
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
      mech_fastener_lookup: {
        Row: {
          corner_spacing: number;
          design_table: number;
          field_spacing: number;
          membrane_thickness: number;
          perim_spacing: number;
          pull_test: number;
          roof_system_id: number;
          tab_spacing: number;
        };
        Insert: {
          corner_spacing: number;
          design_table: number;
          field_spacing: number;
          membrane_thickness: number;
          perim_spacing: number;
          pull_test: number;
          roof_system_id: number;
          tab_spacing: number;
        };
        Update: {
          corner_spacing?: number;
          design_table?: number;
          field_spacing?: number;
          membrane_thickness?: number;
          perim_spacing?: number;
          pull_test?: number;
          roof_system_id?: number;
          tab_spacing?: number;
        };
        Relationships: [];
      };
      mech_sheet_tab_spacing: {
        Row: {
          roof_system_id: number;
          spacing: number;
        };
        Insert: {
          roof_system_id: number;
          spacing: number;
        };
        Update: {
          roof_system_id?: number;
          spacing?: number;
        };
        Relationships: [];
      };
      mech_tab_multi: {
        Row: {
          custom_multi: number;
          multiplier: number;
          roof_system_id: number;
          tab_spacing: number;
        };
        Insert: {
          custom_multi: number;
          multiplier: number;
          roof_system_id: number;
          tab_spacing: number;
        };
        Update: {
          custom_multi?: number;
          multiplier?: number;
          roof_system_id?: number;
          tab_spacing?: number;
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
        Relationships: [
          {
            foreignKeyName: "price_import_changes_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "price_import_runs";
            referencedColumns: ["id"];
          },
        ];
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
      rdl_adhered_sheet_multi: {
        Row: {
          adhesive_id: number;
          custom_multiplier: number;
          multiplier: number;
          roof_system_id: number;
          sheet_label: string;
        };
        Insert: {
          adhesive_id: number;
          custom_multiplier?: number;
          multiplier: number;
          roof_system_id: number;
          sheet_label: string;
        };
        Update: {
          adhesive_id?: number;
          custom_multiplier?: number;
          multiplier?: number;
          roof_system_id?: number;
          sheet_label?: string;
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
      rdl_roll_good_width: {
        Row: {
          custom_multiplier: number;
          multiplier: number;
          roof_system_id: number;
          width_in: number;
        };
        Insert: {
          custom_multiplier?: number;
          multiplier: number;
          roof_system_id: number;
          width_in: number;
        };
        Update: {
          custom_multiplier?: number;
          multiplier?: number;
          roof_system_id?: number;
          width_in?: number;
        };
        Relationships: [];
      };
      roofs: {
        Row: {
          area_sqft: number | null;
          bid_id: string | null;
          building_id: string;
          condition: string | null;
          created_at: string;
          id: string;
          install_date: string | null;
          installer: string | null;
          last_inspection: string | null;
          notes: string | null;
          roof_system: string | null;
          roof_type: string | null;
          section_name: string;
          updated_at: string;
          warranty_expires: string | null;
          warranty_type: string | null;
        };
        Insert: {
          area_sqft?: number | null;
          bid_id?: string | null;
          building_id: string;
          condition?: string | null;
          created_at?: string;
          id?: string;
          install_date?: string | null;
          installer?: string | null;
          last_inspection?: string | null;
          notes?: string | null;
          roof_system?: string | null;
          roof_type?: string | null;
          section_name?: string;
          updated_at?: string;
          warranty_expires?: string | null;
          warranty_type?: string | null;
        };
        Update: {
          area_sqft?: number | null;
          bid_id?: string | null;
          building_id?: string;
          condition?: string | null;
          created_at?: string;
          id?: string;
          install_date?: string | null;
          installer?: string | null;
          last_inspection?: string | null;
          notes?: string | null;
          roof_system?: string | null;
          roof_type?: string | null;
          section_name?: string;
          updated_at?: string;
          warranty_expires?: string | null;
          warranty_type?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "roofs_bid_id_fkey";
            columns: ["bid_id"];
            isOneToOne: false;
            referencedRelation: "bids";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "roofs_building_id_fkey";
            columns: ["building_id"];
            isOneToOne: false;
            referencedRelation: "buildings";
            referencedColumns: ["id"];
          },
        ];
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
      takeoffs: {
        Row: {
          bid_id: string | null;
          building_id: string | null;
          created_at: string;
          created_by: string | null;
          deleted_at: string | null;
          file_name: string | null;
          file_path: string | null;
          file_size: number | null;
          id: string;
          name: string;
          objects: Json;
          pages: Json;
          setup: Json;
          status: string;
          underlay_kind: string;
          updated_at: string;
        };
        Insert: {
          bid_id?: string | null;
          building_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          file_name?: string | null;
          file_path?: string | null;
          file_size?: number | null;
          id?: string;
          name?: string;
          objects?: Json;
          pages?: Json;
          setup?: Json;
          status?: string;
          underlay_kind: string;
          updated_at?: string;
        };
        Update: {
          bid_id?: string | null;
          building_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          file_name?: string | null;
          file_path?: string | null;
          file_size?: number | null;
          id?: string;
          name?: string;
          objects?: Json;
          pages?: Json;
          setup?: Json;
          status?: string;
          underlay_kind?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "takeoffs_bid_id_fkey";
            columns: ["bid_id"];
            isOneToOne: false;
            referencedRelation: "bids";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "takeoffs_building_id_fkey";
            columns: ["building_id"];
            isOneToOne: false;
            referencedRelation: "buildings";
            referencedColumns: ["id"];
          },
        ];
      };
      tasks: {
        Row: {
          assignee: string | null;
          assignee_name: string | null;
          building_id: string | null;
          created_at: string;
          created_by: string | null;
          created_by_name: string | null;
          details: string | null;
          done_at: string | null;
          due_date: string | null;
          id: string;
          source: string;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          assignee?: string | null;
          assignee_name?: string | null;
          building_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          created_by_name?: string | null;
          details?: string | null;
          done_at?: string | null;
          due_date?: string | null;
          id?: string;
          source?: string;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          assignee?: string | null;
          assignee_name?: string | null;
          building_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          created_by_name?: string | null;
          details?: string | null;
          done_at?: string | null;
          due_date?: string | null;
          id?: string;
          source?: string;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_building_id_fkey";
            columns: ["building_id"];
            isOneToOne: false;
            referencedRelation: "buildings";
            referencedColumns: ["id"];
          },
        ];
      };
      underlayment_board_group: {
        Row: {
          board_name: string;
          need_quote: boolean;
          sort: number;
          subtype: number | null;
          subtype_sort: number | null;
          underlayment_group_id: number;
        };
        Insert: {
          board_name: string;
          need_quote?: boolean;
          sort: number;
          subtype?: number | null;
          subtype_sort?: number | null;
          underlayment_group_id: number;
        };
        Update: {
          board_name?: string;
          need_quote?: boolean;
          sort?: number;
          subtype?: number | null;
          subtype_sort?: number | null;
          underlayment_group_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "underlayment_board_group_underlayment_group_id_fkey";
            columns: ["underlayment_group_id"];
            isOneToOne: false;
            referencedRelation: "underlayment_group";
            referencedColumns: ["underlayment_group_id"];
          },
        ];
      };
      underlayment_group: {
        Row: {
          description: string;
          sort_option: number;
          underlayment_group_id: number;
        };
        Insert: {
          description: string;
          sort_option: number;
          underlayment_group_id: number;
        };
        Update: {
          description?: string;
          sort_option?: number;
          underlayment_group_id?: number;
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
        Args: {
          p_bid: string;
          p_name: string;
          p_session: string;
          p_ttl_seconds?: number;
        };
        Returns: {
          acquired: boolean;
          heartbeat_at: string;
          holder_name: string;
          holder_session: string;
          holder_user: string;
        }[];
      };
      current_user_role: { Args: never; Returns: string };
      estimator_names: { Args: never; Returns: string[] };
      classify_place: {
        Args: { place_type: string; landmark: string };
        Returns: string;
      };
      promote_commercial_points: {
        Args: { p_county: string; p_max_m?: number; p_limit?: number };
        Returns: number;
      };
      trim_address_points: {
        Args: { p_county: string; p_keep_m?: number; p_limit?: number };
        Returns: number;
      };
      building_county_counts: {
        Args: never;
        Returns: { county: string; n: number }[];
      };
      reset_address_checks: {
        Args: { p_county: string };
        Returns: number;
      };
      upsert_buildings: {
        Args: { rows: Json };
        Returns: number;
      };
      fill_footprint_addresses: {
        Args: { p_county: string; p_max_m?: number; p_limit?: number };
        Returns: number;
      };
      has_access: { Args: { page: string }; Returns: boolean };
      inventory_bid_options: {
        Args: never;
        Returns: {
          id: string;
          name: string;
          status: string;
          updated_at: string;
        }[];
      };
      is_admin: { Args: never; Returns: boolean };
      release_bid_lock: {
        Args: { p_bid: string; p_session: string };
        Returns: undefined;
      };
      warranty_leads: {
        Args: never;
        Returns: {
          address: string;
          bid_id: string;
          bid_name: string;
          building_id: string;
          city: string;
          customer_name: string;
          start_date: string;
          state: string;
          updated_at: string;
          warranty_name: string;
          zip: string;
        }[];
      };
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
