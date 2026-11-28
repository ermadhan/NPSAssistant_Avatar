import { RefreshCw } from "lucide-react";
import React, { useEffect, useState } from "react";
import { formatInr } from "../lib/format";
import type {
  EnrichedHoldingRow,
  FilterState,
  SecuritiesPayload,
  YearListRow,
} from "../types";
import { FilterBar } from "./FilterBar";

interface SecuritiesViewProps {
  years: YearListRow[];
  holdingsByImport: Record<number, EnrichedHoldingRow[]>;
  filters: FilterState;
  onFilterChange: (next: FilterState) => void;
  onRefreshSecurities: (manager: "ICICI" | "HDFC" | "LIC" | "SBI") => void;
  busy: boolean;
  refreshTick: number;
}

export const SecuritiesView: React.FC<SecuritiesViewProps> = ({
  years,
  holdingsByImport,
  filters,
  onFilterChange,
  onRefreshSecurities,
  busy,
  refreshTick,
}) => {
  const [data, setData] = useState<SecuritiesPayload | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.member) params.set("member", filters.member);
    if (filters.tier) params.set("tier", filters.tier);
    if (filters.scheme) params.set("scheme", filters.scheme);
    if (filters.year) params.set("year", filters.year);
    fetch(`/api/securities/exposure?${params.toString()}`)
      .then((res) => res.json())
      .then((payload: SecuritiesPayload) => setData(payload))
      .catch(() => {});
  }, [filters, refreshTick]);

  const exposureLabel =
    filters.member === null ? "Family exposure" : "Member exposure";

  const dateSummary = data
    ? Object.entries(data.disclosureDates)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([manager, d]) => `${manager}: ${d}`)
        .join(" · ")
    : "";

  const instrumentTotals = new Map<string, number>();
  for (const pos of data?.exposure.positions ?? []) {
    instrumentTotals.set(
      pos.instrument_type,
      (instrumentTotals.get(pos.instrument_type) ?? 0) + pos.exposure,
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[26px] font-semibold text-[#17243A]">
        Underlying stocks and bonds
      </h1>

      <FilterBar
        years={years}
        holdingsByImport={holdingsByImport}
        filters={filters}
        onChange={onFilterChange}
      />

      <p className="text-sm text-[#17243A]">
        {filters.year
          ? `FY ${filters.year} statement values are estimated using the latest stored manager disclosures, which may be from a different date.`
          : "Estimates combine the latest imported account value for each NPS scheme with security weights from its pension fund's published portfolio. Stored latest NAVs are used when available; otherwise the statement NAV is used."}
      </p>

      <div className="flex flex-wrap gap-2.5">
        {(["ICICI", "HDFC", "LIC", "SBI"] as const).map((manager) => (
          <button
            key={manager}
            type="button"
            disabled={busy}
            onClick={() => onRefreshSecurities(manager)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#3B6FD8] text-white text-xs font-medium hover:bg-[#315EC0] disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh {manager} portfolio
          </button>
        ))}
      </div>

      {data && !data.hasHoldings ? (
        <p className="text-sm text-[#52627A]">
          {data.hasAnyCurrentHoldings
            ? "No holdings match the selected filters."
            : "Import NPS statements to see security-level exposure."}
        </p>
      ) : data && !data.hasDisclosures ? (
        <div className="bg-[#FFF8E6] p-5 rounded-xl text-sm text-[#17243A]">
          No official portfolio disclosure has been downloaded yet. Refresh to
          fetch the latest ICICI, HDFC, LIC, or SBI Pension Fund report. Other
          pension fund managers and unsupported schemes remain uncovered.
        </div>
      ) : data ? (
        <>
          <p className="text-sm text-[#17243A]">
            Official disclosure dates: {dateSummary || "unknown"} · Look-through
            coverage: {formatInr(data.exposure.covered_value, 0)} of{" "}
            {formatInr(data.exposure.total_value, 0)} (
            {(data.exposure.coverage * 100).toFixed(1)}%).
          </p>

          <p className="text-xs text-[#6B7280]">
            Security exposures are estimates, not account-level holdings.
            Official sources: {data.sourceUrls.join("; ")}
          </p>

          {Object.keys(data.exposure.unsupported).length > 0 && (
            <p className="text-xs text-[#8A5A00]">
              Not included in look-through (unsupported manager or scheme):{" "}
              {Object.keys(data.exposure.unsupported).sort().join("; ")}
            </p>
          )}

          {data.exposure.positions.length > 0 ? (
            <>
              <div className="flex flex-wrap gap-2.5">
                {Array.from(instrumentTotals.entries())
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([asset, value]) => (
                    <div
                      key={asset}
                      className="bg-white px-3 py-3 rounded-[10px] border border-[#E4E8EF] text-xs font-semibold text-[#17243A]"
                    >
                      {asset}: {formatInr(value, 0)}
                    </div>
                  ))}
              </div>

              <div
                className="overflow-x-auto bg-white rounded-lg border border-[#E4E8EF]"
                title={exposureLabel}
              >
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#E1E5ED] h-[42px] text-[#17243A] font-semibold">
                      <th className="text-left px-3">Instrument</th>
                      <th className="text-left px-3">Security</th>
                      <th className="text-left px-3">ISIN</th>
                      <th className="text-left px-3">Industry</th>
                      <th className="text-right px-3">Exposure</th>
                      <th className="text-right px-3">Portfolio %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.exposure.positions.map((pos, idx) => (
                      <tr
                        key={`${pos.isin}-${pos.security_name}-${idx}`}
                        className="border-b border-[#F0F2F7] last:border-b-0 h-[40px]"
                      >
                        <td className="px-3 whitespace-nowrap">
                          {pos.instrument_type}
                        </td>
                        <td
                          className="px-3 max-w-[260px] truncate"
                          title={pos.security_name}
                        >
                          {pos.security_name}
                        </td>
                        <td
                          className="px-3 max-w-[120px] truncate"
                          title={pos.isin}
                        >
                          {pos.isin}
                        </td>
                        <td
                          className="px-3 max-w-[180px] truncate"
                          title={pos.industry}
                        >
                          {pos.industry}
                        </td>
                        <td className="px-3 text-right whitespace-nowrap">
                          {formatInr(pos.exposure, 0)}
                        </td>
                        <td className="px-3 text-right whitespace-nowrap">
                          {(pos.portfolio_weight * 100).toFixed(2)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            data.exposure.covered_value === 0 && (
              <p className="text-sm text-[#52627A]">
                No imported schemes match the available official disclosures.
              </p>
            )
          )}
        </>
      ) : null}
    </div>
  );
};
