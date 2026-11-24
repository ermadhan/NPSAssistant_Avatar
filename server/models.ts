export interface HoldingRow {
  scheme_name: string;
  asset_class: string;
  units: number;
  statement_nav: number;
  market_value: number;
  net_contribution: number | null;
  scheme_code: string | null;
}

export interface ContributionRow {
  txn_date: string; // YYYY-MM-DD
  particulars: string;
  uploaded_by: string;
  employee_amount: number;
  employer_amount: number;
  total: number;
}

export interface SchemeTransactionRow {
  txn_date: string; // YYYY-MM-DD
  scheme_name: string;
  description: string;
  narration_kind: string;
  amount: number | null;
  nav: number | null;
  units: number | null;
}

export interface HeaderMappingRequest {
  fingerprint: string;
  section_headers: Record<string, string[]>;
  missing_fields: Record<string, string[]>;
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
  as_of_date: string; // YYYY-MM-DD
  nav_date: string | null; // YYYY-MM-DD
  period_start: string; // YYYY-MM-DD
  period_end: string; // YYYY-MM-DD
  holdings_value: number;
  contribution_count: number;
  total_contribution: number;
  total_withdrawal: number;
  notional_gain: number;
  charges: number;
  xirr: number | null;
  holdings: HoldingRow[];
  contributions: ContributionRow[];
  transactions: SchemeTransactionRow[];
  fingerprint: string;
  unknown_narrations: string[];
  header_mapping: HeaderMappingRequest | null;
  warnings: string[];
  needs_header_map: boolean;
}

export interface FundNav {
  scheme_code: string;
  scheme_name: string;
  nav: number;
  nav_date: string; // YYYY-MM-DD
}

export interface SchemeMatch {
  statement_name: string;
  matches: FundNav[];
  unique: FundNav | null;
}

export interface SecurityPosition {
  scheme_asset: string;
  tier: string;
  security_name: string;
  isin: string;
  industry: string;
  instrument_type: string;
  quantity: number | null;
  market_value: number;
  portfolio_weight: number;
  rating: string;
}

export interface PortfolioDisclosure {
  fund_manager: string;
  as_of_date: string; // YYYY-MM-DD
  source_url: string;
  positions: SecurityPosition[];
}
