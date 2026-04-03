/**
 * Main Indicator Items - TypeScript Interfaces
 * Defines data structures for main indicator item management
 */

export interface MainIndicatorRecord {
  id: number;
  main_ind_id: number;
  item_id?: number; // NULL = aggregate value
  fiscal_year: number;
  report_month: number;
  report_year_ad: number;
  kpi_value: number | string;
  is_visible: 0 | 1;
  amphoe_name?: string;
  recorded_by?: number;
  recorded_at?: string;
  item_name?: string; // joined from kpi_items
  item_unit?: string;
  main_ind_name?: string; // joined from kpi_main_indicators
}

export interface MainIndicatorItemConfig {
  id: number;
  main_ind_id: number;
  item_id: number;
  agenda_field?: string; // 'target', 'result', 'sub_result', etc.
  field_index: number; // For layout control
  sort_order: number; // 0 = hidden, >0 = display order
  is_hidden: 0 | 1 | 2; // 0 = can hide, 1 = cannot hide, 2 = hidden always
  display_name?: string; // Custom name for this indicator (overrides item name)
  created_at?: string;
  updated_at?: string;
  // Joined fields
  item_name?: string;
  item_unit?: string;
  sub_activity_name?: string;
}

export interface MainIndicatorItem {
  id: number;
  name: string;
  unit?: string;
  sub_activity_name?: string;
  sub_id: number;
  sort_order: number;
  is_hidden: 0 | 1 | 2;
  agenda_field: string;
  display_name?: string;
  // Runtime properties
  monthValues?: { [month: number]: number | null };
}

export interface MainIndicatorWithItems {
  id: number;
  name: string;
  targetLabel?: string;
  depId?: number;
  issueTitle?: string;
  // Runtime properties
  showItems: boolean;
  items: MainIndicatorItem[];
  itemsLoading: boolean;
}

export interface MainRecordChange {
  main_ind_id: number;
  item_id?: number; // optional for aggregate
  month: number;
  value: number | null;
  is_visible?: 0 | 1;
  oldValue?: number | null;
}

export interface MainIndicatorSubActivity {
  id: number;
  main_ind_id: number;
  sub_id: number;
  include_in_record: 0 | 1;
  sort_order: number;
  created_at?: string;
}

export interface MainRecordAudit {
  id: number;
  main_ind_id: number;
  item_id?: number;
  amphoe_name?: string;
  fiscal_year: number;
  report_month: number;
  old_value?: number;
  new_value?: number;
  changed_by?: number;
  changed_at: string;
}

export interface MainIndicatorSummary {
  main_ind_id: number;
  item_id?: number;
  amphoe_name?: string;
  report_month: number;
  kpi_value: number;
  is_visible: 0 | 1;
  item_name?: string;
  unit?: string;
  agenda_field?: string;
  display_name?: string;
}

export interface MainRecordRequest {
  fiscalYear: number;
  amphoe_name?: string;
  main_ind_id?: number;
  changes?: MainRecordChange[];
}

export interface MainRecordConfigRequest {
  main_ind_id: number;
  item_id: number;
  agenda_field?: string;
  field_index?: number;
  sort_order?: number;
  is_hidden?: 0 | 1 | 2;
  display_name?: string;
}

export interface MainRecordsResponse {
  success: boolean;
  count?: number;
  data?: MainIndicatorRecord[];
  error?: string;
}

export interface MainIndicatorConfigResponse {
  success: boolean;
  data?: MainIndicatorItemConfig[];
  error?: string;
}

export interface MainIndicatorItemsResponse {
  success: boolean;
  data?: MainIndicatorItem[];
  error?: string;
}
