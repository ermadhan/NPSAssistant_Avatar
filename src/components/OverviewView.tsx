import { AlertTriangle } from "lucide-react";
import React, { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatInr,
  formatReturns,
  formatUnits,
  rowValue,
  tierLabel,
} from "../lib/format";
import type {
  AlertAssetClass,
  AppStatePayload,
  EnrichedHoldingRow,
  FilterState,
  PortfolioPosition,
  PortfolioThresholds,
  XirrTrendPoint,
} from "../types";
import { FilterBar } from "./FilterBar";

const ASSET_CLASS_OPTIONS: AlertAssetClass[] = [
  "Equity",
  "Corporate",
  "Government",
  "Alternative",
];

const ASSET_CLASS_LABELS: Record<string, AlertAssetClass> = {
  E: "Equity",
  C: "Corporate",
  G: "Government",
  A: "Alternative",
};

interface OverviewViewProps {
  state: AppStatePayload;
  filters: FilterState;
  onFilterChange: (next: FilterState) => void;
  onSaveNotes: (content: string) => Promise<void>;
  onSaveThresholds: (
    next: Omit<PortfolioThresholds, "updated_at">,
  ) => Promise<void>;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  state,
  filters,
  onFilterChange,
  onSaveNotes,
  onSaveThresholds,
}) => {
  const { years, holdingsByImport, analytics, notes, thresholds } = state;
  const [noteDraft, setNoteDraft] = useState(notes.content);
  const [savingNotes, setSavingNotes] = useState(false);
  const [xirrTrends, setXirrTrends] = useState<XirrTrendPoint[]>([]);

  const [minGainInput, setMinGainInput] = useState<string>(
    thresholds.min_gain_inr !== null ? String(thresholds.min_gain_inr) : "",
  );
  const [targetAssetClass, setTargetAssetClass] = useState<AlertAssetClass>(
    thresholds.target_asset_class,
  );
  const [targetPctInput, setTargetPctInput] = useState<string>(
    thresholds.target_allocation_pct !== null
      ? String(thresholds.target_allocation_pct)
      : "",
  );
  const [maxDeviationInput, setMaxDeviationInput] = useState<string>(
    String(thresholds.max_deviation_pct),
  );
  const [savingThresholds, setSavingThresholds] = useState(false);

  useEffect(() => {
    setNoteDraft(notes.content);
  }, [notes.content]);

  useEffect(() => {
    setMinGainInput(
      thresholds.min_gain_inr !== null ? String(thresholds.min_gain_inr) : "",
    );
    setTargetAssetClass(thresholds.target_asset_class);
    setTargetPctInput(
      thresholds.target_allocation_pct !== null
        ? String(thresholds.target_allocation_pct)
        : "",
    );
    setMaxDeviationInput(String(thresholds.max_deviation_pct));
  }, [thresholds]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.member) params.set("member", filters.member);
    if (filters.tier) params.set("tier", filters.tier);
    if (filters.scheme) params.set("scheme", filters.scheme);
    fetch(`/api/xirr-trends?${params.toString()}`)
      .then((res) => res.json())
      .then((payload: { points?: XirrTrendPoint[] }) =>
        setXirrTrends(payload.points ?? []),
      )
      .catch(() => {});
  }, [filters.member, filters.tier, filters.scheme, state.years, state.currentHoldings]);

  const notesDirty = noteDraft !== notes.content;

  const handleSaveNotesClick = async () => {
    setSavingNotes(true);
    try {
      await onSaveNotes(noteDraft);
    } finally {
      setSavingNotes(false);
    }
  };

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
  const memberChartData = summaryMembers
    .map((m) => ({
      name: m.name,
      total: Math.round((m.nps_tier1 + m.nps_tier2) * 100) / 100,
    }))
    .sort((a, b) => b.total - a.total);

  // Group rows by member
  const rowsByMember = new Map<string, EnrichedHoldingRow[]>();
  for (const row of rows) {
    const list = rowsByMember.get(row.member_id) ?? [];
    list.push(row);
    rowsByMember.set(row.member_id, list);
  }

  interface MemberXirrDetailRow {
    key: string;
    member: string;
    tierLabelText: string;
    period: string;
    currentValue: number;
    netInvested: number | null;
    investedComplete: boolean;
    calculatedXirr: number | null;
    statementXirr: number | null;
    isSummary?: boolean;
  }

  const memberXirrRows: MemberXirrDetailRow[] = (() => {
    if (rows.length === 0) return [];
    const result: MemberXirrDetailRow[] = [];

    if (filters.scheme !== null) {
      const matchingPositions = analytics.positions.filter(
        (pos) =>
          pos.scheme_name === filters.scheme &&
          (filters.member === null || pos.member_id === filters.member) &&
          (filters.tier === null || pos.tier === filters.tier),
      );
      for (const pos of matchingPositions) {
        result.push({
          key: `${pos.member_id}::${pos.tier}::${pos.scheme_name}`,
          member: pos.member,
          tierLabelText: tierLabel(pos.tier),
          period: pos.as_of_date,
          currentValue: pos.current_value,
          netInvested: pos.net_invested,
          investedComplete: pos.invested_complete,
          calculatedXirr: pos.calculated_xirr,
          statementXirr: pos.reported_xirr,
        });
      }
      return result;
    }

    const activeTiers = filters.tier
      ? [filters.tier]
      : ["nps_tier1", "nps_tier2"];

    const summarizePositions = (list: PortfolioPosition[]) => {
      const val = list.reduce((s, p) => s + p.current_value, 0);
      const withBasis = list.filter((p) => p.net_invested !== null);
      const inv =
        withBasis.length > 0
          ? withBasis.reduce((s, p) => s + (p.net_invested ?? 0), 0)
          : null;
      const complete =
        list.length > 0 && list.every((p) => p.invested_complete);
      return { val, inv, complete };
    };

    for (const [memberId, memberHoldingRows] of rowsByMember.entries()) {
      const memberName =
        memberHoldingRows[0]?.subscriber_name || "NPS subscriber";
      const memberTiersPresent = activeTiers.filter((t) =>
        memberHoldingRows.some((r) => r.tier === t),
      );

      for (const tier of memberTiersPresent) {
        const calcRow = analytics.calculated_xirr.find(
          (r) => r.member_id === memberId && r.tier === tier,
        );
        const repRow = analytics.reported_xirr.find(
          (r) => r.member_id === memberId && r.tier === tier,
        );
        const tierPositions = analytics.positions.filter(
          (p) => p.member_id === memberId && p.tier === tier,
        );
        const { val, inv, complete } = summarizePositions(tierPositions);
        const fallbackVal = memberHoldingRows
          .filter((r) => r.tier === tier)
          .reduce((s, r) => s + rowValue(r), 0);

        result.push({
          key: `${memberId}::${tier}`,
          member: memberName,
          tierLabelText: tierLabel(tier),
          period:
            calcRow?.start_date && calcRow?.end_date
              ? `${calcRow.start_date} – ${calcRow.end_date}`
              : "—",
          currentValue: tierPositions.length > 0 ? val : fallbackVal,
          netInvested: inv,
          investedComplete: complete,
          calculatedXirr: calcRow?.calculated_xirr ?? null,
          statementXirr: repRow?.reported_xirr ?? null,
        });
      }

      if (filters.tier === null && memberTiersPresent.length > 1) {
        const memberCombined = (analytics.member_xirr ?? []).find(
          (r) => r.member_id === memberId,
        );
        const memberPositions = analytics.positions.filter(
          (p) => p.member_id === memberId,
        );
        const { val, inv, complete } = summarizePositions(memberPositions);
        result.push({
          key: `${memberId}::combined`,
          member: memberName,
          tierLabelText: "Combined",
          period:
            memberCombined?.start_date && memberCombined?.end_date
              ? `${memberCombined.start_date} – ${memberCombined.end_date}`
              : "—",
          currentValue: val,
          netInvested: inv,
          investedComplete: complete,
          calculatedXirr: memberCombined?.calculated_xirr ?? null,
          statementXirr: null,
          isSummary: true,
        });
      }
    }

    if (filters.member === null && rowsByMember.size > 1) {
      const familyRow = analytics.calculated_xirr.find(
        (r) => r.member_id === "family" && r.tier === filters.tier,
      );
      const familyPositions = analytics.positions.filter(
        (p) => filters.tier === null || p.tier === filters.tier,
      );
      const { val, inv, complete } = summarizePositions(familyPositions);
      result.push({
        key: `family::${filters.tier ?? "all"}`,
        member: "Family",
        tierLabelText: filters.tier ? tierLabel(filters.tier) : "All tiers",
        period: "All imported snapshots",
        currentValue: val,
        netInvested: inv,
        investedComplete: complete,
        calculatedXirr: familyRow?.calculated_xirr ?? null,
        statementXirr: null,
        isSummary: true,
      });
    }

    return result;
  })();

  const missingNavSchemes = rows
    .filter((r) => r.latest_nav === null)
    .map((r) => r.scheme_name);

  const hasInvestedData =
    filters.year === null &&
    scopedPositions.some((r) => r.net_invested !== null);
  const totalCurrentValue =
    filters.year === null && scopedPositions.length > 0
      ? currentTotal
      : rows.reduce((s, r) => s + rowValue(r), 0);
  const totalInvestedAmount = hasInvestedData ? netInvestedTotal : null;
  const absoluteGainLoss =
    totalInvestedAmount !== null
      ? totalCurrentValue - totalInvestedAmount
      : null;
  const gainLossPct =
    absoluteGainLoss !== null &&
    totalInvestedAmount !== null &&
    totalInvestedAmount !== 0
      ? (absoluteGainLoss / totalInvestedAmount) * 100
      : null;

  const parseOptionalNumber = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const parsedMinGain = parseOptionalNumber(minGainInput);
  const parsedTargetPctRaw = parseOptionalNumber(targetPctInput);
  const parsedTargetPct =
    parsedTargetPctRaw !== null &&
    parsedTargetPctRaw >= 0 &&
    parsedTargetPctRaw <= 100
      ? parsedTargetPctRaw
      : null;
  const parsedMaxDeviationRaw = parseOptionalNumber(maxDeviationInput);
  const parsedMaxDeviation =
    parsedMaxDeviationRaw !== null &&
    parsedMaxDeviationRaw >= 0 &&
    parsedMaxDeviationRaw <= 100
      ? parsedMaxDeviationRaw
      : 10;

  const targetAssetValue =
    filters.year === null && scopedPositions.length > 0
      ? scopedPositions
          .filter((pos) => pos.asset_class === targetAssetClass)
          .reduce((sum, pos) => sum + pos.current_value, 0)
      : rows
          .filter(
            (row) => ASSET_CLASS_LABELS[row.asset_class] === targetAssetClass,
          )
          .reduce((sum, row) => sum + rowValue(row), 0);

  const actualAllocationPct =
    rows.length > 0 && totalCurrentValue > 0
      ? (targetAssetValue / totalCurrentValue) * 100
      : null;

  const gainAlertTriggered =
    rows.length > 0 &&
    parsedMinGain !== null &&
    absoluteGainLoss !== null &&
    absoluteGainLoss < parsedMinGain;

  const allocationDeviationPct =
    rows.length > 0 && actualAllocationPct !== null && parsedTargetPct !== null
      ? Math.abs(actualAllocationPct - parsedTargetPct)
      : null;

  const allocationAlertTriggered =
    allocationDeviationPct !== null &&
    allocationDeviationPct > parsedMaxDeviation;

  const hasThresholdAlert = gainAlertTriggered || allocationAlertTriggered;

  const alertMessages: string[] = [];
  if (gainAlertTriggered && absoluteGainLoss !== null && parsedMinGain !== null) {
    alertMessages.push(
      `Total gain (${formatInr(absoluteGainLoss)}) is below minimum (${formatInr(parsedMinGain)}).`,
    );
  }
  if (
    allocationAlertTriggered &&
    actualAllocationPct !== null &&
    parsedTargetPct !== null
  ) {
    alertMessages.push(
      `${targetAssetClass} allocation (${actualAllocationPct.toFixed(1)}%) deviates by ${allocationDeviationPct!.toFixed(1)} pp from ${parsedTargetPct.toFixed(1)}% ± ${parsedMaxDeviation.toFixed(1)}% target.`,
    );
  }

  const thresholdsDirty =
    parsedMinGain !== thresholds.min_gain_inr ||
    targetAssetClass !== thresholds.target_asset_class ||
    parsedTargetPct !== thresholds.target_allocation_pct ||
    parsedMaxDeviation !== thresholds.max_deviation_pct;

  const hasConfiguredThresholds =
    parsedMinGain !== null || parsedTargetPct !== null;

  const handleSaveThresholdsClick = async () => {
    setSavingThresholds(true);
    try {
      await onSaveThresholds({
        min_gain_inr: parsedMinGain,
        target_asset_class: targetAssetClass,
        target_allocation_pct: parsedTargetPct,
        max_deviation_pct: parsedMaxDeviation,
      });
    } finally {
      setSavingThresholds(false);
    }
  };

  const handleClearThresholdsClick = async () => {
    setMinGainInput("");
    setTargetPctInput("");
    setMaxDeviationInput("10");
    setSavingThresholds(true);
    try {
      await onSaveThresholds({
        min_gain_inr: null,
        target_asset_class: targetAssetClass,
        target_allocation_pct: null,
        max_deviation_pct: 10,
      });
    } finally {
      setSavingThresholds(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[22px] font-semibold text-[#17243A]">Portfolio</h1>

      <FilterBar
        years={years}
        holdingsByImport={holdingsByImport}
        filters={filters}
        onChange={onFilterChange}
      />

      <div
        className={`rounded-[14px] p-5 flex flex-col gap-3 border transition-colors ${
          hasThresholdAlert
            ? "bg-[#FEF2F2] border-[#FCA5A5]"
            : "bg-white border-[#E4E8EF]"
        }`}
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-semibold uppercase tracking-wide ${
                hasThresholdAlert ? "text-[#991B1B]" : "text-[#52627A]"
              }`}
            >
              Portfolio summary
            </span>
            {hasThresholdAlert && (
              <span className="inline-flex items-center gap-1 rounded-md bg-[#FEE2E2] border border-[#FECACA] px-2 py-0.5 text-[11px] font-semibold text-[#B91C1C]">
                <AlertTriangle className="w-3.5 h-3.5" />
                Threshold alert
              </span>
            )}
          </div>
          <span
            className={`text-[11px] ${
              hasThresholdAlert ? "text-[#991B1B]" : "text-[#7B8494]"
            }`}
          >
            {filters.year !== null
              ? `FY ${filters.year} snapshot`
              : "Latest available valuation"}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
          <div className="flex flex-col gap-1">
            <span
              className={`text-[12px] ${
                hasThresholdAlert ? "text-[#991B1B]" : "text-[#657084]"
              }`}
            >
              Total Current Value
            </span>
            <span
              className={`text-[22px] font-semibold ${
                hasThresholdAlert ? "text-[#B91C1C]" : "text-[#17243A]"
              }`}
            >
              {rows.length > 0 ? formatInr(totalCurrentValue) : "—"}
            </span>
            <span
              className={`text-[11px] ${
                hasThresholdAlert ? "text-[#991B1B]" : "text-[#7B8494]"
              }`}
            >
              {rows.length > 0
                ? filters.year !== null
                  ? "Statement valuation"
                  : "Priced at latest NAV where available"
                : "No holdings imported yet"}
            </span>
          </div>

          <div
            className={`flex flex-col gap-1 md:border-l md:pl-4 ${
              hasThresholdAlert ? "md:border-[#FECACA]" : "md:border-[#E4E8EF]"
            }`}
          >
            <span
              className={`text-[12px] ${
                hasThresholdAlert ? "text-[#991B1B]" : "text-[#657084]"
              }`}
            >
              Total Invested Amount
            </span>
            <span
              className={`text-[22px] font-semibold ${
                hasThresholdAlert ? "text-[#B91C1C]" : "text-[#17243A]"
              }`}
            >
              {totalInvestedAmount !== null
                ? formatInr(totalInvestedAmount) + (incomplete ? " *" : "")
                : "—"}
            </span>
            <span
              className={`text-[11px] ${
                hasThresholdAlert ? "text-[#991B1B]" : "text-[#7B8494]"
              }`}
            >
              {filters.year !== null
                ? "Switch Financial year to Latest"
                : totalInvestedAmount !== null
                  ? "Net contributions and scheme switches"
                  : "No contribution basis available"}
            </span>
          </div>

          <div
            className={`flex flex-col gap-1 md:border-l md:pl-4 ${
              hasThresholdAlert ? "md:border-[#FECACA]" : "md:border-[#E4E8EF]"
            }`}
          >
            <span
              className={`text-[12px] ${
                hasThresholdAlert ? "text-[#991B1B]" : "text-[#657084]"
              }`}
            >
              Overall Absolute Gain/Loss
            </span>
            <span
              className={`text-[22px] font-semibold ${
                hasThresholdAlert
                  ? "text-[#B91C1C]"
                  : absoluteGainLoss === null
                    ? "text-[#17243A]"
                    : absoluteGainLoss >= 0
                      ? "text-[#0F766E]"
                      : "text-[#B91C1C]"
              }`}
            >
              {absoluteGainLoss === null
                ? "—"
                : `${absoluteGainLoss >= 0 ? "+" : ""}${formatInr(absoluteGainLoss)}`}
            </span>
            <span
              className={`text-[11px] ${
                hasThresholdAlert ? "text-[#991B1B]" : "text-[#7B8494]"
              }`}
            >
              {gainLossPct !== null
                ? `${gainLossPct >= 0 ? "+" : ""}${gainLossPct.toFixed(2)}% overall return`
                : "Current value minus invested amount"}
            </span>
          </div>
        </div>

        {hasThresholdAlert && (
          <div className="rounded-lg bg-[#FEE2E2] border border-[#FECACA] px-3 py-2 flex flex-col gap-0.5 text-xs text-[#991B1B]">
            {alertMessages.map((msg) => (
              <div key={msg} className="font-medium">
                {msg}
              </div>
            ))}
          </div>
        )}

        <div
          className={`pt-3 border-t flex flex-col gap-2 ${
            hasThresholdAlert ? "border-[#FECACA]" : "border-[#E4E8EF]"
          }`}
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span
              className={`text-[11px] font-semibold uppercase tracking-wide ${
                hasThresholdAlert ? "text-[#991B1B]" : "text-[#52627A]"
              }`}
            >
              Alert thresholds
            </span>
            {actualAllocationPct !== null && (
              <span
                className={`text-[11px] ${
                  allocationAlertTriggered
                    ? "text-[#B91C1C] font-semibold"
                    : "text-[#657084]"
                }`}
              >
                Current {targetAssetClass} share:{" "}
                {actualAllocationPct.toFixed(1)}%
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 items-end">
            <label className="flex flex-col gap-1 text-[11px] text-[#52627A]">
              <span>Min gain (Rs)</span>
              <input
                type="number"
                step="1000"
                value={minGainInput}
                onChange={(e) => setMinGainInput(e.target.value)}
                placeholder="e.g. 50000"
                className="h-8 rounded-lg border border-[#D4DCE8] bg-white px-2.5 text-xs text-[#17243A] placeholder:text-[#9AA3B2] focus:outline-none focus:border-[#3B6FD8]"
              />
            </label>

            <label className="flex flex-col gap-1 text-[11px] text-[#52627A]">
              <span>Target asset class</span>
              <select
                value={targetAssetClass}
                onChange={(e) =>
                  setTargetAssetClass(e.target.value as AlertAssetClass)
                }
                className="h-8 rounded-lg border border-[#D4DCE8] bg-white px-2.5 text-xs text-[#17243A] focus:outline-none focus:border-[#3B6FD8]"
              >
                {ASSET_CLASS_OPTIONS.map((asset) => (
                  <option key={asset} value={asset}>
                    {asset}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-[11px] text-[#52627A]">
              <span>Target share (%)</span>
              <input
                type="number"
                min={0}
                max={100}
                step="1"
                value={targetPctInput}
                onChange={(e) => setTargetPctInput(e.target.value)}
                placeholder="e.g. 50"
                className="h-8 rounded-lg border border-[#D4DCE8] bg-white px-2.5 text-xs text-[#17243A] placeholder:text-[#9AA3B2] focus:outline-none focus:border-[#3B6FD8]"
              />
            </label>

            <label className="flex flex-col gap-1 text-[11px] text-[#52627A]">
              <span>Allowed deviation (±%)</span>
              <input
                type="number"
                min={0}
                max={100}
                step="1"
                value={maxDeviationInput}
                onChange={(e) => setMaxDeviationInput(e.target.value)}
                placeholder="10"
                className="h-8 rounded-lg border border-[#D4DCE8] bg-white px-2.5 text-xs text-[#17243A] placeholder:text-[#9AA3B2] focus:outline-none focus:border-[#3B6FD8]"
              />
            </label>

            <div className="flex items-center gap-2 h-8">
              <button
                type="button"
                disabled={!thresholdsDirty || savingThresholds}
                onClick={handleSaveThresholdsClick}
                className="px-3.5 h-8 rounded-full bg-[#3B6FD8] text-white text-xs font-medium hover:bg-[#315EC0] disabled:opacity-50 cursor-pointer disabled:cursor-default"
              >
                {savingThresholds ? "Saving..." : "Save"}
              </button>
              {hasConfiguredThresholds && (
                <button
                  type="button"
                  disabled={savingThresholds}
                  onClick={handleClearThresholdsClick}
                  className="px-3 h-8 rounded-full border border-[#D4DCE8] bg-white text-xs font-medium text-[#52627A] hover:bg-[#F3F5F9] cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

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

      {rows.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[17px] font-semibold text-[#17243A]">
              XIRR trends
            </h2>
            <span className="text-[11px] text-[#7B8494]">
              Calculated vs. statement XIRR across imported financial years
            </span>
          </div>

          <div className="bg-white border border-[#E4E8EF] rounded-[14px] p-4">
            {xirrTrends.some(
              (pt) => pt.calculated_xirr !== null || pt.statement_xirr !== null,
            ) ? (
              <div className="w-full h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={xirrTrends}
                    margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E4E8EF" />
                    <XAxis
                      dataKey="period"
                      tick={{ fontSize: 12, fill: "#52627A" }}
                      axisLine={{ stroke: "#D4DCE8" }}
                      tickLine={{ stroke: "#D4DCE8" }}
                    />
                    <YAxis
                      tickFormatter={(v) => `${v}%`}
                      tick={{ fontSize: 12, fill: "#52627A" }}
                      axisLine={{ stroke: "#D4DCE8" }}
                      tickLine={{ stroke: "#D4DCE8" }}
                      width={56}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#FFFFFF",
                        borderColor: "#E4E8EF",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                      formatter={(value) =>
                        value === null || value === undefined
                          ? ["—", ""]
                          : [`${Number(value).toFixed(2)}%`]
                      }
                      labelFormatter={(label) => `FY ${label}`}
                    />
                    <Legend wrapperStyle={{ fontSize: "12px" }} />
                    <Line
                      type="monotone"
                      dataKey="calculated_xirr"
                      name="Calculated XIRR (%)"
                      stroke="#3B6FD8"
                      strokeWidth={2.5}
                      dot={{ r: 4, fill: "#3B6FD8" }}
                      activeDot={{ r: 6 }}
                      connectNulls={false}
                    />
                    {filters.scheme === null && (
                      <Line
                        type="monotone"
                        dataKey="statement_xirr"
                        name="Statement XIRR (%)"
                        stroke="#0F766E"
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot={{ r: 4, fill: "#0F766E" }}
                        activeDot={{ r: 6 }}
                        connectNulls={false}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-xs text-[#657084]">
                Import statements across multiple financial years or with
                statement-reported XIRR to view XIRR trends over time.
              </p>
            )}
          </div>

          {memberXirrRows.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-[14px] font-semibold text-[#52627A]">
                  Member XIRR breakdown
                </h3>
                <span className="text-[11px] text-[#7B8494]">
                  {filters.year !== null
                    ? "Calculated XIRR uses all imported snapshots up to latest NAV"
                    : "Granular return breakdown by family member and tier"}
                </span>
              </div>

              <div className="overflow-x-auto bg-white rounded-lg border border-[#E4E8EF]">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#E1E5ED] h-[42px] text-[#17243A] font-semibold">
                      <th className="text-left px-3">Family member</th>
                      <th className="text-left px-3">Tier</th>
                      <th className="text-left px-3">Coverage period</th>
                      <th className="text-right px-3">Current value</th>
                      <th className="text-right px-3">Net invested</th>
                      <th className="text-right px-3">Calculated XIRR</th>
                      <th className="text-right px-3">Statement XIRR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {memberXirrRows.map((item) => {
                      const calcPct =
                        item.calculatedXirr !== null
                          ? item.calculatedXirr * 100
                          : null;
                      const repPct =
                        item.statementXirr !== null
                          ? item.statementXirr
                          : null;
                      let investedText = "—";
                      if (item.netInvested !== null) {
                        investedText = formatInr(item.netInvested);
                        if (!item.investedComplete) {
                          investedText = "~" + investedText;
                        }
                      }
                      return (
                        <tr
                          key={item.key}
                          className={`border-b border-[#F0F2F7] last:border-b-0 h-[40px] ${
                            item.isSummary ? "bg-[#F8FAFD] font-semibold" : ""
                          }`}
                        >
                          <td
                            className="px-3 max-w-[240px] truncate"
                            title={item.member}
                          >
                            {item.member}
                          </td>
                          <td className="px-3 whitespace-nowrap">
                            {item.tierLabelText}
                          </td>
                          <td className="px-3 whitespace-nowrap text-[#52627A]">
                            {item.period}
                          </td>
                          <td className="px-3 text-right whitespace-nowrap">
                            {formatInr(item.currentValue)}
                          </td>
                          <td className="px-3 text-right whitespace-nowrap">
                            {investedText}
                          </td>
                          <td
                            className={`px-3 text-right whitespace-nowrap font-semibold ${
                              calcPct === null
                                ? "text-[#7B8494] font-normal"
                                : calcPct >= 0
                                  ? "text-[#0F766E]"
                                  : "text-[#B91C1C]"
                            }`}
                          >
                            {calcPct !== null ? `${calcPct.toFixed(2)}%` : "—"}
                          </td>
                          <td className="px-3 text-right whitespace-nowrap text-[#52627A]">
                            {repPct !== null ? `${repPct.toFixed(2)}%` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-[#52627A]">
          {sourceRows.length > 0
            ? "No holdings match the selected filters."
            : "Load a transaction statement CSV downloaded from the NPS website."}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
            <section className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-[17px] font-semibold text-[#17243A]">
                  Portfolio by family member
                </h2>
                {memberChartData.length > 0 && (
                  <span className="text-[11px] text-[#7B8494]">
                    Largest: {memberChartData[0].name} (
                    {formatInr(memberChartData[0].total)})
                  </span>
                )}
              </div>

              <div className="bg-white border border-[#E4E8EF] rounded-[14px] p-4">
                <div className="w-full h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={memberChartData}
                      margin={{ top: 8, right: 16, left: 8, bottom: 4 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#E4E8EF"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 12, fill: "#52627A" }}
                        axisLine={{ stroke: "#D4DCE8" }}
                        tickLine={{ stroke: "#D4DCE8" }}
                      />
                      <YAxis
                        tickFormatter={(v) => formatInr(Number(v), 0)}
                        tick={{ fontSize: 11, fill: "#52627A" }}
                        axisLine={{ stroke: "#D4DCE8" }}
                        tickLine={{ stroke: "#D4DCE8" }}
                        width={86}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#FFFFFF",
                          borderColor: "#E4E8EF",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                        formatter={(value) => [
                          formatInr(Number(value ?? 0)),
                          "Total Current Value",
                        ]}
                      />
                      <Bar
                        dataKey="total"
                        name="Total Current Value"
                        radius={[6, 6, 0, 0]}
                        maxBarSize={64}
                      >
                        {memberChartData.map((entry, index) => (
                          <Cell
                            key={entry.name}
                            fill={index === 0 ? "#2653B5" : "#6E95E4"}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>

            <section className="flex flex-col gap-2">
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
                        <td className="px-3 text-right">
                          {formatInr(familyTier1)}
                        </td>
                        <td className="px-3 text-right">
                          {formatInr(familyTier2)}
                        </td>
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
            </section>
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

      <section className="flex flex-col gap-2 pt-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[17px] font-semibold text-[#17243A]">Notes</h2>
          {notes.updated_at && (
            <span className="text-[11px] text-[#7B8494]">
              Last saved {notes.updated_at.replace("T", " ")}
            </span>
          )}
        </div>

        <div className="bg-white border border-[#E4E8EF] rounded-[14px] p-4 flex flex-col gap-3">
          <p className="text-xs text-[#657084]">
            Record observations, target allocations, or retirement goals for
            your family portfolio. Stored locally on your device.
          </p>
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            rows={4}
            placeholder="Write observations or goals for your family portfolio..."
            className="w-full rounded-lg border border-[#D4DCE8] bg-[#F9FAFC] px-3 py-2 text-xs text-[#17243A] placeholder:text-[#7B8494] focus:bg-white focus:outline-none focus:border-[#3B6FD8] resize-y"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-[#7B8494]">
              {notesDirty ? "Unsaved changes" : "Saved locally"}
            </span>
            <button
              type="button"
              disabled={!notesDirty || savingNotes}
              onClick={handleSaveNotesClick}
              className="px-4 py-1.5 rounded-full bg-[#3B6FD8] text-white text-xs font-medium hover:bg-[#315EC0] disabled:opacity-50 cursor-pointer disabled:cursor-default"
            >
              {savingNotes ? "Saving..." : "Save notes"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
