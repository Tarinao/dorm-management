/* Generated from the live Supabase schema (Supabase MCP generate_typescript_types, 2026-11-23),
 * then updated for migration 20261123140852_water_per_person.sql (marked "0006"; checked against regenerated types after it was applied)
 * and 20261123151116_no_water_meter.sql (marked "0007": the water reading is optional).
 * Hand edits marked "edited": move_in's p_tenant_id and p_end_date accept null
 * (the SQL function handles null; the generator cannot tell).
 * Regenerate after any schema change. */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: { PostgrestVersion: '14.18' };
  public: {
    Tables: {
      bill_extras: {
        Row: { amount: number; bill_id: string; created_at: string; id: string; label: string };
        Insert: { amount: number; bill_id: string; created_at?: string; id?: string; label: string };
        Update: { amount?: number; bill_id?: string; created_at?: string; id?: string; label?: string };
        Relationships: [
          { foreignKeyName: 'bill_extras_bill_id_fkey'; columns: ['bill_id']; isOneToOne: false; referencedRelation: 'bill_summary'; referencedColumns: ['id'] },
          { foreignKeyName: 'bill_extras_bill_id_fkey'; columns: ['bill_id']; isOneToOne: false; referencedRelation: 'bills'; referencedColumns: ['id'] },
        ];
      };
      bills: {
        Row: {
          contract_id: string | null; created_at: string; created_by: string | null; due_date: string;
          elec_amount: number | null; elec_curr: number; elec_prev: number; elec_rate: number; elec_units: number | null;
          id: string; month: string; note: string; rent: number; room_id: string;
          water_amount: number | null; water_curr: number; water_prev: number; water_units: number | null;
          water_people: number; water_per_person: number; // 0006
        };
        Insert: {
          contract_id?: string | null; created_at?: string; created_by?: string | null; due_date: string;
          elec_amount?: number | null; elec_curr?: number; elec_prev?: number; elec_rate?: number; elec_units?: number | null;
          id?: string; month: string; note?: string; rent?: number; room_id: string;
          water_amount?: number | null; water_curr?: number; water_prev?: number; water_units?: number | null;
          water_people?: number; water_per_person?: number; // 0006
        };
        Update: {
          contract_id?: string | null; created_at?: string; created_by?: string | null; due_date?: string;
          elec_amount?: number | null; elec_curr?: number; elec_prev?: number; elec_rate?: number; elec_units?: number | null;
          id?: string; month?: string; note?: string; rent?: number; room_id?: string;
          water_amount?: number | null; water_curr?: number; water_prev?: number; water_units?: number | null;
          water_people?: number; water_per_person?: number; // 0006
        };
        Relationships: [
          { foreignKeyName: 'bills_contract_id_fkey'; columns: ['contract_id']; isOneToOne: false; referencedRelation: 'contracts'; referencedColumns: ['id'] },
          { foreignKeyName: 'bills_room_id_fkey'; columns: ['room_id']; isOneToOne: false; referencedRelation: 'rooms'; referencedColumns: ['id'] },
        ];
      };
      contracts: {
        Row: {
          created_at: string; deposit: number; deposit_returned: number | null; end_date: string | null; id: string;
          monthly_rent: number; move_out_note: string; moved_out_on: string | null; room_id: string;
          start_date: string; status: string; tenant_id: string;
        };
        Insert: {
          created_at?: string; deposit?: number; deposit_returned?: number | null; end_date?: string | null; id?: string;
          monthly_rent: number; move_out_note?: string; moved_out_on?: string | null; room_id: string;
          start_date: string; status?: string; tenant_id: string;
        };
        Update: {
          created_at?: string; deposit?: number; deposit_returned?: number | null; end_date?: string | null; id?: string;
          monthly_rent?: number; move_out_note?: string; moved_out_on?: string | null; room_id?: string;
          start_date?: string; status?: string; tenant_id?: string;
        };
        Relationships: [
          { foreignKeyName: 'contracts_room_id_fkey'; columns: ['room_id']; isOneToOne: false; referencedRelation: 'rooms'; referencedColumns: ['id'] },
          { foreignKeyName: 'contracts_tenant_id_fkey'; columns: ['tenant_id']; isOneToOne: false; referencedRelation: 'tenants'; referencedColumns: ['id'] },
        ];
      };
      meter_readings: {
        Row: { created_at: string; electric: number; id: string; kind: string; month: string; read_on: string; recorded_by: string | null; room_id: string; water: number | null }; // 0007
        Insert: { created_at?: string; electric: number; id?: string; kind: string; month: string; read_on: string; recorded_by?: string | null; room_id: string; water?: number | null };
        Update: { created_at?: string; electric?: number; id?: string; kind?: string; month?: string; read_on?: string; recorded_by?: string | null; room_id?: string; water?: number | null };
        Relationships: [
          { foreignKeyName: 'meter_readings_room_id_fkey'; columns: ['room_id']; isOneToOne: false; referencedRelation: 'rooms'; referencedColumns: ['id'] },
        ];
      };
      payments: {
        Row: { amount: number; bill_id: string; created_at: string; id: string; imported: boolean; method: string | null; note: string; paid_on: string; receipt_no: string; recorded_by: string | null };
        Insert: { amount: number; bill_id: string; created_at?: string; id?: string; imported?: boolean; method?: string | null; note?: string; paid_on?: string; receipt_no?: string; recorded_by?: string | null };
        Update: { amount?: number; bill_id?: string; created_at?: string; id?: string; imported?: boolean; method?: string | null; note?: string; paid_on?: string; receipt_no?: string; recorded_by?: string | null };
        Relationships: [
          { foreignKeyName: 'payments_bill_id_fkey'; columns: ['bill_id']; isOneToOne: false; referencedRelation: 'bill_summary'; referencedColumns: ['id'] },
          { foreignKeyName: 'payments_bill_id_fkey'; columns: ['bill_id']; isOneToOne: false; referencedRelation: 'bills'; referencedColumns: ['id'] },
        ];
      };
      profiles: {
        Row: { created_at: string; email: string; full_name: string; id: string; role: string | null };
        Insert: { created_at?: string; email?: string; full_name?: string; id: string; role?: string | null };
        Update: { created_at?: string; email?: string; full_name?: string; id?: string; role?: string | null };
        Relationships: [];
      };
      rooms: {
        Row: { created_at: string; default_rent: number; floor: number | null; id: string; notes: string; number: string; status: string; water_per_person: number; occupants: number }; // 0006
        Insert: { created_at?: string; default_rent?: number; floor?: number | null; id?: string; notes?: string; number: string; status?: string; water_per_person?: number; occupants?: number };
        Update: { created_at?: string; default_rent?: number; floor?: number | null; id?: string; notes?: string; number?: string; status?: string; water_per_person?: number; occupants?: number };
        Relationships: [];
      };
      settings: {
        Row: { dorm_name: string; due_day: number; electric_rate: number; id: number; updated_at: string; water_price_old: number; water_price_new: number }; // 0006
        Insert: { dorm_name?: string; due_day?: number; electric_rate?: number; id?: number; updated_at?: string; water_price_old?: number; water_price_new?: number };
        Update: { dorm_name?: string; due_day?: number; electric_rate?: number; id?: number; updated_at?: string; water_price_old?: number; water_price_new?: number };
        Relationships: [];
      };
      tenants: {
        Row: { created_at: string; emergency_name: string; emergency_phone: string; full_name: string; id: string; id_card_ref: string; notes: string; phone: string };
        Insert: { created_at?: string; emergency_name?: string; emergency_phone?: string; full_name: string; id?: string; id_card_ref?: string; notes?: string; phone?: string };
        Update: { created_at?: string; emergency_name?: string; emergency_phone?: string; full_name?: string; id?: string; id_card_ref?: string; notes?: string; phone?: string };
        Relationships: [];
      };
    };
    Views: {
      bill_summary: {
        Row: {
          balance: number | null; contract_id: string | null; created_at: string | null; due_date: string | null;
          elec_amount: number | null; elec_curr: number | null; elec_prev: number | null; elec_rate: number | null; elec_units: number | null;
          extras_total: number | null; id: string | null; is_overdue: boolean | null; last_paid_on: string | null; month: string | null;
          note: string | null; paid: number | null; rent: number | null; room_id: string | null; room_number: string | null;
          status: string | null; total: number | null;
          water_amount: number | null; water_curr: number | null; water_prev: number | null; water_units: number | null;
          water_people: number | null; water_per_person: number | null; // 0006
        };
        Relationships: [
          { foreignKeyName: 'bills_contract_id_fkey'; columns: ['contract_id']; isOneToOne: false; referencedRelation: 'contracts'; referencedColumns: ['id'] },
          { foreignKeyName: 'bills_room_id_fkey'; columns: ['room_id']; isOneToOne: false; referencedRelation: 'rooms'; referencedColumns: ['id'] },
        ];
      };
    };
    Functions: {
      app_role: { Args: never; Returns: string };
      generate_bills: { Args: { p_month: string }; Returns: { new_bill_id: string; outcome: string; room_number: string }[] };
      is_admin: { Args: never; Returns: boolean };
      is_member: { Args: never; Returns: boolean };
      move_in: {
        Args: {
          p_deposit: number; p_electric: number; p_emergency_name: string; p_emergency_phone: string;
          p_end_date: string | null; // edited
          p_full_name: string; p_id_card_ref: string; p_monthly_rent: number; p_phone: string; p_room_id: string;
          p_start_date: string;
          p_tenant_id: string | null; // edited
          p_water: number | null; // 0007
          p_water_per_person: number | null; // 0006
          p_occupants: number | null; // 0006
        };
        Returns: string;
      };
      move_out: {
        Args: { p_contract_id: string; p_date: string; p_deposit_returned: number; p_electric: number; p_note: string; p_room_status?: string; p_water: number | null }; // 0007
        Returns: undefined;
      };
      set_room_prices: { // 0006
        Args: { p_room_id: string; p_rent: number; p_water_per_person: number; p_occupants: number };
        Returns: undefined;
      };
      save_monthly_reading: {
        Args: { p_electric: number; p_month: string; p_read_on: string; p_room_id: string; p_water: number | null }; // 0007
        Returns: string;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

type PublicSchema = Database['public'];
export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row'];
export type Views<T extends keyof PublicSchema['Views']> = PublicSchema['Views'][T]['Row'];
