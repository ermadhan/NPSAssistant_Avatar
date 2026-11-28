import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { formatInr, shortTierLabel } from "../lib/format";
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
  const [instrumentFilter, setInstrumentFilter] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});

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

  const positions = data?.exposure.positions ?? [];
  const showInvested = filters.year === null;

  const instrumentTotals = useMemo(() => {
    const map = new Map<string, { value: number; count: number }>();
    for (const pos of positions) {
      const prev = map.get(pos.instrument_type) ?? { value: 0, count: 0 };
      map.set(pos.instrument_type, {
        value: prev.value + pos.exposure,
        count: prev.count + 1,
      });
    }
    return map;
  }, [positions]);

  const instrumentTabs = useMemo(() => {
    const ordered = ["Equity", "Corporate bond", "Government bond", "Money market", "Other"];
    const present = ordered.filter((t) => instrumentTotals.has(t));
    return ["All", ...present];
  }, [instrumentTotals]);

  const filteredPositions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return positions.filter((pos) => {
      if (instrumentFilter !== "All" && pos.instrument_type !== instrumentFilter) {
        return false;
      }
      if (!q) return true;
      return (
        pos.security_name.toLowerCase().includes(q) ||
        pos.isin.toLowerCase().includes(q) ||
        pos.industry.toLowerCase().includes(q) ||
        pos.schemes.some((s) => s.toLowerCase().includes(q))
      );
    });
  }, [positions, instrumentFilter, searchQuery]);

  const equityPositions = useMemo(
    () => positions.filter((p) => p.instrument_type === "Equity"),
    [positions],
  );

  const equitySectors = useMemo(() => {
    const map = new Map<
      string,
      { industry: string; exposure: number; invested: number; hasInvested: boolean; count: number }
    >();
    for (const pos of equityPositions) {
      const label = pos.industry || "Unclassified";
      const prev = map.get(label) ?? {
        industry: label,
        exposure: 0,
        invested: 0,
        hasInvested: false,
        count: 0,
      };
      prev.exposure += pos.exposure;
      if (pos.invested_exposure !== null) {
        prev.invested += pos.invested_exposure;
        prev.hasInvested = true;
      }
      prev.count += 1;
      map.set(label, prev);
    }
    return Array.from(map.values()).sort((a, b) => b.exposure - a.exposure);
  }, [equityPositions]);

  const totalEquityExposure = data?.exposure.total_equity_exposure ?? 0;
  const totalEquityInvested = data?.exposure.total_equity_invested ?? null;
  const equityGain =
    totalEquityInvested !== null ? totalEquityExposure - totalEquityInvested : null;
  const anyPartialInvested = positions.some(
    (p) => p.invested_exposure !== null && !p.invested_complete,
  );

  const toggleExpanded = (key: string) => {
    setExpandedKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

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
          : "Estimates combine the latest imported account value (and net invested amount) for each NPS scheme with security weights from its pension fund's published portfolio."}
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
            Security exposures and stock-wise invested estimates apply each scheme's
            published portfolio weights across your holdings. Official sources:{" "}
            {data.sourceUrls.join("; ")}
          </p>

          {Object.keys(data.exposure.unsupported).length > 0 && (
            <p className="text-xs text-[#8A5A00]">
              Not included in look-through (unsupported manager or scheme):{" "}
              {Object.keys(data.exposure.unsupported).sort().join("; ")}
            </p>
          )}

          {positions.length > 0 ? (
            <>
              <div className="flex flex-wrap gap-2.5">
                {Array.from(instrumentTotals.entries())
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([asset, info]) => (
                    <div
                      key={asset}
                      className="bg-white px-3.5 py-2.5 rounded-[10px] border border-[#E4E8EF] text-xs text-[#17243A] flex flex-col gap-0.5"
                    >
                      <span className="text-[11px] text-[#657084]">
                        {asset} ({info.count})
                      </span>
                      <span className="font-semibold">
                        {formatInr(info.value, 0)}
                      </span>
                    </div>
                  ))}
              </div>

              {equityPositions.length > 0 && (
                <div className="bg-white border border-[#E4E8EF] rounded-[14px] p-4 flex flex-col gap-3">
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <span className="text-xs font-semibold uppercase tracking-wide text-[#52627A]">
                      Stock-wise equity investment summary
                    </span>
                    <span className="text-[11px] text-[#7B8494]">
                      Aggregated across all covered Equity schemes ({equityPositions.length} stocks)
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[11px] text-[#657084]">
                        Total Equity Exposure
                      </span>
                      <span className="text-[18px] font-semibold text-[#17243A]">
                        {formatInr(totalEquityExposure, 0)}
                      </span>
                      <span className="text-[11px] text-[#7B8494]">
                        {data.exposure.covered_value > 0
                          ? `${((totalEquityExposure / data.exposure.covered_value) * 100).toFixed(1)}% of covered portfolio`
                          : "—"}
                      </span>
                    </div>

                    <div className="flex flex-col gap-0.5 sm:border-l sm:border-[#E4E8EF] sm:pl-3">
                      <span className="text-[11px] text-[#657084]">
                        Est. Invested in Stocks
                      </span>
                      <span className="text-[18px] font-semibold text-[#17243A]">
                        {showInvested && totalEquityInvested !== null
                          ? `${anyPartialInvested ? "~" : ""}${formatInr(totalEquityInvested, 0)}`
                          : "—"}
                      </span>
                      <span className="text-[11px] text-[#7B8494]">
                        {showInvested
                          ? "Weighted by scheme net invested"
                          : "Switch Financial year to Latest"}
                      </span>
                    </div>

                    <div className="flex flex-col gap-0.5 lg:border-l lg:border-[#E4E8EF] lg:pl-3">
                      <span className="text-[11px] text-[#657084]">
                        Est. Stock Gain/Loss
                      </span>
                      <span
                        className={`text-[18px] font-semibold ${
                          !showInvested || equityGain === null
                            ? "text-[#17243A]"
                            : equityGain >= 0
                              ? "text-[#0F766E]"
                              : "text-[#B91C1C]"
                        }`}
                      >
                        {showInvested && equityGain !== null
                          ? `${equityGain >= 0 ? "+" : ""}${formatInr(equityGain, 0)}`
                          : "—"}
                      </span>
                      <span className="text-[11px] text-[#7B8494]">
                        {showInvested &&
                        equityGain !== null &&
                        totalEquityInvested &&
                        totalEquityInvested !== 0
                          ? `${equityGain >= 0 ? "+" : ""}${((equityGain / totalEquityInvested) * 100).toFixed(1)}% estimated return`
                          : "Current exposure minus est. invested"}
                      </span>
                    </div>

                    <div className="flex flex-col gap-0.5 sm:border-l sm:border-[#E4E8EF] sm:pl-3">
                      <span className="text-[11px] text-[#657084]">
                        Top Stock Holding
                      </span>
                      <span
                        className="text-[14px] font-semibold text-[#17243A] truncate"
                        title={equityPositions[0].security_name}
                      >
                        {equityPositions[0].security_name}
                      </span>
                      <span className="text-[11px] text-[#7B8494]">
                        {formatInr(equityPositions[0].exposure, 0)} (
                        {equityPositions[0].equity_weight !== null
                          ? `${(equityPositions[0].equity_weight * 100).toFixed(2)}% of equity`
                          : "—"}
                        )
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {instrumentTabs.map((tab) => {
                    const active = instrumentFilter === tab;
                    const count =
                      tab === "All"
                        ? positions.length
                        : (instrumentTotals.get(tab)?.count ?? 0);
                    return (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setInstrumentFilter(tab)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                          active
                            ? "bg-[#3B6FD8] border-[#3B6FD8] text-white"
                            : "bg-white border-[#D4DCE8] text-[#52627A] hover:bg-[#F3F5F9]"
                        }`}
                      >
                        {tab === "Equity" ? "Equity stocks" : tab} ({count})
                      </button>
                    );
                  })}
                </div>

                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search stock, ISIN, industry, or scheme..."
                  className="h-8 w-full sm:w-[280px] rounded-lg border border-[#D4DCE8] bg-white px-2.5 text-xs text-[#17243A] placeholder:text-[#7B8494] focus:outline-none focus:border-[#3B6FD8]"
                />
              </div>

              {instrumentFilter === "Equity" && equitySectors.length > 0 && (
                <div className="bg-white rounded-lg border border-[#E4E8EF] p-3 flex flex-col gap-2">
                  <span className="text-xs font-semibold text-[#17243A]">
                    Top equity sectors across schemes
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                    {equitySectors.slice(0, 8).map((sec) => (
                      <div
                        key={sec.industry}
                        className="rounded-lg border border-[#E4E8EF] bg-[#F9FAFC] px-2.5 py-2 flex flex-col gap-0.5"
                      >
                        <span
                          className="text-[11px] font-medium text-[#17243A] truncate"
                          title={sec.industry}
                        >
                          {sec.industry} ({sec.count})
                        </span>
                        <span className="text-xs font-semibold text-[#17243A]">
                          {formatInr(sec.exposure, 0)}{" "}
                          <span className="text-[11px] font-normal text-[#657084]">
                            ({totalEquityExposure > 0
                              ? `${((sec.exposure / totalEquityExposure) * 100).toFixed(1)}%`
                              : "—"})
                          </span>
                        </span>
                        {showInvested && sec.hasInvested && (
                          <span className="text-[10px] text-[#657084]">
                            Est. invested: {formatInr(sec.invested, 0)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div
                className="overflow-x-auto bg-white rounded-lg border border-[#E4E8EF]"
                title={exposureLabel}
              >
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#E1E5ED] h-[42px] text-[#17243A] font-semibold">
                      <th className="text-left px-3 w-8" aria-label="Expand" />
                      <th className="text-left px-3">Instrument</th>
                      <th className="text-left px-3">Security</th>
                      <th className="text-left px-3">ISIN</th>
                      <th className="text-left px-3">Industry</th>
                      {instrumentFilter === "Equity" && (
                        <th className="text-right px-3">Est. shares</th>
                      )}
                      {showInvested && (
                        <th className="text-right px-3">Est. invested</th>
                      )}
                      <th className="text-right px-3">Current exposure</th>
                      <th className="text-right px-3">% of Equity</th>
                      <th className="text-right px-3">% of Portfolio</th>
                      <th className="text-right px-3">Schemes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPositions.map((pos, idx) => {
                      const rowKey = `${pos.isin}-${pos.security_name}-${idx}`;
                      const isExpanded = Boolean(expandedKeys[rowKey]);
                      const hasBreakdown = pos.scheme_breakdown.length > 0;
                      const colCount =
                        9 +
                        (instrumentFilter === "Equity" ? 1 : 0) +
                        (showInvested ? 1 : 0);

                      const investedText =
                        pos.invested_exposure === null
                          ? "—"
                          : `${!pos.invested_complete ? "~" : ""}${formatInr(pos.invested_exposure, 0)}`;

                      return (
                        <React.Fragment key={rowKey}>
                          <tr
                            onClick={() => hasBreakdown && toggleExpanded(rowKey)}
                            className={`border-b border-[#F0F2F7] last:border-b-0 h-[40px] ${
                              hasBreakdown ? "hover:bg-[#F8FAFD] cursor-pointer" : ""
                            }`}
                          >
                            <td className="px-3 text-[#657084]">
                              {hasBreakdown &&
                                (isExpanded ? (
                                  <ChevronDown className="w-3.5 h-3.5" />
                                ) : (
                                  <ChevronRight className="w-3.5 h-3.5" />
                                ))}
                            </td>
                            <td className="px-3 whitespace-nowrap">
                              {pos.instrument_type}
                            </td>
                            <td
                              className="px-3 max-w-[260px] truncate font-medium text-[#17243A]"
                              title={pos.security_name}
                            >
                              {pos.security_name}
                            </td>
                            <td
                              className="px-3 max-w-[120px] truncate text-[#52627A]"
                              title={pos.isin}
                            >
                              {pos.isin || "—"}
                            </td>
                            <td
                              className="px-3 max-w-[180px] truncate text-[#52627A]"
                              title={pos.industry}
                            >
                              {pos.industry || "—"}
                            </td>
                            {instrumentFilter === "Equity" && (
                              <td className="px-3 text-right whitespace-nowrap text-[#52627A]">
                                {pos.estimated_shares !== null
                                  ? pos.estimated_shares.toFixed(2)
                                  : "—"}
                              </td>
                            )}
                            {showInvested && (
                              <td className="px-3 text-right whitespace-nowrap">
                                {investedText}
                              </td>
                            )}
                            <td className="px-3 text-right whitespace-nowrap font-medium text-[#17243A]">
                              {formatInr(pos.exposure, 0)}
                            </td>
                            <td className="px-3 text-right whitespace-nowrap text-[#0F766E] font-medium">
                              {pos.equity_weight !== null
                                ? `${(pos.equity_weight * 100).toFixed(2)}%`
                                : "—"}
                            </td>
                            <td className="px-3 text-right whitespace-nowrap">
                              {(pos.portfolio_weight * 100).toFixed(2)}%
                            </td>
                            <td className="px-3 text-right whitespace-nowrap text-[#3B6FD8]">
                              {pos.scheme_breakdown.length}
                            </td>
                          </tr>
                          {isExpanded && hasBreakdown && (
                            <tr className="bg-[#F8FAFD] border-b border-[#E4E8EF]">
                              <td colSpan={colCount} className="px-6 py-2.5">
                                <div className="flex flex-col gap-1.5">
                                  <div className="flex items-center justify-between text-[11px] text-[#52627A]">
                                    <span className="font-semibold">
                                      Scheme contribution breakdown for{" "}
                                      {pos.security_name}
                                    </span>
                                    {pos.estimated_shares !== null && (
                                      <span>
                                        Est. total shares across schemes:{" "}
                                        <strong>
                                          {pos.estimated_shares.toFixed(2)}
                                        </strong>
                                      </span>
                                    )}
                                  </div>
                                  <table className="w-full text-[11px] border-collapse bg-white rounded border border-[#E4E8EF]">
                                    <thead>
                                      <tr className="border-b border-[#E4E8EF] text-[#52627A] h-7">
                                        <th className="text-left px-2.5">Scheme</th>
                                        <th className="text-left px-2.5">Tier</th>
                                        <th className="text-right px-2.5">
                                          Weight in scheme
                                        </th>
                                        {showInvested && (
                                          <th className="text-right px-2.5">
                                            Est. invested
                                          </th>
                                        )}
                                        <th className="text-right px-2.5">
                                          Current exposure
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {pos.scheme_breakdown.map((sb) => (
                                        <tr
                                          key={`${sb.tier}::${sb.scheme_name}`}
                                          className="border-b border-[#F0F2F7] last:border-b-0 h-7"
                                        >
                                          <td className="px-2.5">
                                            {sb.scheme_name}
                                          </td>
                                          <td className="px-2.5 whitespace-nowrap">
                                            {shortTierLabel(sb.tier)}
                                          </td>
                                          <td className="px-2.5 text-right whitespace-nowrap">
                                            {(sb.weight_in_scheme * 100).toFixed(2)}%
                                          </td>
                                          {showInvested && (
                                            <td className="px-2.5 text-right whitespace-nowrap">
                                              {sb.invested_exposure !== null
                                                ? formatInr(sb.invested_exposure, 0)
                                                : "—"}
                                            </td>
                                          )}
                                          <td className="px-2.5 text-right whitespace-nowrap font-medium">
                                            {formatInr(sb.current_exposure, 0)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                    {filteredPositions.length === 0 && (
                      <tr>
                        <td
                          colSpan={
                            9 +
                            (instrumentFilter === "Equity" ? 1 : 0) +
                            (showInvested ? 1 : 0)
                          }
                          className="px-3 py-6 text-center text-xs text-[#657084]"
                        >
                          No securities match the current filter or search query.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {showInvested && anyPartialInvested && (
                <p className="text-xs text-[#8A5A00]">
                  ~ Est. invested is partial where the earliest imported statement
                  for a contributing scheme does not report scheme-level net
                  contributions.
                </p>
              )}
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
