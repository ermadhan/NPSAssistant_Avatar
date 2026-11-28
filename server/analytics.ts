import {
  db,
  type EnrichedHoldingRow,
  type EnrichedTransactionRow,
  type YearListRow,
} from "./db.ts";

const ASSET_CLASSES: Record<string, string> = {
  E: "Equity",
  C: "Corporate",
  G: "Government",
  A: "Alternative",
};

const CONTRIBUTION_KINDS = new Set(["voluntary", "employer", "tier2"]);

export interface PortfolioPosition {
  member_id: string;
  member: string;
  tier: string;
  scheme_name: string;
  scheme_code: string | null;
  asset_class: string;
  units: number;
  current_value: number;
  net_invested: number | null;
  invested_complete: boolean;
  reported_xirr: number | null;
  calculated_xirr: number | null;
  as_of_date: string;
  nav_date: string;
}

export interface CalculatedReturnRow {
  member_id: string;
  member: string;
  tier: string | null;
  calculated_xirr: number | null;
  start_date?: string;
  end_date?: string;
}

export interface ReportedReturnRow {
  member_id: string;
  member: string;
  tier: string;
  reported_xirr: number | null;
  as_of_date: string;
}

export interface AllocationBucketAmount {
  current_value: number;
  net_invested: number;
}

export interface AllocationRow {
  member_id: string;
  member: string;
  current_value: number;
  net_invested: number;
  invested_complete: boolean;
  categories: Record<string, AllocationBucketAmount>;
  asset_totals: Record<string, AllocationBucketAmount>;
}

