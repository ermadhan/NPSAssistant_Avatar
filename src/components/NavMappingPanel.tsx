import { Link2, RefreshCw } from "lucide-react";
import React, { useMemo, useState } from "react";
import { formatUnits } from "../lib/format";
import type { EnrichedHoldingRow, FundNav } from "../types";

interface NavMappingPanelProps {
  holdings: EnrichedHoldingRow[];
  catalog: FundNav[];
  onRefreshNavs: () => Promise<void>;
  onLinkSchemeCode: (statementName: string, schemeCode: string) => Promise<void>;
  busy: boolean;
}

interface SchemeSummary {
  schemeName: string;
  schemeCode: string | null;
  latestNav: number | null;
  latestNavDate: string | null;
}

function scoreMatch(statementName: string, fundName: string): number {
  const normStmt = statementName.replace(/\s+/g, " ").trim().toUpperCase();
  const normFund = fundName.replace(/\s+/g, " ").trim().toUpperCase();
  if (normStmt === normFund) return 100;

  let score = 0;
  const tokens = normStmt
    .replace(/[^A-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && t !== "FUND" && t !== "SCHEME" && t !== "PENSION");

  for (const token of tokens) {
    if (normFund.includes(token)) {
      score += token.length === 1 ? 8 : 4;
    }
  }

  const stmtLetter = normStmt.match(/SCHEME\s+([ECGA])\b/)?.[1];
  const fundLetter = normFund.match(/SCHEME\s+([ECGA])\b/)?.[1];
  if (stmtLetter && fundLetter) {
    score += stmtLetter === fundLetter ? 20 : -20;
  }

  const stmtTier2 = normStmt.includes("TIER II") || normStmt.includes("TIER 2");
  const fundTier2 = normFund.includes("TIER II") || normFund.includes("TIER 2");
  if (stmtTier2 === fundTier2) score += 15;
  else score -= 15;

  return score;
}

export const NavMappingPanel: React.FC<NavMappingPanelProps> = ({
  holdings,
  catalog,
  onRefreshNavs,
  onLinkSchemeCode,
  busy,
}) => {
  const [selectedCodes, setSelectedCodes] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [savingScheme, setSavingScheme] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const schemes = useMemo<SchemeSummary[]>(() => {
    const byName = new Map<string, SchemeSummary>();
    for (const row of holdings) {
      if (!byName.has(row.scheme_name)) {
        byName.set(row.scheme_name, {
          schemeName: row.scheme_name,
          schemeCode: row.scheme_code,
          latestNav: row.latest_nav,
          latestNavDate: row.latest_nav_date,
        });
      }
    }
    return Array.from(byName.values()).sort((a, b) =>
      a.schemeName.localeCompare(b.schemeName),
    );
  }, [holdings]);

  const unmappedSchemes = useMemo(
    () => schemes.filter((s) => s.latestNav === null || !s.schemeCode),
    [schemes],
  );

  const filteredCatalog = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (f) =>
        f.scheme_name.toLowerCase().includes(q) ||
        f.scheme_code.toLowerCase().includes(q),
    );
  }, [catalog, searchQuery]);

  if (schemes.length === 0) return null;

  const visibleSchemes = showAll ? schemes : unmappedSchemes;

  const handleSave = async (schemeName: string, code: string) => {
    if (!code) return;
    setSavingScheme(schemeName);
    try {
      await onLinkSchemeCode(schemeName, code);
    } finally {
      setSavingScheme(null);
    }
  };

  if (unmappedSchemes.length === 0 && !showAll) {
    return (
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-xs text-[#657084]">
          All {schemes.length} portfolio schemes are mapped to latest NAV codes.
        </span>
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="text-xs font-medium text-[#3B6FD8] hover:underline cursor-pointer"
        >
          Manage NAV mappings
        </button>
      </div>
    );
  }

  return (
    <section className="bg-white border border-[#E4E8EF] rounded-[14px] p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4 text-[#3B6FD8]" />
          <h2 className="text-[15px] font-semibold text-[#17243A]">
            NAV scheme mapping
          </h2>
          {unmappedSchemes.length > 0 && (
            <span className="rounded-md bg-[#FEF3C7] border border-[#FDE68A] px-2 py-0.5 text-[11px] font-medium text-[#92400E]">
              {unmappedSchemes.length} unmapped
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {unmappedSchemes.length < schemes.length && (
            <button
              type="button"
              onClick={() => setShowAll((prev) => !prev)}
              className="text-xs font-medium text-[#3B6FD8] hover:underline cursor-pointer"
            >
              {showAll
                ? unmappedSchemes.length > 0
                  ? "Show unmapped only"
                  : "Hide mappings"
                : `Show all (${schemes.length})`}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => onRefreshNavs()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#D4DCE8] bg-white text-xs font-medium text-[#17243A] hover:bg-[#F3F5F9] disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
            {catalog.length === 0 ? "Fetch NAV catalog" : "Refresh NAVs"}
          </button>
        </div>
      </div>

      {unmappedSchemes.length > 0 && (
        <p className="text-xs text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-lg px-3 py-2">
          Latest NAV is not stored yet for:{" "}
          {unmappedSchemes.map((s) => s.schemeName).join("; ")}.{" "}
          {catalog.length === 0
            ? "Click Fetch NAV catalog above to load available NPS scheme codes, then select the matching scheme."
            : "Select the matching NPS scheme code below and save to link its latest NAV."}
        </p>
      )}

      {catalog.length > 0 && visibleSchemes.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter NAV catalog by scheme name or code (e.g. ICICI, SM007002)..."
              className="h-8 w-full max-w-[420px] rounded-lg border border-[#D4DCE8] bg-[#F9FAFC] px-2.5 text-xs text-[#17243A] placeholder:text-[#7B8494] focus:bg-white focus:outline-none focus:border-[#3B6FD8]"
            />
            <span className="text-[11px] text-[#7B8494]">
              {filteredCatalog.length} of {catalog.length} catalog schemes shown
            </span>
          </div>

          <div className="flex flex-col divide-y divide-[#F0F2F7] border border-[#E4E8EF] rounded-lg">
            {visibleSchemes.map((item) => {
              const ranked = [...filteredCatalog].sort(
                (a, b) =>
                  scoreMatch(item.schemeName, b.scheme_name) -
                  scoreMatch(item.schemeName, a.scheme_name),
              );
              const suggested = ranked.filter(
                (f) => scoreMatch(item.schemeName, f.scheme_name) >= 25,
              );
              const suggestedCodes = new Set(suggested.map((f) => f.scheme_code));
              const others = ranked.filter(
                (f) => !suggestedCodes.has(f.scheme_code),
              );

              const currentSelected =
                selectedCodes[item.schemeName] ??
                item.schemeCode ??
                (suggested[0]?.scheme_code || "");

              const isDirty =
                currentSelected !== "" && currentSelected !== (item.schemeCode ?? "");

              return (
                <div
                  key={item.schemeName}
                  className="p-3 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5"
                >
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span
                      className="text-xs font-medium text-[#17243A] truncate"
                      title={item.schemeName}
                    >
                      {item.schemeName}
                    </span>
                    <span className="text-[11px] text-[#657084]">
                      {item.schemeCode && item.latestNav !== null
                        ? `Linked: ${item.schemeCode} · Latest NAV ${formatUnits(item.latestNav)}${item.latestNavDate ? ` (${item.latestNavDate})` : ""}`
                        : item.schemeCode
                          ? `Linked code ${item.schemeCode} (refresh NAVs to update quote)`
                          : "Not mapped to any NAV scheme code"}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    <select
                      value={currentSelected}
                      onChange={(e) =>
                        setSelectedCodes((prev) => ({
                          ...prev,
                          [item.schemeName]: e.target.value,
                        }))
                      }
                      className="h-8 w-full sm:w-[380px] rounded-md border border-[#D4DCE8] bg-white px-2 text-xs text-[#17243A] focus:outline-none focus:border-[#3B6FD8]"
                    >
                      <option value="">Select matching NAV scheme...</option>
                      {suggested.length > 0 && (
                        <optgroup label="Suggested matches">
                          {suggested.map((fund) => (
                            <option
                              key={`sug-${fund.scheme_code}`}
                              value={fund.scheme_code}
                            >
                              {fund.scheme_code} — {fund.scheme_name} (NAV{" "}
                              {fund.nav.toFixed(4)})
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {others.length > 0 && (
                        <optgroup
                          label={
                            suggested.length > 0
                              ? "All other NPS schemes"
                              : "Available NPS schemes"
                          }
                        >
                          {others.map((fund) => (
                            <option key={fund.scheme_code} value={fund.scheme_code}>
                              {fund.scheme_code} — {fund.scheme_name} (NAV{" "}
                              {fund.nav.toFixed(4)})
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>

                    <button
                      type="button"
                      disabled={
                        !currentSelected ||
                        (!isDirty && item.latestNav !== null) ||
                        savingScheme === item.schemeName ||
                        busy
                      }
                      onClick={() => handleSave(item.schemeName, currentSelected)}
                      className="px-3.5 h-8 rounded-full bg-[#3B6FD8] text-white text-xs font-medium hover:bg-[#315EC0] disabled:opacity-50 cursor-pointer disabled:cursor-default"
                    >
                      {savingScheme === item.schemeName
                        ? "Saving..."
                        : "Save mapping"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
};
