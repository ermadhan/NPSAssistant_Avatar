import type { EnrichedHoldingRow } from "../types";

export function formatInr(value: number, decimals = 2): string {
  const amountNum = Number(value);
  const sign = amountNum < 0 ? "-" : "";
  const amount = Math.abs(amountNum);
  if (amount >= 10_000_000) {
    return `${sign}Rs ${(amount / 10_000_000).toFixed(2)} Crore`;
  }
  if (amount >= 100_000) {
    return `${sign}Rs ${(amount / 100_000).toFixed(2)} Lakh`;
  }
  const formatted = amount.toFixed(decimals);
  const dotIdx = formatted.indexOf(".");
  let integer = dotIdx === -1 ? formatted : formatted.slice(0, dotIdx);
  const fraction = dotIdx === -1 ? "" : formatted.slice(dotIdx);
  if (integer.length > 3) {
    const lastThree = integer.slice(-3);
    let leading = integer.slice(0, -3);
    const groups: string[] = [];
    while (leading.length > 0) {
      groups.unshift(leading.slice(-2));
      leading = leading.slice(0, -2);
    }
    integer = [...groups, lastThree].join(",");
  }
  return `${sign}Rs ${integer}${fraction}`;
}

export function formatInvested(value: number, complete: boolean): string {
  if (!complete && value === 0) {
    return "—";
  }
  const prefix = complete ? "" : "~";
  return prefix + formatInr(value, 0);
}

export function formatUnits(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

export function tierLabel(tier: string): string {
  return tier === "nps_tier1" ? "Tier 1 pension" : "Tier 2";
}

export function shortTierLabel(tier: string): string {
  return tier === "nps_tier1" ? "Tier 1" : "Tier 2";
}

export function rowValue(row: EnrichedHoldingRow): number {
  const price = row.latest_nav !== null ? Number(row.latest_nav) : Number(row.statement_nav);
  return Number(row.units) * price;
}

export function norm(value: string): string {
  return value.toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}

export function formatReturns(
  rows: Array<{
    member_id: string;
    member: string;
    tier: string | null;
    calculated_xirr?: number | null;
    reported_xirr?: number | null;
  }>,
  field: "calculated_xirr" | "reported_xirr",
): string {
  const formatted: string[] = [];
  for (const row of rows) {
    const value = row[field];
    if (value === null || value === undefined) continue;
    let label: string;
    if (row.member_id === "family") {
      label = "Family";
    } else if (row.tier) {
      label = tierLabel(row.tier);
    } else {
      label = row.member;
    }
    let percentage = Number(value);
    if (field === "calculated_xirr") {
      percentage *= 100;
    }
    formatted.push(`${label}: ${percentage.toFixed(2)}%`);
  }
  if (formatted.length > 0) {
    return formatted.join(" · ");
  }
  return field === "reported_xirr" ? "Not reported" : "Not enough history";
}
