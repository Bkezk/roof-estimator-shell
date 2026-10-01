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
      app_secrets: {
        Row: {
          key: string;
          updated_at: string;
          value: string;
        };
        Insert: {
          key: string;
          updated_at?: string;
          value: string;
        };
        Update: {
          key?: string;
          updated_at?: string;
          value?: string;
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
          account_id: string | null;
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
          site_id: string | null;
          status: string;
          takeoff_id: string | null;
          updated_at: string;
          updated_by_name: string | null;
        };
        Insert: {
          account_id?: string | null;
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
          site_id?: string | null;
          status?: string;
          takeoff_id?: string | null;
          updated_at?: string;
          updated_by_name?: string | null;
        };
        Update: {
          account_id?: string | null;
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
          site_id?: string | null;
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
          {
            foreignKeyName: "bids_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "crm_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bids_site_id_fkey";
            columns: ["site_id"];
            isOneToOne: false;
            referencedRelation: "crm_sites";
            referencedColumns: ["id"];
          },
        ];
      };
      crm_accounts: {
        Row: {
          account_manager_id: string | null;
          address1: string | null;
          address2: string | null;
          billing_instructions: string | null;
          centerpoint_company_id: string | null;
          city: string | null;
          contact_name: string | null;
          created_at: string;
          created_by: string | null;
          deleted_at: string | null;
          email: string | null;
          external_id: string | null;
          id: string;
          kind: string;
          mailing_address1: string | null;
          mailing_address2: string | null;
          mailing_city: string | null;
          mailing_same: boolean;
          mailing_state: string | null;
          mailing_zip: string | null;
          mobile: string | null;
          name: string;
          notes: string | null;
          phone: string | null;
          source: string;
          state: string | null;
          tax_exempt: boolean;
          updated_at: string;
          updated_by_name: string | null;
          zip: string | null;
        };
        Insert: {
          account_manager_id?: string | null;
          address1?: string | null;
          address2?: string | null;
          billing_instructions?: string | null;
          centerpoint_company_id?: string | null;
          city?: string | null;
          contact_name?: string | null;
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          email?: string | null;
          external_id?: string | null;
          id?: string;
          kind?: string;
          mailing_address1?: string | null;
          mailing_address2?: string | null;
          mailing_city?: string | null;
          mailing_same?: boolean;
          mailing_state?: string | null;
          mailing_zip?: string | null;
          mobile?: string | null;
          name: string;
          notes?: string | null;
          phone?: string | null;
          source?: string;
          state?: string | null;
          tax_exempt?: boolean;
          updated_at?: string;
          updated_by_name?: string | null;
          zip?: string | null;
        };
        Update: {
          account_manager_id?: string | null;
          address1?: string | null;
          address2?: string | null;
          billing_instructions?: string | null;
          centerpoint_company_id?: string | null;
          city?: string | null;
          contact_name?: string | null;
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          email?: string | null;
          external_id?: string | null;
          id?: string;
          kind?: string;
          mailing_address1?: string | null;
          mailing_address2?: string | null;
          mailing_city?: string | null;
          mailing_same?: boolean;
          mailing_state?: string | null;
          mailing_zip?: string | null;
          mobile?: string | null;
          name?: string;
          notes?: string | null;
          phone?: string | null;
          source?: string;
          state?: string | null;
          tax_exempt?: boolean;
          updated_at?: string;
          updated_by_name?: string | null;
          zip?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "crm_accounts_account_manager_id_fkey";
            columns: ["account_manager_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      crm_contacts: {
        Row: {
          account_id: string;
          centerpoint_contact_id: string | null;
          created_at: string;
          deleted_at: string | null;
          email: string | null;
          id: string;
          is_billing: boolean;
          mobile: string | null;
          name: string;
          notes: string | null;
          office_phone: string | null;
          position: string | null;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          centerpoint_contact_id?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          email?: string | null;
          id?: string;
          is_billing?: boolean;
          mobile?: string | null;
          name: string;
          notes?: string | null;
          office_phone?: string | null;
          position?: string | null;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          centerpoint_contact_id?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          email?: string | null;
          id?: string;
          is_billing?: boolean;
          mobile?: string | null;
          name?: string;
          notes?: string | null;
          office_phone?: string | null;
          position?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "crm_contacts_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "crm_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      crm_contact_log: {
        Row: {
          at: string;
          by_name: string | null;
          by_user: string | null;
          id: number;
          item_id: string;
          kind: string;
          method: string;
          note: string | null;
        };
        Insert: {
          at?: string;
          by_name?: string | null;
          by_user?: string | null;
          id?: number;
          item_id: string;
          kind: string;
          method: string;
          note?: string | null;
        };
        Update: {
          at?: string;
          by_name?: string | null;
          by_user?: string | null;
          id?: number;
          item_id?: string;
          kind?: string;
          method?: string;
          note?: string | null;
        };
        Relationships: [];
      };
      crm_followups: {
        Row: {
          account_id: string | null;
          assignee_id: string;
          closed_at: string | null;
          closed_reason: string | null;
          created_at: string;
          created_by: string | null;
          due_at: string;
          every_days: number;
          id: string;
          item_id: string;
          kind: string;
          last_reminded_at: string | null;
          next_remind_at: string;
          reminders_sent: number;
          status: string;
          title: string;
          updated_at: string;
          url: string;
        };
        Insert: {
          account_id?: string | null;
          assignee_id: string;
          closed_at?: string | null;
          closed_reason?: string | null;
          created_at?: string;
          created_by?: string | null;
          due_at: string;
          every_days?: number;
          id?: string;
          item_id: string;
          kind: string;
          last_reminded_at?: string | null;
          next_remind_at: string;
          reminders_sent?: number;
          status?: string;
          title: string;
          updated_at?: string;
          url: string;
        };
        Update: {
          account_id?: string | null;
          assignee_id?: string;
          closed_at?: string | null;
          closed_reason?: string | null;
          created_at?: string;
          created_by?: string | null;
          due_at?: string;
          every_days?: number;
          id?: string;
          item_id?: string;
          kind?: string;
          last_reminded_at?: string | null;
          next_remind_at?: string;
          reminders_sent?: number;
          status?: string;
          title?: string;
          updated_at?: string;
          url?: string;
        };
        Relationships: [
          {
            foreignKeyName: "crm_followups_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "crm_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crm_followups_assignee_id_fkey";
            columns: ["assignee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      crm_opportunities: {
        Row: {
          account_id: string | null;
          assigned_at: string | null;
          contacted_at: string | null;
          assignee_id: string | null;
          bid_id: string | null;
          created_at: string;
          created_by: string | null;
          deleted_at: string | null;
          description: string | null;
          est_value: number | null;
          expected_close: string | null;
          id: string;
          lead_source: string | null;
          notes: string | null;
          status: string;
          title: string;
          updated_at: string;
          updated_by_name: string | null;
        };
        Insert: {
          account_id?: string | null;
          assigned_at?: string | null;
          contacted_at?: string | null;
          assignee_id?: string | null;
          bid_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          description?: string | null;
          est_value?: number | null;
          expected_close?: string | null;
          id?: string;
          lead_source?: string | null;
          notes?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
          updated_by_name?: string | null;
        };
        Update: {
          account_id?: string | null;
          assigned_at?: string | null;
          contacted_at?: string | null;
          assignee_id?: string | null;
          bid_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          description?: string | null;
          est_value?: number | null;
          expected_close?: string | null;
          id?: string;
          lead_source?: string | null;
          notes?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
          updated_by_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "crm_opportunities_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "crm_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crm_opportunities_assignee_id_fkey";
            columns: ["assignee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crm_opportunities_bid_id_fkey";
            columns: ["bid_id"];
            isOneToOne: false;
            referencedRelation: "bids";
            referencedColumns: ["id"];
          },
        ];
      };
      crm_site_contacts: {
        Row: {
          contact_id: string;
          site_id: string;
        };
        Insert: {
          contact_id: string;
          site_id: string;
        };
        Update: {
          contact_id?: string;
          site_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "crm_site_contacts_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "crm_contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crm_site_contacts_site_id_fkey";
            columns: ["site_id"];
            isOneToOne: false;
            referencedRelation: "crm_sites";
            referencedColumns: ["id"];
          },
        ];
      };
      crm_sites: {
        Row: {
          account_id: string;
          address1: string | null;
          address2: string | null;
          centerpoint_property_id: string | null;
          city: string | null;
          created_at: string;
          deleted_at: string | null;
          id: string;
          name: string;
          notes: string | null;
          state: string | null;
          technician_instructions: string | null;
          updated_at: string;
          zip: string | null;
        };
        Insert: {
          account_id: string;
          address1?: string | null;
          address2?: string | null;
          centerpoint_property_id?: string | null;
          city?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          name: string;
          notes?: string | null;
          state?: string | null;
          technician_instructions?: string | null;
          updated_at?: string;
          zip?: string | null;
        };
        Update: {
          account_id?: string;
          address1?: string | null;
          address2?: string | null;
          centerpoint_property_id?: string | null;
          city?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          name?: string;
          notes?: string | null;
          state?: string | null;
          technician_instructions?: string | null;
          updated_at?: string;
          zip?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "crm_sites_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "crm_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      crm_settings: {
        Row: {
          id: number;
          last_dispatch_at: string | null;
          opportunity_close_days: number;
          opportunity_every_days: number;
          opportunity_first_days: number;
          ticket_every_days: number;
          ticket_untouched_days: number;
          opportunity_untouched_days: number;
          escalate_to_admins: boolean;
          escalate_user_ids: string[];
          ticket_first_days: number;
          updated_at: string;
        };
        Insert: {
          id?: number;
          last_dispatch_at?: string | null;
          opportunity_close_days?: number;
          opportunity_every_days?: number;
          opportunity_first_days?: number;
          ticket_every_days?: number;
          ticket_untouched_days?: number;
          opportunity_untouched_days?: number;
          escalate_to_admins?: boolean;
          escalate_user_ids?: string[];
          ticket_first_days?: number;
          updated_at?: string;
        };
        Update: {
          id?: number;
          last_dispatch_at?: string | null;
          opportunity_close_days?: number;
          opportunity_every_days?: number;
          opportunity_first_days?: number;
          ticket_every_days?: number;
          ticket_untouched_days?: number;
          opportunity_untouched_days?: number;
          escalate_to_admins?: boolean;
          escalate_user_ids?: string[];
          ticket_first_days?: number;
          updated_at?: string;
        };
        Relationships: [];
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
      building_storm_hits: {
        Row: { building_id: string; distance_mi: number; report_id: number };
        Insert: { building_id: string; distance_mi: number; report_id: number };
        Update: { building_id?: string; distance_mi?: number; report_id?: number };
        Relationships: [
          {
            foreignKeyName: "building_storm_hits_building_id_fkey";
            columns: ["building_id"];
            isOneToOne: false;
            referencedRelation: "buildings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "building_storm_hits_report_id_fkey";
            columns: ["report_id"];
            isOneToOne: false;
            referencedRelation: "storm_reports";
            referencedColumns: ["id"];
          },
        ];
      };
      buildings: {
        Row: {
          address1: string;
          address2: string | null;
          address_checked_at: string | null;
          address_approx: boolean;
          address_approx_m: number | null;
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
          last_storm_at: string | null;
          last_storm_kind: string | null;
          last_storm_magnitude: number | null;
          last_storm_miles: number | null;
          last_reroof_on: string | null;
          last_reroof_by: string | null;
          zip: string | null;
        };
        Insert: {
          address1?: string;
          address2?: string | null;
          address_checked_at?: string | null;
          address_approx?: boolean;
          address_approx_m?: number | null;
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
          last_storm_at?: string | null;
          last_storm_kind?: string | null;
          last_storm_magnitude?: number | null;
          last_storm_miles?: number | null;
          last_reroof_on?: string | null;
          last_reroof_by?: string | null;
          zip?: string | null;
        };
        Update: {
          address1?: string;
          address2?: string | null;
          address_checked_at?: string | null;
          address_approx?: boolean;
          address_approx_m?: number | null;
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
          last_storm_at?: string | null;
          last_storm_kind?: string | null;
          last_storm_magnitude?: number | null;
          last_storm_miles?: number | null;
          last_reroof_on?: string | null;
          last_reroof_by?: string | null;
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
      invoice_lines: {
        Row: {
          cost_rate: number;
          cost_total: number;
          description: string;
          id: number;
          invoice_id: string;
          kind: string;
          on_date: string | null;
          qty: number;
          rate: number;
          sort: number;
          source: string | null;
          taxable: boolean;
          total: number;
          unit: string;
        };
        Insert: {
          cost_rate?: number;
          cost_total?: number;
          description: string;
          id?: number;
          invoice_id: string;
          kind: string;
          on_date?: string | null;
          qty?: number;
          rate?: number;
          sort?: number;
          source?: string | null;
          taxable?: boolean;
          total?: number;
          unit?: string;
        };
        Update: {
          cost_rate?: number;
          cost_total?: number;
          description?: string;
          id?: number;
          invoice_id?: string;
          kind?: string;
          on_date?: string | null;
          qty?: number;
          rate?: number;
          sort?: number;
          source?: string | null;
          taxable?: boolean;
          total?: number;
          unit?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
        ];
      };
      invoices: {
        Row: {
          bill_to: Json;
          cost_total: number;
          created_at: string;
          created_by: string | null;
          description: string | null;
          display_number: string | null;
          due_date: string | null;
          finalized_at: string | null;
          id: string;
          invoice_date: string;
          job_code: string | null;
          number: number | null;
          paid_amount: number;
          paid_method: string | null;
          paid_on: string | null;
          paid_ref: string | null;
          payment_terms: string | null;
          pdf_path: string | null;
          po_number: string | null;
          property: Json;
          sage_exported_at: string | null;
          sent_at: string | null;
          sent_to: Json | null;
          service_job_id: string;
          status: string;
          subtotal: number;
          tax_amount: number;
          tax_rate: number;
          total: number;
          updated_at: string;
          updated_by_name: string | null;
        };
        Insert: {
          bill_to?: Json;
          cost_total?: number;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          display_number?: string | null;
          due_date?: string | null;
          finalized_at?: string | null;
          id?: string;
          invoice_date?: string;
          job_code?: string | null;
          number?: number | null;
          paid_amount?: number;
          paid_method?: string | null;
          paid_on?: string | null;
          paid_ref?: string | null;
          payment_terms?: string | null;
          pdf_path?: string | null;
          po_number?: string | null;
          property?: Json;
          sage_exported_at?: string | null;
          sent_at?: string | null;
          sent_to?: Json | null;
          service_job_id: string;
          status?: string;
          subtotal?: number;
          tax_amount?: number;
          tax_rate?: number;
          total?: number;
          updated_at?: string;
          updated_by_name?: string | null;
        };
        Update: {
          bill_to?: Json;
          cost_total?: number;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          display_number?: string | null;
          due_date?: string | null;
          finalized_at?: string | null;
          id?: string;
          invoice_date?: string;
          job_code?: string | null;
          number?: number | null;
          paid_amount?: number;
          paid_method?: string | null;
          paid_on?: string | null;
          paid_ref?: string | null;
          payment_terms?: string | null;
          pdf_path?: string | null;
          po_number?: string | null;
          property?: Json;
          sage_exported_at?: string | null;
          sent_at?: string | null;
          sent_to?: Json | null;
          service_job_id?: string;
          status?: string;
          subtotal?: number;
          tax_amount?: number;
          tax_rate?: number;
          total?: number;
          updated_at?: string;
          updated_by_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "invoices_service_job_id_fkey";
            columns: ["service_job_id"];
            isOneToOne: false;
            referencedRelation: "service_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      inspection_checklist_items: {
        Row: {
          created_at: string;
          id: string;
          label: string;
          sort: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          label: string;
          sort?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          label?: string;
          sort?: number;
          updated_at?: string;
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
          service_job_id: string | null;
          service_job_name: string | null;
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
          service_job_id?: string | null;
          service_job_name?: string | null;
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
          service_job_id?: string | null;
          service_job_name?: string | null;
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
      notifications: {
        Row: {
          body: string | null;
          created_at: string;
          email_error: string | null;
          email_sent_at: string | null;
          followup_id: string | null;
          id: number;
          kind: string;
          push_error: string | null;
          push_sent_at: string | null;
          read_at: string | null;
          title: string;
          url: string | null;
          user_id: string;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          email_error?: string | null;
          email_sent_at?: string | null;
          followup_id?: string | null;
          id?: number;
          kind: string;
          push_error?: string | null;
          push_sent_at?: string | null;
          read_at?: string | null;
          title: string;
          url?: string | null;
          user_id: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          email_error?: string | null;
          email_sent_at?: string | null;
          followup_id?: string | null;
          id?: number;
          kind?: string;
          push_error?: string | null;
          push_sent_at?: string | null;
          read_at?: string | null;
          title?: string;
          url?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_followup_id_fkey";
            columns: ["followup_id"];
            isOneToOne: false;
            referencedRelation: "crm_followups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
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
          default_bill_rate: number | null;
          email: string;
          full_name: string | null;
          id: string;
          notify_email: boolean;
          notify_push: boolean;
          role: string;
          technician: boolean;
          updated_at: string;
        };
        Insert: {
          access?: string[];
          commission_pct?: number;
          created_at?: string;
          default_bill_rate?: number | null;
          email: string;
          full_name?: string | null;
          id: string;
          notify_email?: boolean;
          notify_push?: boolean;
          role?: string;
          technician?: boolean;
          updated_at?: string;
        };
        Update: {
          access?: string[];
          commission_pct?: number;
          created_at?: string;
          default_bill_rate?: number | null;
          email?: string;
          full_name?: string | null;
          id?: string;
          notify_email?: boolean;
          notify_push?: boolean;
          role?: string;
          technician?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          auth: string;
          created_at: string;
          endpoint: string;
          failed_at: string | null;
          id: number;
          last_used_at: string | null;
          p256dh: string;
          user_agent: string | null;
          user_id: string;
        };
        Insert: {
          auth: string;
          created_at?: string;
          endpoint: string;
          failed_at?: string | null;
          id?: number;
          last_used_at?: string | null;
          p256dh: string;
          user_agent?: string | null;
          user_id: string;
        };
        Update: {
          auth?: string;
          created_at?: string;
          endpoint?: string;
          failed_at?: string | null;
          id?: number;
          last_used_at?: string | null;
          p256dh?: string;
          user_agent?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
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
      repair_templates: {
        Row: {
          active: boolean;
          category: string | null;
          centerpoint_template_id: string | null;
          created_at: string;
          description: string | null;
          favorite: boolean;
          id: string;
          name: string;
          unit: string;
          unit_price: number | null;
          updated_at: string;
          usage_count: number;
          work_completed: string | null;
        };
        Insert: {
          active?: boolean;
          category?: string | null;
          centerpoint_template_id?: string | null;
          created_at?: string;
          description?: string | null;
          favorite?: boolean;
          id?: string;
          name: string;
          unit?: string;
          unit_price?: number | null;
          updated_at?: string;
          usage_count?: number;
          work_completed?: string | null;
        };
        Update: {
          active?: boolean;
          category?: string | null;
          centerpoint_template_id?: string | null;
          created_at?: string;
          description?: string | null;
          favorite?: boolean;
          id?: string;
          name?: string;
          unit?: string;
          unit_price?: number | null;
          updated_at?: string;
          usage_count?: number;
          work_completed?: string | null;
        };
        Relationships: [];
      };
      reroof_permits: {
        Row: {
          address: string | null;
          building_id: string | null;
          city: string | null;
          contractor: string | null;
          cost: number | null;
          description: string | null;
          first_seen_at: string;
          id: string;
          issued_on: string;
          last_seen_at: string;
          lat: number | null;
          lng: number | null;
          match_method: string | null;
          matched_at: string | null;
          permit_no: string;
          raw: Json;
          roof_id: string | null;
          roof_type: string | null;
          source: string;
          sqft: number | null;
          state: string;
        };
        Insert: {
          address?: string | null;
          building_id?: string | null;
          city?: string | null;
          contractor?: string | null;
          cost?: number | null;
          description?: string | null;
          first_seen_at?: string;
          id?: string;
          issued_on: string;
          last_seen_at?: string;
          lat?: number | null;
          lng?: number | null;
          match_method?: string | null;
          matched_at?: string | null;
          permit_no: string;
          raw?: Json;
          roof_id?: string | null;
          roof_type?: string | null;
          source: string;
          sqft?: number | null;
          state?: string;
        };
        Update: {
          address?: string | null;
          building_id?: string | null;
          city?: string | null;
          contractor?: string | null;
          cost?: number | null;
          description?: string | null;
          first_seen_at?: string;
          id?: string;
          issued_on?: string;
          last_seen_at?: string;
          lat?: number | null;
          lng?: number | null;
          match_method?: string | null;
          matched_at?: string | null;
          permit_no?: string;
          raw?: Json;
          roof_id?: string | null;
          roof_type?: string | null;
          source?: string;
          sqft?: number | null;
          state?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reroof_permits_building_id_fkey";
            columns: ["building_id"];
            isOneToOne: false;
            referencedRelation: "buildings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reroof_permits_roof_id_fkey";
            columns: ["roof_id"];
            isOneToOne: false;
            referencedRelation: "roofs";
            referencedColumns: ["id"];
          },
        ];
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
      service_job_events: {
        Row: {
          at: string;
          by_name: string | null;
          by_user: string | null;
          field_status: string | null;
          id: number;
          kind: string;
          meta: Json | null;
          note: string | null;
          service_job_id: string;
          stage: string | null;
        };
        Insert: {
          at?: string;
          by_name?: string | null;
          by_user?: string | null;
          field_status?: string | null;
          id?: number;
          kind: string;
          meta?: Json | null;
          note?: string | null;
          service_job_id: string;
          stage?: string | null;
        };
        Update: {
          at?: string;
          by_name?: string | null;
          by_user?: string | null;
          field_status?: string | null;
          id?: number;
          kind?: string;
          meta?: Json | null;
          note?: string | null;
          service_job_id?: string;
          stage?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "service_job_events_service_job_id_fkey";
            columns: ["service_job_id"];
            isOneToOne: false;
            referencedRelation: "service_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      service_job_photos: {
        Row: {
          annotations: Json | null;
          by_user: string | null;
          created_at: string;
          file_name: string | null;
          file_size: number | null;
          id: string;
          lat: number | null;
          lng: number | null;
          repair_id: string | null;
          role: string;
          service_job_id: string;
          storage_path: string;
          taken_at: string | null;
        };
        Insert: {
          annotations?: Json | null;
          by_user?: string | null;
          created_at?: string;
          file_name?: string | null;
          file_size?: number | null;
          id?: string;
          lat?: number | null;
          lng?: number | null;
          repair_id?: string | null;
          role?: string;
          service_job_id: string;
          storage_path: string;
          taken_at?: string | null;
        };
        Update: {
          annotations?: Json | null;
          by_user?: string | null;
          created_at?: string;
          file_name?: string | null;
          file_size?: number | null;
          id?: string;
          lat?: number | null;
          lng?: number | null;
          repair_id?: string | null;
          role?: string;
          service_job_id?: string;
          storage_path?: string;
          taken_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "service_job_photos_repair_id_fkey";
            columns: ["repair_id"];
            isOneToOne: false;
            referencedRelation: "service_job_repairs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_job_photos_service_job_id_fkey";
            columns: ["service_job_id"];
            isOneToOne: false;
            referencedRelation: "service_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      service_job_repairs: {
        Row: {
          completed_on: string;
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
          print_on_invoice: boolean;
          problem_text: string | null;
          quantity: number;
          repair_template_id: string | null;
          resolution_text: string | null;
          service_job_id: string;
          sort: number;
          unit: string;
          updated_at: string;
        };
        Insert: {
          completed_on?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name: string;
          print_on_invoice?: boolean;
          problem_text?: string | null;
          quantity?: number;
          repair_template_id?: string | null;
          resolution_text?: string | null;
          service_job_id: string;
          sort?: number;
          unit?: string;
          updated_at?: string;
        };
        Update: {
          completed_on?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name?: string;
          print_on_invoice?: boolean;
          problem_text?: string | null;
          quantity?: number;
          repair_template_id?: string | null;
          resolution_text?: string | null;
          service_job_id?: string;
          sort?: number;
          unit?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_job_repairs_repair_template_id_fkey";
            columns: ["repair_template_id"];
            isOneToOne: false;
            referencedRelation: "repair_templates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_job_repairs_service_job_id_fkey";
            columns: ["service_job_id"];
            isOneToOne: false;
            referencedRelation: "service_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      service_job_techs: {
        Row: {
          bill_rate: number | null;
          created_at: string | null;
          id: string;
          service_job_id: string | null;
          sort: number;
          technician_id: string | null;
        };
        Insert: {
          bill_rate?: number | null;
          created_at?: string | null;
          id?: string;
          service_job_id?: string | null;
          sort?: number;
          technician_id?: string | null;
        };
        Update: {
          bill_rate?: number | null;
          created_at?: string | null;
          id?: string;
          service_job_id?: string | null;
          sort?: number;
          technician_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "service_job_techs_service_job_id_fkey";
            columns: ["service_job_id"];
            isOneToOne: false;
            referencedRelation: "service_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_job_techs_technician_id_fkey";
            columns: ["technician_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      service_jobs: {
        Row: {
          account_id: string | null;
          assigned_at: string | null;
          contacted_at: string | null;
          centerpoint_invoice: string | null;
          centerpoint_ticket: string | null;
          checked_in_with: string | null;
          checked_out_with: string | null;
          closing_notes: string | null;
          completed_at: string | null;
          contact_id: string | null;
          created_at: string;
          created_by: string | null;
          crew_confirmed_at: string | null;
          customer_name: string;
          deleted_at: string | null;
          description: string;
          en_route_at: string | null;
          field_status: string | null;
          from_job_id: string | null;
          helper_count: number;
          id: string;
          inspection: Json | null;
          invoice_id: string | null;
          job_number: string | null;
          labor_rate_kind: string;
          notes: string | null;
          number: number;
          on_site_at: string | null;
          po_number: string | null;
          recommend_new_roof: boolean;
          scheduled_date: string | null;
          service_type: string;
          signature_path: string | null;
          signed_at: string | null;
          signed_by: string | null;
          site_address: string | null;
          site_id: string | null;
          site_name: string | null;
          stage: string;
          technician_id: string | null;
          updated_at: string;
          updated_by_name: string | null;
        };
        Insert: {
          account_id?: string | null;
          assigned_at?: string | null;
          contacted_at?: string | null;
          centerpoint_invoice?: string | null;
          centerpoint_ticket?: string | null;
          checked_in_with?: string | null;
          checked_out_with?: string | null;
          closing_notes?: string | null;
          completed_at?: string | null;
          contact_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          crew_confirmed_at?: string | null;
          customer_name?: string;
          deleted_at?: string | null;
          description?: string;
          en_route_at?: string | null;
          field_status?: string | null;
          from_job_id?: string | null;
          helper_count?: number;
          id?: string;
          inspection?: Json | null;
          invoice_id?: string | null;
          job_number?: string | null;
          labor_rate_kind?: string;
          notes?: string | null;
          number?: number;
          on_site_at?: string | null;
          po_number?: string | null;
          recommend_new_roof?: boolean;
          scheduled_date?: string | null;
          service_type?: string;
          signature_path?: string | null;
          signed_at?: string | null;
          signed_by?: string | null;
          site_address?: string | null;
          site_id?: string | null;
          site_name?: string | null;
          stage?: string;
          technician_id?: string | null;
          updated_at?: string;
          updated_by_name?: string | null;
        };
        Update: {
          account_id?: string | null;
          assigned_at?: string | null;
          contacted_at?: string | null;
          centerpoint_invoice?: string | null;
          centerpoint_ticket?: string | null;
          checked_in_with?: string | null;
          checked_out_with?: string | null;
          closing_notes?: string | null;
          completed_at?: string | null;
          contact_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          crew_confirmed_at?: string | null;
          customer_name?: string;
          deleted_at?: string | null;
          description?: string;
          en_route_at?: string | null;
          field_status?: string | null;
          from_job_id?: string | null;
          helper_count?: number;
          id?: string;
          inspection?: Json | null;
          invoice_id?: string | null;
          job_number?: string | null;
          labor_rate_kind?: string;
          notes?: string | null;
          number?: number;
          on_site_at?: string | null;
          po_number?: string | null;
          recommend_new_roof?: boolean;
          scheduled_date?: string | null;
          service_type?: string;
          signature_path?: string | null;
          signed_at?: string | null;
          signed_by?: string | null;
          site_address?: string | null;
          site_id?: string | null;
          site_name?: string | null;
          stage?: string;
          technician_id?: string | null;
          updated_at?: string;
          updated_by_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "service_jobs_from_job_id_fkey";
            columns: ["from_job_id"];
            isOneToOne: false;
            referencedRelation: "service_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_jobs_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "crm_contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_jobs_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "crm_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_jobs_site_id_fkey";
            columns: ["site_id"];
            isOneToOne: false;
            referencedRelation: "crm_sites";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_jobs_technician_id_fkey";
            columns: ["technician_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      service_rates: {
        Row: {
          bill_rate: number;
          cost_rate: number;
          id: number;
          rate_kind: string;
          role: string;
          time_kind: string;
          updated_at: string;
        };
        Insert: {
          bill_rate?: number;
          cost_rate?: number;
          id?: number;
          rate_kind: string;
          role: string;
          time_kind: string;
          updated_at?: string;
        };
        Update: {
          bill_rate?: number;
          cost_rate?: number;
          id?: number;
          rate_kind?: string;
          role?: string;
          time_kind?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      service_settings: {
        Row: {
          email_message: string;
          email_subject: string;
          id: number;
          invoice_contact: string | null;
          material_markup: number;
          payment_terms: string;
          tax_rate: number;
          updated_at: string;
        };
        Insert: {
          email_message?: string;
          email_subject?: string;
          id?: number;
          invoice_contact?: string | null;
          material_markup?: number;
          payment_terms?: string;
          tax_rate?: number;
          updated_at?: string;
        };
        Update: {
          email_message?: string;
          email_subject?: string;
          id?: number;
          invoice_contact?: string | null;
          material_markup?: number;
          payment_terms?: string;
          tax_rate?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      service_time_entries: {
        Row: {
          created_at: string;
          created_by: string | null;
          ended_at: string | null;
          helper_count: number;
          hours: number;
          id: number;
          kind: string;
          note: string | null;
          on_date: string;
          service_job_id: string;
          source: string;
          started_at: string | null;
          technician_id: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          ended_at?: string | null;
          helper_count?: number;
          hours: number;
          id?: number;
          kind: string;
          note?: string | null;
          on_date?: string;
          service_job_id: string;
          source?: string;
          started_at?: string | null;
          technician_id?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          ended_at?: string | null;
          helper_count?: number;
          hours?: number;
          id?: number;
          kind?: string;
          note?: string | null;
          on_date?: string;
          service_job_id?: string;
          source?: string;
          started_at?: string | null;
          technician_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_time_entries_service_job_id_fkey";
            columns: ["service_job_id"];
            isOneToOne: false;
            referencedRelation: "service_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_time_entries_technician_id_fkey";
            columns: ["technician_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
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
      lead_settings: {
        Row: {
          id: number;
          last_fetch_at: string | null;
          last_fetch_note: string | null;
          last_fetch_problems: string[] | null;
          louisville_days: number;
          louisville_min_sqft: number;
          louisville_types: string[];
          nashville_min_cost: number;
          nashville_types: string[];
          roof_keywords: string[];
          source_fetched_at: Json;
          updated_at: string;
        };
        Insert: {
          id?: number;
          last_fetch_at?: string | null;
          last_fetch_note?: string | null;
          last_fetch_problems?: string[] | null;
          louisville_days?: number;
          louisville_min_sqft?: number;
          louisville_types?: string[];
          nashville_min_cost?: number;
          nashville_types?: string[];
          roof_keywords?: string[];
          source_fetched_at?: Json;
          updated_at?: string;
        };
        Update: {
          id?: number;
          last_fetch_at?: string | null;
          last_fetch_note?: string | null;
          last_fetch_problems?: string[] | null;
          louisville_days?: number;
          louisville_min_sqft?: number;
          louisville_types?: string[];
          nashville_min_cost?: number;
          nashville_types?: string[];
          roof_keywords?: string[];
          source_fetched_at?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      leads: {
        Row: {
          address: string | null;
          agency: string | null;
          bid_at: string | null;
          building_id: string | null;
          city: string | null;
          contact: string | null;
          contractor: string | null;
          county: string | null;
          details: Json | null;
          details_read_at: string | null;
          external_id: string;
          first_seen_at: string;
          gone_at: string | null;
          id: string;
          is_roof: boolean;
          issued_on: string | null;
          last_seen_at: string;
          lat: number | null;
          lng: number | null;
          location: string | null;
          note: string | null;
          prebid_at: string | null;
          project_cost: number | null;
          project_type: string | null;
          raw: Json | null;
          source: string;
          sqft: number | null;
          state: string;
          status: string;
          status_at: string | null;
          status_by_name: string | null;
          title: string;
          url: string | null;
        };
        Insert: {
          address?: string | null;
          agency?: string | null;
          bid_at?: string | null;
          building_id?: string | null;
          city?: string | null;
          contact?: string | null;
          contractor?: string | null;
          county?: string | null;
          details?: Json | null;
          details_read_at?: string | null;
          external_id: string;
          first_seen_at?: string;
          gone_at?: string | null;
          id?: string;
          is_roof?: boolean;
          issued_on?: string | null;
          last_seen_at?: string;
          lat?: number | null;
          lng?: number | null;
          location?: string | null;
          note?: string | null;
          prebid_at?: string | null;
          project_cost?: number | null;
          project_type?: string | null;
          raw?: Json | null;
          source: string;
          sqft?: number | null;
          state?: string;
          status?: string;
          status_at?: string | null;
          status_by_name?: string | null;
          title: string;
          url?: string | null;
        };
        Update: {
          address?: string | null;
          agency?: string | null;
          bid_at?: string | null;
          building_id?: string | null;
          city?: string | null;
          contact?: string | null;
          contractor?: string | null;
          county?: string | null;
          details?: Json | null;
          details_read_at?: string | null;
          external_id?: string;
          first_seen_at?: string;
          gone_at?: string | null;
          id?: string;
          is_roof?: boolean;
          issued_on?: string | null;
          last_seen_at?: string;
          lat?: number | null;
          lng?: number | null;
          location?: string | null;
          note?: string | null;
          prebid_at?: string | null;
          project_cost?: number | null;
          project_type?: string | null;
          raw?: Json | null;
          source?: string;
          sqft?: number | null;
          state?: string;
          status?: string;
          status_at?: string | null;
          status_by_name?: string | null;
          title?: string;
          url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "leads_building_id_fkey";
            columns: ["building_id"];
            isOneToOne: false;
            referencedRelation: "buildings";
            referencedColumns: ["id"];
          },
        ];
      };
      storm_reports: {
        Row: {
          comments: string | null;
          county: string | null;
          fetched_at: string;
          id: number;
          kind: string;
          lat: number;
          lng: number;
          location: string | null;
          magnitude: number | null;
          report_date: string;
          report_time: string;
          state: string;
        };
        Insert: {
          comments?: string | null;
          county?: string | null;
          fetched_at?: string;
          id?: number;
          kind: string;
          lat: number;
          lng: number;
          location?: string | null;
          magnitude?: number | null;
          report_date: string;
          report_time?: string;
          state: string;
        };
        Update: {
          comments?: string | null;
          county?: string | null;
          fetched_at?: string;
          id?: number;
          kind?: string;
          lat?: number;
          lng?: number;
          location?: string | null;
          magnitude?: number | null;
          report_date?: string;
          report_time?: string;
          state?: string;
        };
        Relationships: [];
      };
      storm_settings: {
        Row: {
          hail_radius_mi: number;
          id: number;
          last_fetch_at: string | null;
          last_fetch_note: string | null;
          min_hail_in: number;
          min_wind_mph: number;
          states: string[];
          tornado_radius_mi: number;
          updated_at: string;
          wind_radius_mi: number;
          window_days: number;
        };
        Insert: {
          hail_radius_mi?: number;
          id?: number;
          last_fetch_at?: string | null;
          last_fetch_note?: string | null;
          min_hail_in?: number;
          min_wind_mph?: number;
          states?: string[];
          tornado_radius_mi?: number;
          updated_at?: string;
          wind_radius_mi?: number;
          window_days?: number;
        };
        Update: {
          hail_radius_mi?: number;
          id?: number;
          last_fetch_at?: string | null;
          last_fetch_note?: string | null;
          min_hail_in?: number;
          min_wind_mph?: number;
          states?: string[];
          tornado_radius_mi?: number;
          updated_at?: string;
          wind_radius_mi?: number;
          window_days?: number;
        };
        Relationships: [];
      };
      takeoffs: {
        Row: {
          account_id: string | null;
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
          updated_by_name: string | null;
        };
        Insert: {
          account_id?: string | null;
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
          updated_by_name?: string | null;
        };
        Update: {
          account_id?: string | null;
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
          updated_by_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "takeoffs_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "crm_accounts";
            referencedColumns: ["id"];
          },
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
          account_id: string | null;
          account_name: string | null;
          all_day: boolean;
          assignee: string | null;
          assignee_name: string | null;
          attendees: string[];
          building_id: string | null;
          created_at: string;
          created_by: string | null;
          created_by_name: string | null;
          details: string | null;
          done_at: string | null;
          due_at: string | null;
          due_date: string | null;
          external_emails: string[];
          id: string;
          notified_created_at: string | null;
          notified_morning_at: string | null;
          notified_overdue_at: string | null;
          notify_error: string | null;
          site_id: string | null;
          site_name: string | null;
          source: string;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          account_id?: string | null;
          account_name?: string | null;
          all_day?: boolean;
          assignee?: string | null;
          assignee_name?: string | null;
          attendees?: string[];
          building_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          created_by_name?: string | null;
          details?: string | null;
          done_at?: string | null;
          due_at?: string | null;
          due_date?: string | null;
          external_emails?: string[];
          id?: string;
          notified_created_at?: string | null;
          notified_morning_at?: string | null;
          notified_overdue_at?: string | null;
          notify_error?: string | null;
          site_id?: string | null;
          site_name?: string | null;
          source?: string;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string | null;
          account_name?: string | null;
          all_day?: boolean;
          assignee?: string | null;
          assignee_name?: string | null;
          attendees?: string[];
          building_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          created_by_name?: string | null;
          details?: string | null;
          done_at?: string | null;
          due_at?: string | null;
          due_date?: string | null;
          external_emails?: string[];
          id?: string;
          notified_created_at?: string | null;
          notified_morning_at?: string | null;
          notified_overdue_at?: string | null;
          notify_error?: string | null;
          site_id?: string | null;
          site_name?: string | null;
          source?: string;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "crm_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_building_id_fkey";
            columns: ["building_id"];
            isOneToOne: false;
            referencedRelation: "buildings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_site_id_fkey";
            columns: ["site_id"];
            isOneToOne: false;
            referencedRelation: "crm_sites";
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
      vehicle_drivers: {
        Row: {
          created_at: string;
          created_by: string | null;
          from_date: string;
          id: number;
          location_id: string;
          to_date: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          from_date?: string;
          id?: number;
          location_id: string;
          to_date?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          from_date?: string;
          id?: number;
          location_id?: string;
          to_date?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vehicle_drivers_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "inventory_locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vehicle_drivers_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
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
        /** state: "TN", or "KY" for every row not marked TN (20260930060000). */
        Returns: { county: string; state: string; n: number }[];
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
      inventory_job_options: {
        Args: never;
        Returns: {
          id: string;
          kind: string;
          name: string;
          status: string;
          updated_at: string;
        }[];
      };
      is_admin: { Args: never; Returns: boolean };
      is_technician: { Args: never; Returns: boolean };
      is_manager: { Args: never; Returns: boolean };
      stamp_dispatch: { Args: never; Returns: undefined };
      building_county_counts_storm: {
        Args: never;
        Returns: { county: string; state: string; n: number }[];
      };
      match_storm_reports: {
        Args: never;
        Returns: { reports_in_window: number; new_hits: number; buildings_flagged: number }[];
      };
      miles_between: {
        Args: { lat1: number; lng1: number; lat2: number; lng2: number };
        Returns: number;
      };
      prospect_user_ids: { Args: never; Returns: string[] };
      stamp_storm_fetch: { Args: { note: string }; Returns: undefined };
      stamp_lead_fetch: {
        Args: { note: string; problems?: string[] | null };
        Returns: undefined;
      };
      crm_untouched: {
        Args: never;
        Returns: {
          kind: string;
          item_id: string;
          title: string;
          url: string;
          account_name: string | null;
          assignee_id: string | null;
          assignee_name: string | null;
          assigned_at: string | null;
          limit_days: number;
        }[];
      };
      escalation_recipients: { Args: never; Returns: string[] };
      notify_recipients: {
        Args: { ids: string[] };
        Returns: {
          email: string;
          full_name: string | null;
          id: string;
          notify_email: boolean;
          notify_push: boolean;
        }[];
      };
      technician_bill_rates: {
        Args: never;
        Returns: {
          default_bill_rate: number;
          id: string;
        }[];
      };
      assignable_users: {
        Args: never;
        Returns: {
          email: string;
          full_name: string | null;
          id: string;
        }[];
      };
      crm_user_options: {
        Args: never;
        Returns: {
          email: string;
          full_name: string | null;
          id: string;
        }[];
      };
      technician_options: {
        Args: never;
        Returns: {
          email: string;
          full_name: string | null;
          id: string;
          technician: boolean;
        }[];
      };
      service_aerial_address_candidates: {
        Args: { p_house: string; p_street_word: string; p_limit?: number };
        Returns: {
          address: string;
          building_id: string | null;
          city: string | null;
          id: string;
          lat: number | null;
          lng: number | null;
          source: string;
          state: string | null;
          zip: string | null;
        }[];
      };
      service_aerial_buildings_near: {
        Args: { p_lat: number; p_lng: number; p_radius_m?: number };
        Returns: {
          address1: string;
          centroid_lat: number | null;
          centroid_lng: number | null;
          city: string | null;
          footprint: Json | null;
          id: string;
          roof_sqft: number | null;
          state: string;
          zip: string | null;
        }[];
      };
      work_people: {
        Args: never;
        Returns: {
          email: string;
          full_name: string | null;
          id: string;
          technician: boolean;
        }[];
      };
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