function parseIsoDayMs(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function daysBetween(startIso: string, endIso: string): number {
  return Math.round((parseIsoDayMs(endIso) - parseIsoDayMs(startIso)) / 86_400_000);
}

export function familyPortfolio(): {
  positions: PortfolioPosition[];
  members: Array<{ member_id: string; name: string }>;
  reported_xirr: ReportedReturnRow[];
  calculated_xirr: CalculatedReturnRow[];
  member_xirr: CalculatedReturnRow[];
} {
  const years = db.listYears();
  const current = db.currentHoldingRows();
  const transactions = db.allCurrentTransactions();

  const histories = new Map<string, EnrichedTransactionRow[]>();
  for (const row of transactions) {
    const key = `${row.member_id ?? ""}::${row.tier}::${row.scheme_name}`;
    const list = histories.get(key) ?? [];
    list.push(row);
    histories.set(key, list);
  }

  const memberNames = new Map<string, string>();
  for (const row of current) {
    memberNames.set(row.member_id, row.subscriber_name || "NPS subscriber");
  }

  const firstSnapshots = new Map<string, YearListRow>();
  for (const row of years) {
    const key = `${row.member_id}::${row.tier}`;
    const prev = firstSnapshots.get(key);
    if (!prev || row.as_of_date < prev.as_of_date) {
      firstSnapshots.set(key, row);
    }
  }

  const positions: PortfolioPosition[] = [];
  for (const row of current) {
    const key = `${row.member_id}::${row.tier}`;
    const baselineImport = firstSnapshots.get(key);
    const baselineDate = baselineImport ? baselineImport.as_of_date : null;
    const baselineRows = baselineImport ? db.holdingsForImport(baselineImport.id) : [];
    const baseline =
      baselineRows.find((item) => item.scheme_name === row.scheme_name) ?? null;

    const txnRows =
      histories.get(`${row.member_id}::${row.tier}::${row.scheme_name}`) ?? [];
    const [basis, complete] = netInvested(baseline, baselineDate, txnRows);
    const currentValue = holdingValue(row);
    const assetClass = ASSET_CLASSES[row.asset_class] ?? "Other";

    positions.push({
      member_id: row.member_id,
      member: memberNames.get(row.member_id) ?? "NPS subscriber",
      tier: row.tier,
      scheme_name: row.scheme_name,
      scheme_code: row.scheme_code,
      asset_class: assetClass,
      units: Number(row.units),
      current_value: currentValue,
      net_invested: basis,
      invested_complete: complete,
      reported_xirr: null,
      calculated_xirr: null,
      as_of_date: row.as_of_date,
      nav_date: row.latest_nav_date || row.as_of_date,
    });
  }

  for (const position of positions) {
    position.calculated_xirr = positionXirr(position, firstSnapshots, histories);
  }

  const accountReturnsWithFlows = accountReturns(current, years, histories, false);
  const reportedReturnsList = reportedReturns(years);
  const reportedByAccount = new Map<string, number | null>();
  for (const row of reportedReturnsList) {
    reportedByAccount.set(`${row.member_id}::${row.tier}`, row.reported_xirr);
  }

  for (const position of positions) {
    position.reported_xirr =
      reportedByAccount.get(`${position.member_id}::${position.tier}`) ?? null;
  }

  const familyFlows: Array<[string, number]> = [];
  for (const row of accountReturnsWithFlows) {
    familyFlows.push(...row._cashflows);
  }
  const familyReturns: CalculatedReturnRow[] = [
    {
      member_id: "family",
      member: "Family",
      tier: null,
      calculated_xirr: xirr(familyFlows),
    },
  ];
  for (const tier of ["nps_tier1", "nps_tier2"] as const) {
    const flows: Array<[string, number]> = [];
    for (const row of accountReturnsWithFlows) {
      if (row.tier === tier) {
        flows.push(...row._cashflows);
      }
    }
    if (flows.length > 0) {
      familyReturns.push({
        member_id: "family",
        member: "Family",
        tier,
        calculated_xirr: xirr(flows),
      });
    }
  }

  const memberFlowsMap = new Map<
    string,
    {
      member: string;
      start_date: string;
      end_date: string;
      flows: Array<[string, number]>;
    }
  >();
  for (const row of accountReturnsWithFlows) {
    const existing = memberFlowsMap.get(row.member_id);
    if (!existing) {
      memberFlowsMap.set(row.member_id, {
        member: row.member,
        start_date: row.start_date ?? "",
        end_date: row.end_date ?? "",
        flows: [...row._cashflows],
      });
    } else {
      if (row.start_date && (!existing.start_date || row.start_date < existing.start_date)) {
        existing.start_date = row.start_date;
      }
      if (row.end_date && (!existing.end_date || row.end_date > existing.end_date)) {
        existing.end_date = row.end_date;
      }
      existing.flows.push(...row._cashflows);
    }
  }

  const memberReturns: CalculatedReturnRow[] = Array.from(
    memberFlowsMap.entries(),
  ).map(([member_id, entry]) => ({
    member_id,
    member: entry.member,
    tier: null,
    calculated_xirr: xirr(entry.flows),
    start_date: entry.start_date,
    end_date: entry.end_date,
  }));

  const cleanAccountReturns: CalculatedReturnRow[] = accountReturnsWithFlows.map(
    ({ _cashflows, ...rest }) => rest,
  );

  return {
    positions,
    members: Array.from(memberNames.entries()).map(([member_id, name]) => ({
      member_id,
      name,
    })),
    reported_xirr: reportedReturnsList,
    calculated_xirr: [...cleanAccountReturns, ...familyReturns],
    member_xirr: memberReturns,
  };
}

export function allocationSummary(
  positions: Array<{
    member_id: string;
    member: string;
    tier: string;
    asset_class: string;
    current_value: number;
    net_invested: number | null;
    invested_complete: boolean;
  }>,
): AllocationRow[] {
  const assets = ["Equity", "Corporate", "Government", "Alternative"];
  const extraAssets = Array.from(
    new Set(
      positions
        .map((p) => p.asset_class)
        .filter((a) => !assets.includes(a)),
    ),
  ).sort();
  assets.push(...extraAssets);

  const categoryKeys: Array<[string, string]> = [];
  for (const tier of ["nps_tier1", "nps_tier2"]) {
    for (const asset of assets) {
      categoryKeys.push([tier, asset]);
    }
  }

  const totals = new Map<string, AllocationRow>();
  for (const position of positions) {
    const entries: Array<[string, string]> = [
      ["family", "Family total"],
      [position.member_id, position.member],
    ];
    for (const [id, name] of entries) {
      let values = totals.get(id);
      if (!values) {
        const categories: Record<string, AllocationBucketAmount> = {};
        for (const [tier, asset] of categoryKeys) {
          categories[`${tier}::${asset}`] = { current_value: 0.0, net_invested: 0.0 };
        }
        const asset_totals: Record<string, AllocationBucketAmount> = {};
        for (const asset of assets) {
          asset_totals[asset] = { current_value: 0.0, net_invested: 0.0 };
        }
        values = {
          member_id: id,
          member: name,
          current_value: 0.0,
          net_invested: 0.0,
          invested_complete: true,
          categories,
          asset_totals,
        };
        totals.set(id, values);
      }

      const catKey = `${position.tier}::${position.asset_class}`;
      const category = values.categories[catKey];
      const amount = position.net_invested;
      category.current_value += position.current_value;
      values.current_value += position.current_value;
      values.invested_complete = values.invested_complete && position.invested_complete;
      if (amount !== null) {
        category.net_invested += amount;
        values.net_invested += amount;
      }
      const assetTotal = values.asset_totals[position.asset_class];
      assetTotal.current_value += position.current_value;
      if (amount !== null) {
        assetTotal.net_invested += amount;
      }
    }
  }

  const all = Array.from(totals.values());
  return [
    ...all.filter((row) => row.member_id !== "family"),
    ...all.filter((row) => row.member_id === "family"),
  ];
}

export function xirr(cashflows: Array<[string, number]>): number | null {
  const flows = cashflows.filter(([, amount]) => amount !== 0);
  if (
    flows.length < 2 ||
    !flows.some(([, amount]) => amount < 0) ||
    !flows.some(([, amount]) => amount > 0)
  ) {
    return null;
  }

  const origin = flows.reduce(
    (min, [day]) => (day < min ? day : min),
    flows[0][0],
  );
  const dated = flows.map(([day, amount]): [number, number] => [
    daysBetween(origin, day) / 365.0,
    amount,
  ]);

  const npv = (logRate: number): number => {
    let total = 0.0;
    for (const [years, amount] of dated) {
      const exponent = Math.max(-700.0, Math.min(700.0, -logRate * years));
      total += amount * Math.exp(exponent);
    }
    return total;
  };

  const boundaries = [
    -9.21, -6.91, -4.61, -2.3, -1.39, -0.69, -0.29, 0.0, 0.1, 0.22, 0.41, 0.69,
    1.1, 1.79, 2.4, 3.4, 4.6, 6.9,
  ];
  const roots: number[] = [];
  let previousRate = boundaries[0];
  let previousValue = npv(previousRate);

  for (const rate of boundaries.slice(1)) {
    const value = npv(rate);
    if (value === 0) {
      roots.push(rate);
    } else if (previousValue !== 0 && value !== 0 && (previousValue < 0) !== (value < 0)) {
      let low = previousRate;
      let high = rate;
      let lowValue = previousValue;
      for (let i = 0; i < 120; i++) {
        const middle = (low + high) / 2;
        const middleValue = npv(middle);
        if (Math.abs(middleValue) < 1e-9) {
          low = middle;
          high = middle;
          break;
        }
        if ((lowValue < 0) !== (middleValue < 0)) {
          high = middle;
        } else {
          low = middle;
          lowValue = middleValue;
        }
      }
      roots.push((low + high) / 2);
    }
    previousRate = rate;
    previousValue = value;
  }

  if (roots.length !== 1) return null;
  const result = Math.expm1(roots[0]);
  return Number.isFinite(result) ? result : null;
}

function netInvested(
  baseline: EnrichedHoldingRow | null,
  baselineDate: string | null,
  transactions: EnrichedTransactionRow[],
): [number | null, boolean] {
  const knownBasis =
    baseline === null || baseline.net_contribution === null
      ? null
      : Number(baseline.net_contribution);
  let invested = knownBasis ?? 0.0;
  let hasFlows = false;
  let hasUntrackedFlow = false;

  for (const row of transactions) {
    if (knownBasis !== null && baselineDate !== null && row.txn_date <= baselineDate) {
      continue;
    }
    const amount = basisChange(row);
    if (amount !== null) {
      invested += amount;
      hasFlows = true;
    } else if (
      knownBasis !== null &&
      row.amount !== null &&
      !["opening", "closing", "billing"].includes(row.narration_kind)
    ) {
      hasUntrackedFlow = true;
    }
  }

  if (knownBasis === null && !hasFlows) {
    return [null, false];
  }
  return [invested, knownBasis !== null && !hasUntrackedFlow];
}

function basisChange(row: EnrichedTransactionRow): number | null {
  if (row.amount === null) return null;
  const amount = Number(row.amount);
  const kind = row.narration_kind;
  if (CONTRIBUTION_KINDS.has(kind)) return amount;
  if (kind === "switch_in") return Math.abs(amount);
  if (kind === "switch_out") return -Math.abs(amount);
  if (kind === "other" && isWithdrawal(row.description)) return -Math.abs(amount);
  return null;
}

function positionXirr(
  position: PortfolioPosition,
  firstSnapshots: Map<string, YearListRow>,
  histories: Map<string, EnrichedTransactionRow[]>,
): number | null {
  const key = `${position.member_id}::${position.tier}`;
  const baselineImport = firstSnapshots.get(key);
  if (!baselineImport) return null;

  const baselineRows = db.holdingsForImport(baselineImport.id);
  const baseline =
    baselineRows.find((row) => row.scheme_name === position.scheme_name) ?? null;
  const endDate = position.as_of_date;
  const coverageStart = baselineImport.as_of_date;

  const flows: Array<[string, number]> =
    baseline !== null ? [[coverageStart, -statementValue(baseline)]] : [];

  const txns =
    histories.get(`${position.member_id}::${position.tier}::${position.scheme_name}`) ?? [];
  for (const row of txns) {
    const day = row.txn_date;
    if ((baseline !== null && day <= coverageStart) || day < coverageStart || day > endDate) {
      continue;
    }
    const flow = cashFlow(row, true);
    if (flow !== 0) {
      flows.push([day, flow]);
    }
  }
  if (flows.length === 0) return null;
  flows.push([endDate, position.current_value]);
  return xirr(flows);
}

function reportedReturns(years: YearListRow[]): ReportedReturnRow[] {
  const latest = new Map<string, YearListRow>();
  for (const row of years) {
    const key = `${row.member_id}::${row.tier}`;
    const prev = latest.get(key);
    if (!prev || row.as_of_date > prev.as_of_date) {
      latest.set(key, row);
    }
  }
  return Array.from(latest.values()).map((row) => ({
    member_id: row.member_id,
    member: row.subscriber_name || "NPS subscriber",
    tier: row.tier,
    reported_xirr: row.xirr,
    as_of_date: row.as_of_date,
  }));
}

function accountReturns(
  current: EnrichedHoldingRow[],
  years: YearListRow[],
  histories: Map<string, EnrichedTransactionRow[]>,
  includeSwitches: boolean,
): Array<CalculatedReturnRow & { _cashflows: Array<[string, number]> }> {
  const currentByAccount = new Map<string, EnrichedHoldingRow[]>();
  for (const row of current) {
    const key = `${row.member_id}::${row.tier}`;
    const list = currentByAccount.get(key) ?? [];
    list.push(row);
    currentByAccount.set(key, list);
  }

  const earliest = new Map<string, YearListRow>();
  for (const row of years) {
    const key = `${row.member_id}::${row.tier}`;
    const prev = earliest.get(key);
    if (!prev || row.as_of_date < prev.as_of_date) {
      earliest.set(key, row);
    }
  }

  const results: Array<CalculatedReturnRow & { _cashflows: Array<[string, number]> }> = [];
  for (const [key, endRows] of currentByAccount.entries()) {
    const start = earliest.get(key);
    if (!start) continue;
    const [memberId, tier] = key.split("::");
    const startDay = start.as_of_date;
    const endDay = endRows.reduce(
      (max, row) => (row.as_of_date > max ? row.as_of_date : max),
      endRows[0].as_of_date,
    );

    const flows: Array<[string, number]> = [[startDay, -Number(start.holdings_value)]];
    const schemes = new Set(endRows.map((row) => row.scheme_name));
    for (const scheme of schemes) {
      const txns = histories.get(`${memberId}::${tier}::${scheme}`) ?? [];
      for (const row of txns) {
        const day = row.txn_date;
        if (day <= startDay || day > endDay) continue;
        const flow = cashFlow(row, includeSwitches);
        if (flow !== 0) {
          flows.push([day, flow]);
        }
      }
    }

    const endValue = endRows.reduce((sum, row) => sum + holdingValue(row), 0);
    flows.push([endDay, endValue]);
    results.push({
      member_id: memberId,
      member: endRows[0].subscriber_name || "NPS subscriber",
      tier,
      calculated_xirr: xirr(flows),
      start_date: startDay,
      end_date: endDay,
      _cashflows: flows,
    });
  }
  return results;
}

function cashFlow(row: EnrichedTransactionRow, includeSwitches: boolean): number {
  if (row.amount === null) return 0.0;
  const value = Number(row.amount);
  const kind = row.narration_kind;
  if (CONTRIBUTION_KINDS.has(kind)) return -value;
  if (kind === "switch_in" || kind === "switch_out") {
    return includeSwitches ? -value : 0.0;
  }
  if (kind === "other" && isWithdrawal(row.description)) return Math.abs(value);
  return 0.0;
}

function isWithdrawal(description: string): boolean {
  const lowered = description.toLowerCase();
  return lowered.includes("withdrawal") || lowered.includes("redemption");
}

function holdingValue(row: EnrichedHoldingRow): number {
  const price = row.latest_nav !== null ? Number(row.latest_nav) : Number(row.statement_nav);
  return Number(row.units) * price;
}

function statementValue(row: EnrichedHoldingRow): number {
  return Number(row.units) * Number(row.statement_nav);
}

export interface XirrTrendPoint {
  period: string;
  as_of_date: string;
  calculated_xirr: number | null;
  statement_xirr: number | null;
}

export function xirrTrends(filters?: {
  member?: string | null;
  tier?: string | null;
  scheme?: string | null;
}): XirrTrendPoint[] {
  const allYears = db.listYears();
  const transactions = db.allCurrentTransactions();

  const histories = new Map<string, EnrichedTransactionRow[]>();
  for (const row of transactions) {
    const key = `${row.member_id ?? ""}::${row.tier}::${row.scheme_name}`;
    const list = histories.get(key) ?? [];
    list.push(row);
    histories.set(key, list);
  }

  const scopedYears = allYears.filter((row) => {
    if (filters?.member && row.member_id !== filters.member) return false;
    if (filters?.tier && row.tier !== filters.tier) return false;
    if (filters?.scheme) {
      const holdings = db.holdingsForImport(row.id);
      if (!holdings.some((h) => h.scheme_name === filters.scheme)) return false;
    }
    return true;
  });

  if (scopedYears.length === 0) return [];

  const periods = Array.from(
    new Set(scopedYears.map((row) => row.financial_year)),
  ).sort((a, b) => a.localeCompare(b));

  const latestPeriod = periods[periods.length - 1];
  const currentHoldings = db.currentHoldingRows();

  const points: XirrTrendPoint[] = [];

  for (const period of periods) {
    const yearsUpToPeriod = scopedYears.filter(
      (row) => row.financial_year <= period,
    );
    const yearsInPeriod = scopedYears.filter(
      (row) => row.financial_year === period,
    );
    const maxAsOf = yearsInPeriod.reduce(
      (max, r) => (r.as_of_date > max ? r.as_of_date : max),
      yearsInPeriod[0].as_of_date,
    );

    // Statement-reported XIRR for this period (holdings-value weighted when multiple accounts)
    let statementXirr: number | null = null;
    if (!filters?.scheme) {
      const reportedRows = yearsInPeriod.filter((r) => r.xirr !== null);
      if (reportedRows.length === 1) {
        statementXirr = Math.round(Number(reportedRows[0].xirr) * 100) / 100;
      } else if (reportedRows.length > 1) {
        const totalWeight = reportedRows.reduce(
          (s, r) => s + Number(r.holdings_value || 0),
          0,
        );
        if (totalWeight > 0) {
          const weighted = reportedRows.reduce(
            (s, r) => s + Number(r.xirr) * Number(r.holdings_value),
            0,
          );
          statementXirr = Math.round((weighted / totalWeight) * 100) / 100;
        }
      }
    }

    // Cumulative calculated XIRR from earliest snapshot up to this period
    const earliestByAccount = new Map<string, YearListRow>();
    const latestUpToByAccount = new Map<string, YearListRow>();
    for (const row of yearsUpToPeriod) {
      const key = `${row.member_id}::${row.tier}`;
      const prevMin = earliestByAccount.get(key);
      if (!prevMin || row.as_of_date < prevMin.as_of_date) {
        earliestByAccount.set(key, row);
      }
      const prevMax = latestUpToByAccount.get(key);
      if (!prevMax || row.as_of_date > prevMax.as_of_date) {
        latestUpToByAccount.set(key, row);
      }
    }

    const combinedFlows: Array<[string, number]> = [];
    for (const [key, start] of earliestByAccount.entries()) {
      const end = latestUpToByAccount.get(key);
      if (!end) continue;
      const [memberId, tier] = key.split("::");
      const startDay = start.as_of_date;
      const endDay = end.as_of_date;

      if (filters?.scheme) {
        const startHoldings = db.holdingsForImport(start.id);
        const baseline =
          startHoldings.find((h) => h.scheme_name === filters.scheme) ?? null;
        if (baseline !== null) {
          combinedFlows.push([startDay, -statementValue(baseline)]);
        }

        const txns =
          histories.get(`${memberId}::${tier}::${filters.scheme}`) ?? [];
        for (const row of txns) {
          const day = row.txn_date;
          if (
            (baseline !== null && day <= startDay) ||
            day < startDay ||
            day > endDay
          ) {
            continue;
          }
          const flow = cashFlow(row, true);
          if (flow !== 0) {
            combinedFlows.push([day, flow]);
          }
        }

        let endVal = 0;
        if (period === latestPeriod) {
          const cur = currentHoldings.find(
            (h) =>
              h.member_id === memberId &&
              h.tier === tier &&
              h.scheme_name === filters.scheme,
          );
          if (cur) endVal = holdingValue(cur);
        } else {
          const endHoldings = db.holdingsForImport(end.id);
          const endRow = endHoldings.find(
            (h) => h.scheme_name === filters.scheme,
          );
          if (endRow) endVal = statementValue(endRow);
        }
        if (endVal > 0) {
          combinedFlows.push([endDay, endVal]);
        }
      } else {
        if (endDay <= startDay) {
          continue;
        }
        combinedFlows.push([startDay, -Number(start.holdings_value)]);
        const endHoldings = db.holdingsForImport(end.id);
        const schemes = new Set(endHoldings.map((h) => h.scheme_name));
        for (const scheme of schemes) {
          const txns = histories.get(`${memberId}::${tier}::${scheme}`) ?? [];
          for (const row of txns) {
            const day = row.txn_date;
            if (day <= startDay || day > endDay) continue;
            const flow = cashFlow(row, false);
            if (flow !== 0) {
              combinedFlows.push([day, flow]);
            }
          }
        }
        const endVal =
          period === latestPeriod
            ? currentHoldings
                .filter((h) => h.member_id === memberId && h.tier === tier)
                .reduce((sum, h) => sum + holdingValue(h), 0)
            : Number(end.holdings_value);
        combinedFlows.push([endDay, endVal]);
      }
    }

    const rawCalc = xirr(combinedFlows);
    const calculatedXirr =
      rawCalc !== null ? Math.round(rawCalc * 10000) / 100 : null;

    points.push({
      period,
      as_of_date: maxAsOf,
      calculated_xirr: calculatedXirr,
      statement_xirr: statementXirr,
    });
  }

  return points;
}

