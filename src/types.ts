export interface EnrichedHoldingRow {
  id: number;
  import_id: number;
  scheme_name: string;
  asset_class: string;
  tier: string;
  units: number;
  statement_nav: number;
  statement_nav_date: string | null;
  market_value: number;
  net_contribution: number | null;
  scheme_code: string | null;
  as_of_date: string;
  subscriber_name: string;
  pran: string;
  member_id: string;
  financial_year: string;
  latest_nav: number | null;
  latest_nav_date: string | null;
}

export interface EnrichedTransactionRow {
  id: number;
  import_id: number;
  txn_date: string;
  scheme_name: string;
  description: string;
  narration_kind: string;
  amount: number | null;
  nav: number | null;
  units: number | null;
  tier: string;
  subscriber_name: string;
}

export interface YearListRow {
  id: number;
  tier: string;
  financial_year: string;
  file_name: string;
  as_of_date: string;
  holdings_value: number;
  subscriber_name: string;
  pran: string;
  xirr: number | null;
  member_id: string;
}

export interface PortfolioPosition {
  member_id: string;
  member: string;
  tier: string;
  scheme_name: string;
  scheme_code: string | null;
  asset_class: string;
  units: number;
  current_value: number;
  net_invested: number | null;
  invested_complete: boolean;
  reported_xirr: number | null;
  calculated_xirr: number | null;
  as_of_date: string;
  nav_date: string;
}

export interface CalculatedReturnRow {
  member_id: string;
  member: string;
  tier: string | null;
  calculated_xirr: number | null;
  start_date?: string;
  end_date?: string;
}

export interface ReportedReturnRow {
  member_id: string;
  member: string;
  tier: string;
  reported_xirr: number | null;
  as_of_date: string;
}

export interface FundNav {
  scheme_code: string;
  scheme_name: string;
  nav: number;
  nav_date: string;
  fetched_at?: string;
}

export interface PortfolioNotes {
  content: string;
  updated_at: string | null;
}

export type AlertAssetClass = "Equity" | "Corporate" | "Government" | "Alternative";

export interface PortfolioThresholds {
  min_gain_inr: number | null;
  target_asset_class: AlertAssetClass;
  target_allocation_pct: number | null;
  max_deviation_pct: number;
  updated_at: string | null;
}

export interface XirrTrendPoint {
  period: string;
  as_of_date: string;
  calculated_xirr: number | null;
  statement_xirr: number | null;
}

export interface AppStatePayload {
  years: YearListRow[];
  currentHoldings: EnrichedHoldingRow[];
  holdingsByImport: Record<number, EnrichedHoldingRow[]>;
  analytics: {
    positions: PortfolioPosition[];
    members: Array<{ member_id: string; name: string }>;
    reported_xirr: ReportedReturnRow[];
    calculated_xirr: CalculatedReturnRow[];
    member_xirr?: CalculatedReturnRow[];
  };
  disclosures: unknown[];
  catalog: FundNav[];
  notes: PortfolioNotes;
  thresholds: PortfolioThresholds;
}

export interface AllocationBucketAmount {
  current_value: number;
  net_invested: number;
}

export interface AllocationRow {
  member_id: string;
  member: string;
  current_value: number;
  net_invested: number;
  invested_complete: boolean;
  categories: Record<string, AllocationBucketAmount>;
  asset_totals: Record<string, AllocationBucketAmount>;
}

export interface AllocationPayload {
  rows: AllocationRow[];
  hasPositions: boolean;
  hasVisibleRows: boolean;
}

export interface SecurityExposurePosition {
  security_name: string;
  isin: string;
  industry: string;
  instrument_type: string;
  exposure: number;
  schemes: string[];
  portfolio_weight: number;
}

export interface SecuritiesPayload {
  hasHoldings: boolean;
  hasAnyCurrentHoldings: boolean;
  hasDisclosures: boolean;
  disclosureDates: Record<string, string>;
  sourceUrls: string[];
  exposure: {
    positions: SecurityExposurePosition[];
    total_value: number;
    covered_value: number;
    coverage: number;
    unsupported: Record<string, number>;
    disclosure_date: string | null;
  };
}

export interface ParseResult {
  tier: string;
  financial_year: string;
  filename_year: string | null;
  year_mismatch: boolean;
  pran: string;
  subscriber_name: string;
  scheme_choice: string;
  generation_date: string | null;
  as_of_date: string;
  nav_date: string | null;
  period_start: string;
  period_end: string;
  holdings_value: number;
  contribution_count: number;
  total_contribution: number;
  total_withdrawal: number;
  notional_gain: number;
  charges: number;
  xirr: number | null;
  holdings: Array<{
    scheme_name: string;
    asset_class: string;
    units: number;
    statement_nav: number;
    market_value: number;
    net_contribution: number | null;
    scheme_code: string | null;
  }>;
  contributions: Array<{
    txn_date: string;
    particulars: string;
    uploaded_by: string;
    employee_amount: number;
    employer_amount: number;
    total: number;
  }>;
  transactions: Array<{
    txn_date: string;
    scheme_name: string;
    description: string;
    narration_kind: string;
    amount: number | null;
    nav: number | null;
    units: number | null;
  }>;
  fingerprint: string;
  unknown_narrations: string[];
  header_mapping: {
    fingerprint: string;
    section_headers: Record<string, string[]>;
    missing_fields: Record<string, string[]>;
  } | null;
  warnings: string[];
  needs_header_map: boolean;
}

export type ActiveView = "overview" | "allocation" | "securities" | "statements";

export interface FilterState {
  member: string | null;
  tier: string | null;
  scheme: string | null;
  year: string | null;
}
