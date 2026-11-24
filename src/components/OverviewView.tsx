import React from "react";
import {
  formatInr,
  formatReturns,
  formatUnits,
  rowValue,
  tierLabel,
} from "../lib/format";
import type {
  AppStatePayload,
  EnrichedHoldingRow,
  FilterState,
  PortfolioPosition,
} from "../types";
import { FilterBar } from "./FilterBar";

interface OverviewViewProps {
  state: AppStatePayload;
  filters: FilterState;
  onFilterChange: (next: FilterState) => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  state,
  filters,
  onFilterChange,
}) => {
  const { years, holdingsByImport, analytics } = state;

  const matchesFilters = (
    row: {
      member_id: string;
      tier: string | null;
      scheme_name?: string;
      financial_year?: string;
    },
    options?: { includeYear?: boolean; includeScheme?: boolean },
  ): boolean => {
    const includeYear = options?.includeYear ?? true;
    const includeScheme = options?.includeScheme ?? true;
    if (filters.member !== null && row.member_id !== filters.member) return false;
    if (filters.tier !== null && row.tier !== filters.tier) return false;
    if (
      includeScheme &&
      filters.scheme !== null &&
      row.scheme_name !== filters.scheme
    ) {
      return false;
    }
    if (
      includeYear &&
      filters.year !== null &&
      row.financial_year !== filters.year
    ) {
      return false;
    }
    return true;
  };

  let sourceRows: EnrichedHoldingRow[];
  if (filters.year === null) {
    sourceRows = state.currentHoldings;
  } else {
    sourceRows = [];
    for (const statement of years) {
      if (statement.financial_year !== filters.year) continue;
      for (const row of holdingsByImport[statement.id] ?? []) {
        sourceRows.push({
          ...row,
          latest_nav: null,
          latest_nav_date: null,
        });
      }
    }
  }

  const rows = sourceRows.filter((row) => matchesFilters(row));

  const positionMetrics = new Map<string, PortfolioPosition>();
  let scopedPositions: PortfolioPosition[] = [];
  if (filters.year === null && rows.length > 0) {
    for (const item of analytics.positions) {
      positionMetrics.set(
        `${item.member_id}::${item.tier}::${item.scheme_name}`,
        item,
      );
    }
    const visibleKeys = new Set(
      rows.map((r) => `${r.member_id}::${r.tier}::${r.scheme_name}`),
    );
    scopedPositions = analytics.positions.filter((item) =>
      visibleKeys.has(`${item.member_id}::${item.tier}::${item.scheme_name}`),
    );
  }

  const filteredCalculatedReturns = (() => {
    if (filters.scheme === null) {
      let returns = analytics.calculated_xirr;
      if (filters.member === null) {
        returns = returns.filter((r) => r.member_id === "family");
        if (filters.tier === null) {
          returns = returns.filter((r) => r.tier === null);
        }
      } else {
        returns = returns.filter((r) => r.member_id === filters.member);
      }
      return returns.filter((r) =>
        matchesFilters(r, { includeScheme: false }),
      );
    }
    return analytics.positions
      .filter(
        (row) =>
          row.scheme_name === filters.scheme &&
          (filters.member === null || row.member_id === filters.member) &&
          (filters.tier === null || row.tier === filters.tier),
      );
  })();

  const reportedLatest = analytics.reported_xirr.filter((item) =>
    matchesFilters(item, { includeScheme: false }),
  );

  const reportedForYear =
    filters.year !== null
      ? years
          .filter(
            (row) =>
              row.financial_year === filters.year &&
              matchesFilters(row, { includeYear: false, includeScheme: false }),
          )
          .map((row) => ({
            member: row.subscriber_name || "NPS subscriber",
            reported_xirr: row.xirr,
            member_id: row.member_id,
            tier: row.tier,
          }))
      : [];

  const netInvestedTotal = scopedPositions.reduce(
    (sum, r) => sum + (r.net_invested ?? 0),
    0,
  );
  const incomplete = scopedPositions.some((r) => !r.invested_complete);
  const currentTotal = scopedPositions.reduce(
    (sum, r) => sum + r.current_value,
    0,
  );

  // Account balances summary
  const byMemberSummary = new Map<
    string,
    { name: string; nps_tier1: number; nps_tier2: number }
  >();
  for (const row of rows) {
    const entry = byMemberSummary.get(row.member_id) ?? {
      name: row.subscriber_name || "NPS subscriber",
      nps_tier1: 0,
      nps_tier2: 0,
    };
    if (row.tier === "nps_tier1") entry.nps_tier1 += rowValue(row);
    else if (row.tier === "nps_tier2") entry.nps_tier2 += rowValue(row);
    byMemberSummary.set(row.member_id, entry);
  }
  const summaryMembers = Array.from(byMemberSummary.values());
  const familyTier1 = summaryMembers.reduce((s, m) => s + m.nps_tier1, 0);
  const familyTier2 = summaryMembers.reduce((s, m) => s + m.nps_tier2, 0);

  // Group rows by member
  const rowsByMember = new Map<string, EnrichedHoldingRow[]>();
  for (const row of rows) {
    const list = rowsByMember.get(row.member_id) ?? [];
    list.push(row);
    rowsByMember.set(row.member_id, list);
  }

  const missingNavSchemes = rows
    .filter((r) => r.latest_nav === null)
    .map((r) => r.scheme_name);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[22px] font-semibold text-[#17243A]">Portfolio</h1>

      <FilterBar
        years={years}
        holdingsByImport={holdingsByImport}
        filters={filters}
        onChange={onFilterChange}
      />

      {filters.year === null && rows.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-white border border-[#E4E8EF] rounded-[14px] p-4 flex flex-col gap-1.5">
              <span className="text-[13px] text-[#657084]">Current value</span>
              <span className="text-[21px] font-semibold text-[#17243A]">
                {formatInr(currentTotal)}
              </span>
              <span className="text-[11px] text-[#7B8494]">
                Priced at latest NAV where available
              </span>
            </div>

            <div className="bg-white border border-[#E4E8EF] rounded-[14px] p-4 flex flex-col gap-1.5">
              <span className="text-[13px] text-[#657084]">Net invested</span>
              <span className="text-[21px] font-semibold text-[#17243A]">
                {formatInr(netInvestedTotal) + (incomplete ? " *" : "")}
              </span>
              <span className="text-[11px] text-[#7B8494]">
                From statement contributions and scheme movements
              </span>
            </div>

            <div className="bg-white border border-[#E4E8EF] rounded-[14px] p-4 flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <span className="text-[11px] text-[#657084] w-[88px] shrink-0">
                  Calculated
                </span>
                <span className="text-xs font-semibold text-[#17243A]">
                  {formatReturns(filteredCalculatedReturns, "calculated_xirr")}
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span
                  className="text-[11px] text-[#657084] w-[88px] shrink-0"
                  title="Reported at account level in the statement"
                >
                  Statement XIRR
                </span>
                <span className="text-xs font-semibold text-[#17243A]">
                  {formatReturns(reportedLatest, "reported_xirr")}
                </span>
              </div>
            </div>
          </div>

          {incomplete && (
            <p className="text-xs text-[#6B7280]">
              * Net invested is partial where the earliest imported statement does
              not report scheme-level net contributions.
            </p>
          )}
        </>
      )}

      {filters.year !== null && rows.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-white border border-[#E4E8EF] rounded-[14px] p-4 flex flex-col gap-1.5">
            <span className="text-[13px] text-[#657084]">Statement value</span>
            <span className="text-[21px] font-semibold text-[#17243A]">
              {formatInr(rows.reduce((s, r) => s + rowValue(r), 0))}
            </span>
            <span className="text-[11px] text-[#7B8494]">
              Snapshot from FY {filters.year}
            </span>
          </div>

          <div className="bg-white border border-[#E4E8EF] rounded-[14px] p-4 flex flex-col gap-2 justify-center">
            <div className="flex items-start gap-2">
              <span
                className="text-[11px] text-[#657084] w-[88px] shrink-0"
                title="Reported at account level in the statement"
              >
                Statement XIRR
              </span>
              <span className="text-xs font-semibold text-[#17243A]">
                {formatReturns(reportedForYear, "reported_xirr")}
              </span>
            </div>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-[#52627A]">
          {sourceRows.length > 0
            ? "No holdings match the selected filters."
            : "Load a transaction statement CSV downloaded from the NPS website."}
        </p>
      ) : (
        <>
          <h2 className="text-[17px] font-semibold text-[#17243A]">
            Account balances
          </h2>

          <div className="overflow-x-auto bg-white rounded-lg border border-[#E4E8EF]">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#E1E5ED] h-[42px] text-[#17243A] font-semibold">
                  <th className="text-left px-3">Account</th>
                  <th className="text-right px-3">Tier 1</th>
                  <th className="text-right px-3">Tier 2</th>
                  <th className="text-right px-3">Combined</th>
                </tr>
              </thead>
              <tbody>
                {filters.member === null && (
                  <tr className="border-b border-[#F0F2F7] h-[40px]">
                    <td
                      className="px-3 font-semibold max-w-[260px] truncate"
                      title="Family"
                    >
                      Family
                    </td>
                    <td className="px-3 text-right">{formatInr(familyTier1)}</td>
                    <td className="px-3 text-right">{formatInr(familyTier2)}</td>
                    <td className="px-3 text-right">
                      {formatInr(familyTier1 + familyTier2)}
                    </td>
                  </tr>
                )}
                {summaryMembers.map((member) => (
                  <tr
                    key={member.name}
                    className="border-b border-[#F0F2F7] last:border-b-0 h-[40px]"
                  >
                    <td
                      className="px-3 max-w-[260px] truncate"
                      title={member.name}
                    >
                      {member.name}
                    </td>
                    <td className="px-3 text-right">
                      {formatInr(member.nps_tier1)}
                    </td>
                    <td className="px-3 text-right">
                      {formatInr(member.nps_tier2)}
                    </td>
                    <td className="px-3 text-right">
                      {formatInr(member.nps_tier1 + member.nps_tier2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {Array.from(rowsByMember.entries()).map(([memberId, memberRows]) => {
            const name = memberRows[0]?.subscriber_name || "NPS subscriber";
            const tiers = filters.tier
              ? [filters.tier]
              : ["nps_tier1", "nps_tier2"];
            return (
              <div key={memberId} className="flex flex-col gap-3">
                {filters.member === null && (
                  <div className="bg-[#EAF0F8] px-3 py-2 rounded-lg">
                    <div
                      className="text-[15px] font-semibold text-[#17243A] max-w-[520px] truncate"
                      title={name}
                    >
                      {name}
                    </div>
                  </div>
                )}

                {tiers.map((tier) => {
                  const tierRows = memberRows.filter((r) => r.tier === tier);
                  if (tierRows.length === 0) return null;
                  const showMetrics = positionMetrics.size > 0;
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
                              <th className="text-right px-3">
                                {filters.year !== null
                                  ? "Statement value"
                                  : "Current value"}
                              </th>
                              {showMetrics && (
                                <>
                                  <th className="text-right px-3">
                                    Net invested
                                  </th>
                                  <th className="text-right px-3">
                                    XIRR (calculated / reported)
                                  </th>
                                </>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {tierRows.map((row) => {
                              const metric = positionMetrics.get(
                                `${row.member_id}::${row.tier}::${row.scheme_name}`,
                              );
                              let investedText = "—";
                              if (
                                metric &&
                                metric.net_invested !== null &&
                                metric.net_invested !== undefined
                              ) {
                                investedText = formatInr(metric.net_invested);
                                if (!metric.invested_complete) {
                                  investedText = "~" + investedText;
                                }
                              }
                              const calcXirr =
                                !metric || metric.calculated_xirr === null
                                  ? "—"
                                  : `${(metric.calculated_xirr * 100).toFixed(2)}%`;
                              const repXirr =
                                !metric || metric.reported_xirr === null
                                  ? "—"
                                  : `${metric.reported_xirr.toFixed(2)}%`;
                              return (
                                <tr
                                  key={`${row.id}-${row.scheme_name}`}
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
                                  {showMetrics && (
                                    <>
                                      <td className="px-3 text-right">
                                        {investedText}
                                      </td>
                                      <td className="px-3 text-right">
                                        {`${calcXirr} / ${repXirr}`}
                                      </td>
                                    </>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
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
    </div>
  );
};
