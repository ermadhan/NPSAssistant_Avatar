import { ArrowLeft } from "lucide-react";
import React, { useEffect, useState } from "react";
import {
  formatInr,
  formatUnits,
  rowValue,
  tierLabel,
} from "../lib/format";
import type {
  AppStatePayload,
  EnrichedHoldingRow,
  EnrichedTransactionRow,
  FilterState,
} from "../types";
import { FilterBar } from "./FilterBar";

interface StatementsViewProps {
  state: AppStatePayload;
  filters: FilterState;
  onFilterChange: (next: FilterState) => void;
  selectedImport: number | null;
  onSelectImport: (importId: number | null) => void;
  onBackToPortfolio: () => void;
  onLinkSchemeCode: (statementName: string, schemeCode: string) => Promise<void>;
  onRefreshNavs: () => Promise<void>;
  busy: boolean;
  refreshTick: number;
}

const CASH_KINDS = new Set([
  "billing",
  "voluntary",
  "employer",
  "tier2",
  "switch_out",
  "switch_in",
  "other",
]);

export const StatementsView: React.FC<StatementsViewProps> = ({
  state,
  filters,
  onFilterChange,
  selectedImport,
  onSelectImport,
  onBackToPortfolio,
  onLinkSchemeCode,
  onRefreshNavs,
  busy,
  refreshTick,
}) => {
  const [detail, setDetail] = useState<{
    holdings: EnrichedHoldingRow[];
    transactions: EnrichedTransactionRow[];
  } | null>(null);
  const [selectedCodes, setSelectedCodes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (selectedImport === null) {
      setDetail(null);
      return;
    }
    fetch(`/api/statements/${selectedImport}`)
      .then((res) => res.json())
      .then((payload) => setDetail(payload))
      .catch(() => {});
  }, [selectedImport, refreshTick]);

  const { years, holdingsByImport, catalog } = state;

  if (selectedImport === null) {
    const filteredYears = years.filter((row) => {
      if (filters.member !== null && row.member_id !== filters.member)
        return false;
      if (filters.tier !== null && row.tier !== filters.tier) return false;
      if (filters.year !== null && row.financial_year !== filters.year)
        return false;
      if (
        filters.scheme !== null &&
        !(holdingsByImport[row.id] ?? []).some(
          (h) => h.scheme_name === filters.scheme,
        )
      ) {
        return false;
      }
      return true;
    });

    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[26px] font-semibold text-[#17243A]">
          Statement history
        </h1>
        <p className="text-sm text-[#17243A]">
          Choose an imported statement to review its holdings and transactions.
        </p>
        <FilterBar
          years={years}
          holdingsByImport={holdingsByImport}
          filters={filters}
          onChange={onFilterChange}
        />

        {filteredYears.length === 0 ? (
          <p className="text-sm text-[#52627A]">
            {years.length > 0
              ? "No statements match these filters."
              : "No statements imported yet. Use Load statement to begin."}
          </p>
        ) : (
          <div className="overflow-x-auto bg-white rounded-lg border border-[#E4E8EF]">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#E1E5ED] h-[42px] text-[#17243A] font-semibold">
                  <th className="text-left px-3">Account</th>
                  <th className="text-left px-3">Tier</th>
                  <th className="text-left px-3">Financial year</th>
                  <th className="text-left px-3">As of</th>
                  <th className="text-left px-3">Review</th>
                </tr>
              </thead>
              <tbody>
                {filteredYears.map((row) => {
                  const name = row.subscriber_name || "NPS subscriber";
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-[#F0F2F7] last:border-b-0 h-[40px]"
                    >
                      <td
                        className="px-3 max-w-[320px] truncate"
                        title={name}
                      >
                        {name}
                      </td>
                      <td className="px-3 whitespace-nowrap">
                        {tierLabel(row.tier)}
                      </td>
                      <td className="px-3 whitespace-nowrap">
                        {row.financial_year}
                      </td>
                      <td className="px-3 whitespace-nowrap">
                        {row.as_of_date}
                      </td>
                      <td className="px-3">
                        <button
                          type="button"
                          onClick={() => onSelectImport(row.id)}
                          className="text-[#3B6FD8] hover:underline font-medium cursor-pointer"
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  const rows = detail?.holdings ?? [];
  const transactions = detail?.transactions ?? [];
  const cashTotal = transactions
    .filter((t) => CASH_KINDS.has(t.narration_kind))
    .reduce((sum, t) => sum + Number(t.amount ?? 0), 0);

  const missingNavSchemes = rows
    .filter((r) => r.latest_nav === null)
    .map((r) => r.scheme_name);

  const pendingSchemeCodes = Array.from(
    new Set(rows.filter((r) => !r.scheme_code).map((r) => r.scheme_name)),
  ).sort();

  const subscriberName = rows[0]?.subscriber_name || "NPS subscriber";
  const tiers = ["nps_tier1", "nps_tier2"];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[22px] font-semibold text-[#17243A]">
        Statement holdings
      </h1>

      <div>
        <button
          type="button"
          onClick={onBackToPortfolio}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#3B6FD8] hover:underline cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to portfolio
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-[#52627A]">
          Load a transaction statement CSV downloaded from the NPS website.
        </p>
      ) : (
        <>
          <div className="bg-[#EAF0F8] px-3 py-2 rounded-lg">
            <div
              className="text-[15px] font-semibold text-[#17243A] max-w-[520px] truncate"
              title={subscriberName}
            >
              {subscriberName}
            </div>
          </div>

          {tiers.map((tier) => {
            const tierRows = rows.filter((r) => r.tier === tier);
            if (tierRows.length === 0) return null;
            return (
              <div key={tier} className="flex flex-col gap-2">
                <h3 className="text-[14px] font-semibold text-[#52627A]">
                  {tierLabel(tier)}
                </h3>
                <div className="overflow-x-auto bg-white rounded-lg border border-[#E4E8EF]">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-[#E1E5ED] h-[42px] text-[#17243A] font-semibold">
                        <th className="text-left px-3">Scheme</th>
                        <th className="text-right px-3">Units</th>
                        <th className="text-right px-3">Statement NAV</th>
                        <th className="text-right px-3">Latest NAV</th>
                        <th className="text-right px-3">Current value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tierRows.map((row) => (
                        <tr
                          key={row.id}
                          className="border-b border-[#F0F2F7] last:border-b-0 h-[40px]"
                        >
                          <td
                            className="px-3 max-w-[340px] truncate"
                            title={row.scheme_name}
                          >
                            {row.scheme_name}
                          </td>
                          <td className="px-3 text-right">
                            {formatUnits(row.units)}
                          </td>
                          <td className="px-3 text-right">
                            {formatUnits(row.statement_nav)}
                          </td>
                          <td className="px-3 text-right">
                            {row.latest_nav === null
                              ? ""
                              : formatUnits(row.latest_nav)}
                          </td>
                          <td className="px-3 text-right">
                            {formatInr(rowValue(row))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          {missingNavSchemes.length > 0 && (
            <p className="text-xs text-[#52627A]">
              Latest NAV is not stored yet for: {missingNavSchemes.join("; ")}
            </p>
          )}
        </>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-sm text-[#17243A]">
          Scheme movements. Cash-flow total excludes opening and closing balances:{" "}
          {formatInr(cashTotal)}
        </p>

        <div className="overflow-x-auto bg-white rounded-lg border border-[#E4E8EF]">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#E1E5ED] h-[42px] text-[#17243A] font-semibold">
                <th className="text-left px-3">Date</th>
                <th className="text-left px-3">Scheme</th>
                <th className="text-left px-3">Kind</th>
                <th className="text-left px-3">Description</th>
                <th className="text-right px-3">Amount</th>
                <th className="text-right px-3">Units</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((txn) => (
                <tr
                  key={txn.id}
                  className="border-b border-[#F0F2F7] last:border-b-0 h-[40px]"
                >
                  <td className="px-3 whitespace-nowrap">{txn.txn_date}</td>
                  <td
                    className="px-3 max-w-[300px] truncate"
                    title={txn.scheme_name}
                  >
                    {txn.scheme_name}
                  </td>
                  <td className="px-3 whitespace-nowrap">
                    {txn.narration_kind}
                  </td>
                  <td
                    className="px-3 max-w-[360px] truncate"
                    title={txn.description}
                  >
                    {txn.description}
                  </td>
                  <td className="px-3 text-right whitespace-nowrap">
                    {txn.amount === null ? "" : formatInr(txn.amount)}
                  </td>
                  <td className="px-3 text-right whitespace-nowrap">
                    {txn.units === null ? "" : formatUnits(txn.units)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {pendingSchemeCodes.length > 0 && (
        <div className="flex flex-col gap-3">
          {catalog.length === 0 ? (
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-xs text-[#52627A]">
                Refresh NAVs, then choose a scheme code for any name that did not
                match.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => onRefreshNavs()}
                className="px-3.5 py-1.5 rounded-full border border-[#D4DCE8] bg-white text-xs font-medium text-[#17243A] hover:bg-[#F3F5F9] disabled:opacity-50 cursor-pointer"
              >
                Fetch NAV catalog
              </button>
            </div>
          ) : (
            <>
              <p className="text-sm font-semibold text-[#17243A]">
                Choose a scheme code
              </p>
              {pendingSchemeCodes.map((name) => (
                <div key={name} className="flex flex-wrap items-end gap-2">
                  <div className="flex flex-col w-full max-w-[640px]">
                    <label className="text-[11px] font-medium text-[#52627A] mb-1">
                      {name}
                    </label>
                    <select
                      value={selectedCodes[name] ?? ""}
                      onChange={(e) =>
                        setSelectedCodes((prev) => ({
                          ...prev,
                          [name]: e.target.value,
                        }))
                      }
                      className="h-9 px-2.5 text-xs bg-white border border-[#D4DCE8] rounded-md text-[#17243A]"
                    >
                      <option value="">Select scheme code...</option>
                      {catalog.map((fund) => (
                        <option key={fund.scheme_code} value={fund.scheme_code}>
                          {fund.scheme_code}  {fund.scheme_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const code = selectedCodes[name];
                      if (code) onLinkSchemeCode(name, code);
                    }}
                    className="px-4 py-2 rounded-full bg-[#3B6FD8] text-white text-xs font-medium hover:bg-[#315EC0] cursor-pointer"
                  >
                    Save code
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};
