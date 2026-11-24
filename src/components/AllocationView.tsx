import React, { useEffect, useState } from "react";
import { formatInr, formatInvested } from "../lib/format";
import type {
  AllocationBucketAmount,
  AllocationPayload,
  EnrichedHoldingRow,
  FilterState,
  YearListRow,
} from "../types";
import { FilterBar } from "./FilterBar";

interface AllocationViewProps {
  years: YearListRow[];
  holdingsByImport: Record<number, EnrichedHoldingRow[]>;
  filters: FilterState;
  onFilterChange: (next: FilterState) => void;
  refreshTick: number;
}

const ASSETS = ["Equity", "Corporate", "Government", "Alternative"] as const;

function AllocationAmountCell({
  amounts,
  complete,
  showInvested,
  portfolioValue,
}: {
  amounts: AllocationBucketAmount;
  complete: boolean;
  showInvested: boolean;
  portfolioValue: number;
}) {
  let line1 = formatInr(amounts.current_value, 0);
  if (portfolioValue) {
    const share = (amounts.current_value / portfolioValue) * 100;
    line1 += ` (${share.toFixed(1)}%)`;
  }
  const line2 = showInvested
    ? `Invested ${formatInvested(amounts.net_invested, complete)}`
    : null;
  const tooltip = line2 ? `${line1}\n${line2}` : line1;

  return (
    <div className="text-[11px] leading-tight" title={tooltip}>
      <div>{line1}</div>
      {line2 && <div className="text-[#657084]">{line2}</div>}
    </div>
  );
}

export const AllocationView: React.FC<AllocationViewProps> = ({
  years,
  holdingsByImport,
  filters,
  onFilterChange,
  refreshTick,
}) => {
  const [data, setData] = useState<AllocationPayload | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.member) params.set("member", filters.member);
    if (filters.tier) params.set("tier", filters.tier);
    if (filters.scheme) params.set("scheme", filters.scheme);
    if (filters.year) params.set("year", filters.year);
    fetch(`/api/allocation?${params.toString()}`)
      .then((res) => res.json())
      .then((payload: AllocationPayload) => setData(payload))
      .catch(() => {});
  }, [filters, refreshTick]);

  const showInvested = filters.year === null;
  const tiers = filters.tier ? [filters.tier] : ["nps_tier1", "nps_tier2"];
  const rows = data?.rows ?? [];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[26px] font-semibold text-[#17243A]">
        Portfolio allocation
      </h1>

      <FilterBar
        years={years}
        holdingsByImport={holdingsByImport}
        filters={filters}
        onChange={onFilterChange}
      />

      <p className="text-sm text-[#17243A]">
        {filters.year
          ? `Statement snapshot for FY ${filters.year}.`
          : "Scheme-level values from each statement and the latest available NAV. Net invested uses reported scheme contributions where available and dated transactions otherwise."}
      </p>

      {!data?.hasPositions ? (
        <p className="text-sm text-[#52627A]">
          {data?.hasVisibleRows
            ? "No holdings match the selected filters."
            : "Import NPS statements to see member and family allocations."}
        </p>
      ) : (
        <>
          <h2 className="text-[19px] font-semibold text-[#17243A]">
            By tier and asset class
          </h2>
          <div className="overflow-x-auto bg-white rounded-lg border border-[#E4E8EF]">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#E1E5ED] h-[42px] text-[#17243A] font-semibold">
                  <th className="text-left px-3">Account</th>
                  <th className="text-left px-3">Tier</th>
                  {ASSETS.map((asset) => (
                    <th key={asset} className="text-left px-3">
                      {asset}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) =>
                  tiers.map((tier) => {
                    const tierAmounts = ASSETS.map(
                      (asset) =>
                        row.categories[`${tier}::${asset}`] ?? {
                          current_value: 0,
                          net_invested: 0,
                        },
                    );
                    if (!tierAmounts.some((a) => a.current_value !== 0)) {
                      return null;
                    }
                    return (
                      <tr
                        key={`${row.member_id}-${tier}`}
                        className="border-b border-[#F0F2F7] last:border-b-0 min-h-[48px]"
                      >
                        <td
                          className="px-3 py-2 max-w-[220px] truncate"
                          title={row.member}
                        >
                          {row.member}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {tier === "nps_tier1" ? "Tier 1" : "Tier 2"}
                        </td>
                        {tierAmounts.map((amounts, idx) => (
                          <td key={ASSETS[idx]} className="px-3 py-2">
                            <AllocationAmountCell
                              amounts={amounts}
                              complete={row.invested_complete}
                              showInvested={showInvested}
                              portfolioValue={row.current_value}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>

          <h2 className="text-[19px] font-semibold text-[#17243A]">
            Asset-class and portfolio totals
          </h2>
          <div className="overflow-x-auto bg-white rounded-lg border border-[#E4E8EF]">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#E1E5ED] h-[42px] text-[#17243A] font-semibold">
                  <th className="text-left px-3">Account</th>
                  {ASSETS.map((asset) => (
                    <th key={asset} className="text-left px-3">
                      {asset}
                    </th>
                  ))}
                  <th className="text-left px-3">Portfolio</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.member_id}
                    className="border-b border-[#F0F2F7] last:border-b-0 min-h-[48px]"
                  >
                    <td
                      className="px-3 py-2 max-w-[220px] truncate"
                      title={row.member}
                    >
                      {row.member}
                    </td>
                    {ASSETS.map((asset) => (
                      <td key={asset} className="px-3 py-2">
                        <AllocationAmountCell
                          amounts={
                            row.asset_totals[asset] ?? {
                              current_value: 0,
                              net_invested: 0,
                            }
                          }
                          complete={row.invested_complete}
                          showInvested={showInvested}
                          portfolioValue={row.current_value}
                        />
                      </td>
                    ))}
                    <td className="px-3 py-2">
                      <AllocationAmountCell
                        amounts={{
                          current_value: row.current_value,
                          net_invested: row.net_invested,
                        }}
                        complete={row.invested_complete}
                        showInvested={showInvested}
                        portfolioValue={row.current_value}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {showInvested && rows.some((r) => !r.invested_complete) && (
            <p className="text-xs text-[#8A5A00]">
              Net invested is partial for members whose imported history does not
              include an initial scheme-contribution balance.
            </p>
          )}
        </>
      )}
    </div>
  );
};
