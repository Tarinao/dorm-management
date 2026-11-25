/* Generated from the live Supabase schema (Supabase MCP generate_typescript_types, 2026-11-23),
 * then updated for migration 20261123140852_water_per_person.sql (marked "0006"; checked against regenerated types after it was applied)
 * and 20261123151116_no_water_meter.sql (marked "0007": the water reading is optional)
 * and 20261124144201_line_linking.sql (marked "0009", hand-written; applied 2026-11-24)
 * and 20261125093453_line_billing.sql (marked "0010", hand-written).
 * Hand edits marked "edited": move_in's p_tenant_id and p_end_date accept null
 * (the SQL function handles null; the generator cannot tell).
 * Regenerate after any schema change. */

/* 0009 */
type PaySettings = {
  promptpay_id: string; bank_name: string; bank_branch: string; bank_account_name: string; bank_account_number: string;
  office_location: string; office_hours: string; auto_send_enabled: boolean;
};
type TenantLine = { nickname: string; line_user_id: string | null; line_display_name: string; line_linked_at: string | null };
/* 0010 */
type BillLine = { line_sent_at: string | null; line_reminded_at: string | null; pay_method_chosen: string | null; pay_method_chosen_at: string | null };
type SlipRow = {
  id: string; line_message_id: string; line_user_id: string; tenant_id: string | null; bill_id: string | null;
  storage_path: string; qr_text: string | null; qr_ref: string | null; slip_ref: string | null; duplicate_of: string | null;
  status: string; payment_id: string | null; received_at: string; checked_by: string | null; checked_at: string | null;
};
type RunRow = { id: string; kind: string; month: string | null; ran_at: string; ran_by: string | null; summary: Json };

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
        } & BillLine; // 0010
        Insert: {
          contract_id?: string | null; created_at?: string; created_by?: string | null; due_date: string;
          elec_amount?: number | null; elec_curr?: number; elec_prev?: number; elec_rate?: number; elec_units?: number | null;
          id?: string; month: string; note?: string; rent?: number; room_id: string;
          water_amount?: number | null; water_curr?: number; water_prev?: number; water_units?: number | null;
          water_people?: number; water_per_person?: number; // 0006
        } & Partial<BillLine>;
        Update: {
          contract_id?: string | null; created_at?: string; created_by?: string | null; due_date?: string;
          elec_amount?: number | null; elec_curr?: number; elec_prev?: number; elec_rate?: number; elec_units?: number | null;
          id?: string; month?: string; note?: string; rent?: number; room_id?: string;
          water_amount?: number | null; water_curr?: number; water_prev?: number; water_units?: number | null;
          water_people?: number; water_per_person?: number; // 0006
        } & Partial<BillLine>;
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
        Row: { dorm_name: string; due_day: number; electric_rate: number; id: number; updated_at: string; water_price_old: number; water_price_new: number; summary_line_user_id: string | null } & PaySettings; // 0006, 0009, 0010
        Insert: { dorm_name?: string; due_day?: number; electric_rate?: number; id?: number; updated_at?: string; water_price_old?: number; water_price_new?: number; summary_line_user_id?: string | null } & Partial<PaySettings>;
        Update: { dorm_name?: string; due_day?: number; electric_rate?: number; id?: number; updated_at?: string; water_price_old?: number; water_price_new?: number; summary_line_user_id?: string | null } & Partial<PaySettings>;
        Relationships: [];
      };
      line_link_requests: { // 0009
        Row: {
          created_at: string; decided_at: string | null; decided_by: string | null; id: string;
          line_display_name: string; line_picture_url: string; line_user_id: string;
          room_number_typed: string; status: string; tenant_id: string | null;
        };
        Insert: {
          created_at?: string; decided_at?: string | null; decided_by?: string | null; id?: string;
          line_display_name?: string; line_picture_url?: string; line_user_id: string;
          room_number_typed: string; status?: string; tenant_id?: string | null;
        };
        Update: {
          created_at?: string; decided_at?: string | null; decided_by?: string | null; id?: string;
          line_display_name?: string; line_picture_url?: string; line_user_id?: string;
          room_number_typed?: string; status?: string; tenant_id?: string | null;
        };
        Relationships: [
          { foreignKeyName: 'line_link_requests_tenant_id_fkey'; columns: ['tenant_id']; isOneToOne: false; referencedRelation: 'tenants'; referencedColumns: ['id'] },
        ];
      };
      payment_slips: { // 0010
        Row: SlipRow;
        Insert: Partial<SlipRow> & { line_message_id: string; line_user_id: string; storage_path: string };
        Update: Partial<SlipRow>;
        Relationships: [
          { foreignKeyName: 'payment_slips_bill_id_fkey'; columns: ['bill_id']; isOneToOne: false; referencedRelation: 'bills'; referencedColumns: ['id'] },
          { foreignKeyName: 'payment_slips_bill_id_fkey'; columns: ['bill_id']; isOneToOne: false; referencedRelation: 'bill_summary'; referencedColumns: ['id'] },
          { foreignKeyName: 'payment_slips_tenant_id_fkey'; columns: ['tenant_id']; isOneToOne: false; referencedRelation: 'tenants'; referencedColumns: ['id'] },
        ];
      };
      line_send_runs: { // 0010
        Row: RunRow;
        Insert: Partial<RunRow> & { kind: string };
        Update: Partial<RunRow>;
        Relationships: [];
      };
      tenants: {
        Row: { created_at: string; emergency_name: string; emergency_phone: string; full_name: string; id: string; id_card_ref: string; notes: string; phone: string } & TenantLine; // 0009
        Insert: { created_at?: string; emergency_name?: string; emergency_phone?: string; full_name: string; id?: string; id_card_ref?: string; notes?: string; phone?: string } & Partial<TenantLine>;
        Update: { created_at?: string; emergency_name?: string; emergency_phone?: string; full_name?: string; id?: string; id_card_ref?: string; notes?: string; phone?: string } & Partial<TenantLine>;
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
          line_sent_at: string | null; line_reminded_at: string | null; pay_method_chosen: string | null; // 0010
        };
        Relationships: [
          { foreignKeyName: 'bills_contract_id_fkey'; columns: ['contract_id']; isOneToOne: false; referencedRelation: 'contracts'; referencedColumns: ['id'] },
          { foreignKeyName: 'bills_room_id_fkey'; columns: ['room_id']; isOneToOne: false; referencedRelation: 'rooms'; referencedColumns: ['id'] },
        ];
      };
    };
    Functions: {
      app_role: { Args: never; Returns: string };
      approve_line_request: { // 0009
        Args: { p_request_id: string };
        Returns: { line_user_id: string; room_number: string; tenant_full_name: string; tenant_nickname: string; line_display_name: string; previous_room: string | null }[];
      };
      reject_line_request: { Args: { p_request_id: string }; Returns: { line_user_id: string; room_number_typed: string }[] }; // 0009
      confirm_slip: { Args: { p_slip_id: string; p_amount: number; p_paid_on: string; p_note?: string }; Returns: string }; // 0010
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
