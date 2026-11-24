import * as XLSX from "xlsx";
import type { EnrichedHoldingRow, EnrichedTransactionRow } from "./db.ts";

function tierLabel(tier: string): string {
  return tier === "nps_tier1" ? "Tier 1" : "Tier 2";
}

export interface HoldingExportRecord {
  subscriber: string;
  tier: string;
  financial_year: string;
  scheme: string;
  asset_class: string;
  units: number;
  net_contribution: number | null;
  net_invested: number | null;
  invested_complete: boolean;
  calculated_xirr: number | null;
  statement_xirr: number | null;
  statement_nav: number;
  statement_nav_date: string | null;
  latest_nav: number | null;
  latest_nav_date: string | null;
  value: number;
  scheme_code: string | null;
}

export interface TransactionExportRecord {
  subscriber: string;
  tier: string;
  financial_year: string;
  date: string;
  scheme: string;
  description: string;
  kind: string;
  amount: number | null;
  nav: number | null;
  units: number | null;
}

export function holdingRecords(
  rows: Array<
    EnrichedHoldingRow & {
      net_invested?: number | null;
      invested_complete?: boolean;
      calculated_xirr?: number | null;
      reported_xirr?: number | null;
    }
  >,
): HoldingExportRecord[] {
  return rows.map((row) => {
    const units = Number(row.units);
    const latest = row.latest_nav;
    const statementNav = Number(row.statement_nav);
    const price = latest !== null ? Number(latest) : statementNav;
    return {
      subscriber: row.subscriber_name ?? "",
      tier: tierLabel(row.tier),
      financial_year: row.financial_year,
      scheme: row.scheme_name,
      asset_class: row.asset_class,
      units,
      net_contribution:
        row.net_contribution === null ? null : Number(row.net_contribution),
      net_invested:
        row.net_invested !== undefined ? row.net_invested : row.net_contribution,
      invested_complete:
        row.invested_complete !== undefined
          ? row.invested_complete
          : row.net_contribution !== null,
      calculated_xirr:
        row.calculated_xirr !== undefined ? row.calculated_xirr : null,
      statement_xirr:
        row.reported_xirr !== undefined ? row.reported_xirr : null,
      statement_nav: statementNav,
      statement_nav_date: row.statement_nav_date,
      latest_nav: latest === null ? null : Number(latest),
      latest_nav_date: row.latest_nav_date,
      value: Math.round(units * price * 100) / 100,
      scheme_code: row.scheme_code,
    };
  });
}

export function transactionRecords(
  rows: EnrichedTransactionRow[],
): TransactionExportRecord[] {
  return rows.map((row) => ({
    subscriber: row.subscriber_name ?? "",
    tier: tierLabel(row.tier),
    financial_year: row.financial_year ?? "",
    date: row.txn_date,
    scheme: row.scheme_name,
    description: row.description,
    kind: row.narration_kind,
    amount: row.amount,
    nav: row.nav,
    units: row.units,
  }));
}

export function buildExportBuffer(
  rows: Array<Record<string, unknown>>,
  format: "xlsx" | "csv",
): Buffer {
  const sheet = XLSX.utils.json_to_sheet(rows);
  if (format === "csv") {
    const csvText = XLSX.utils.sheet_to_csv(sheet);
    return Buffer.from(csvText, "utf-8");
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Sheet1");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}
