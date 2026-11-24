import React from "react";
import type { EnrichedHoldingRow, FilterState, YearListRow } from "../types";

interface FilterBarProps {
  years: YearListRow[];
  holdingsByImport: Record<number, EnrichedHoldingRow[]>;
  filters: FilterState;
  onChange: (next: FilterState) => void;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  years,
  holdingsByImport,
  filters,
  onChange,
}) => {
  const members = new Map<string, string>();
  for (const row of years) {
    if (!members.has(row.member_id)) {
      members.set(row.member_id, row.subscriber_name || "NPS subscriber");
    }
  }

  const schemes = new Set<string>();
  for (const row of years) {
    for (const h of holdingsByImport[row.id] ?? []) {
      schemes.add(h.scheme_name);
    }
  }

  const availableYears = Array.from(
    new Set(years.map((row) => row.financial_year)),
  ).sort((a, b) => b.localeCompare(a));

  return (
    <div className="flex flex-wrap gap-2.5 items-center">
      <div className="flex flex-col w-[220px]">
        <label className="text-[11px] font-medium text-[#52627A] mb-1">
          Name
        </label>
        <select
          value={filters.member ?? "__all__"}
          onChange={(e) =>
            onChange({
              ...filters,
              member: e.target.value === "__all__" ? null : e.target.value,
            })
          }
          className="h-9 px-2.5 text-xs bg-white border border-[#D4DCE8] rounded-md text-[#17243A] focus:outline-none focus:border-[#3B6FD8]"
        >
          <option value="__all__">All members</option>
          {Array.from(members.entries()).map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col w-[150px]">
        <label className="text-[11px] font-medium text-[#52627A] mb-1">
          Tier
        </label>
        <select
          value={filters.tier ?? "__all__"}
          onChange={(e) =>
            onChange({
              ...filters,
              tier: e.target.value === "__all__" ? null : e.target.value,
            })
          }
          className="h-9 px-2.5 text-xs bg-white border border-[#D4DCE8] rounded-md text-[#17243A] focus:outline-none focus:border-[#3B6FD8]"
        >
          <option value="__all__">All tiers</option>
          <option value="nps_tier1">Tier 1</option>
          <option value="nps_tier2">Tier 2</option>
        </select>
      </div>

      <div className="flex flex-col w-[300px]">
        <label className="text-[11px] font-medium text-[#52627A] mb-1">
          Scheme
        </label>
        <select
          value={filters.scheme ?? "__all__"}
          onChange={(e) =>
            onChange({
              ...filters,
              scheme: e.target.value === "__all__" ? null : e.target.value,
            })
          }
          className="h-9 px-2.5 text-xs bg-white border border-[#D4DCE8] rounded-md text-[#17243A] focus:outline-none focus:border-[#3B6FD8]"
        >
          <option value="__all__">All schemes</option>
          {Array.from(schemes)
            .sort()
            .map((scheme) => (
              <option key={scheme} value={scheme}>
                {scheme}
              </option>
            ))}
        </select>
      </div>

      <div className="flex flex-col w-[170px]">
        <label className="text-[11px] font-medium text-[#52627A] mb-1">
          Financial year
        </label>
        <select
          value={filters.year ?? "__all__"}
          onChange={(e) =>
            onChange({
              ...filters,
              year: e.target.value === "__all__" ? null : e.target.value,
            })
          }
          className="h-9 px-2.5 text-xs bg-white border border-[#D4DCE8] rounded-md text-[#17243A] focus:outline-none focus:border-[#3B6FD8]"
        >
          <option value="__all__">Latest</option>
          {availableYears.map((fy) => (
            <option key={fy} value={fy}>
              {fy}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
