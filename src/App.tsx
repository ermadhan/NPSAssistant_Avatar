import {
  Download,
  History,
  Landmark,
  LayoutDashboard,
  MoreVertical,
  PieChart,
  ReceiptText,
  RefreshCw,
  FileUp,
} from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AllocationView } from "./components/AllocationView";
import { OverviewView } from "./components/OverviewView";
import { ReviewView } from "./components/ReviewView";
import { SecuritiesView } from "./components/SecuritiesView";
import { StatementsView } from "./components/StatementsView";
import type {
  ActiveView,
  AppStatePayload,
  FilterState,
  ParseResult,
  PortfolioThresholds,
} from "./types";

const EMPTY_STATE: AppStatePayload = {
  years: [],
  currentHoldings: [],
  holdingsByImport: {},
  analytics: {
    positions: [],
    members: [],
    reported_xirr: [],
    calculated_xirr: [],
    member_xirr: [],
  },
  disclosures: [],
  catalog: [],
  notes: { content: "", updated_at: null },
  thresholds: {
    min_gain_inr: null,
    target_asset_class: "Equity",
    target_allocation_pct: null,
    max_deviation_pct: 10,
    updated_at: null,
  },
};

export default function App() {
  const [state, setState] = useState<AppStatePayload>(EMPTY_STATE);
  const [activeView, setActiveView] = useState<ActiveView>("overview");
  const [selectedImport, setSelectedImport] = useState<number | null>(null);
  const [filters, setFilters] = useState<FilterState>({
    member: null,
    tier: null,
    scheme: null,
    year: null,
  });
  const [status, setStatus] = useState("Showing current holdings.");
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const [pending, setPending] = useState<{
    filename: string;
    content: string;
    result: ParseResult;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const fetchState = useCallback(async () => {
    const res = await fetch("/api/state");
    if (!res.ok) return;
    const payload = (await res.json()) as AppStatePayload;
    setState(payload);
    setRefreshTick((t) => t + 1);
  }, []);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const showHoldings = () => {
    setPending(null);
    setSelectedImport(null);
    setFilters({ member: null, tier: null, scheme: null, year: null });
    setActiveView("overview");
    setStatus("Showing current holdings.");
  };

  const handleNavigate = (view: ActiveView) => {
    setPending(null);
    setSelectedImport(null);
    setActiveView(view);
    if (view === "overview") {
      setStatus("Showing the family portfolio.");
    } else {
      setStatus(`Showing ${view}.`);
    }
  };

  const handleFilterChange = (next: FilterState) => {
    setFilters(next);
    setSelectedImport(null);
  };

  const handleLoadStatementClick = () => {
    setMenuOpen(false);
    if (busy) return;
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      setStatus("Statement import cancelled.");
      return;
    }
    setBusy(true);
    setStatus(`Reading ${file.name}...`);
    try {
      const content = await file.text();
      const res = await fetch("/api/statements/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, content }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || "Could not parse statement.");
      }
      setPending({
        filename: file.name,
        content,
        result: payload as ParseResult,
      });
    } catch (err) {
      setStatus(
        `Could not load statement: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSaveHeaderProfile = async (
    fingerprint: string,
    extraAliases: Record<string, Record<string, string[]>>,
  ) => {
    if (!pending) return;
    setBusy(true);
    try {
      const res = await fetch("/api/statements/save-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fingerprint,
          extraAliases,
          filename: pending.filename,
          content: pending.content,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || "Could not save header mapping.");
      }
      setPending({
        ...pending,
        result: payload as ParseResult,
      });
      setStatus("Header mapping saved. Review the reading again, then save.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveStatement = async (
    confirmYear: boolean,
    narrationMap: Record<string, string>,
  ) => {
    if (!pending) return;
    setBusy(true);
    try {
      const res = await fetch("/api/statements/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: pending.filename,
          content: pending.content,
          confirmYear,
          narrationMap,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || "Could not save statement.");
      }
      const savedName = pending.filename;
      await fetchState();
      showHoldings();
      setStatus(`Saved ${savedName}.`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRefreshNavs = async () => {
    setMenuOpen(false);
    if (busy) return;
    setBusy(true);
    setStatus("Fetching latest NAVs from npsnav.in...");
    try {
      const res = await fetch("/api/navs/refresh", { method: "POST" });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || "NAV refresh failed");
      }
      await fetchState();
      setStatus(
        `Linked ${payload.linked.length}. Unmatched ${payload.unmatched.length}. Ambiguous ${payload.ambiguous.length}.`,
      );
    } catch (err) {
      setStatus(
        `NAV refresh failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRefreshSecurities = async (
    manager: "ICICI" | "HDFC" | "LIC" | "SBI",
  ) => {
    if (busy) return;
    setBusy(true);
    setStatus(
      `Fetching the latest official ${manager} portfolio disclosure...`,
    );
    try {
      const res = await fetch("/api/securities/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manager }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || "Official portfolio refresh failed");
      }
      await fetchState();
      setStatus(
        `Saved ${manager} portfolio disclosure dated ${payload.as_of_date}.`,
      );
    } catch (err) {
      setStatus(
        `Official portfolio refresh failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const handleLinkSchemeCode = async (
    statementName: string,
    schemeCode: string,
  ) => {
    const res = await fetch("/api/schemes/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statementName, schemeCode }),
    });
    if (res.ok) {
      await fetchState();
      setStatus(`Saved ${schemeCode} for ${statementName}.`);
    }
  };

  const handleSaveNotes = async (content: string) => {
    try {
      const res = await fetch("/api/notes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || "Could not save notes.");
      }
      setState((prev) => ({ ...prev, notes: payload }));
      setStatus("Saved portfolio notes.");
    } catch (err) {
      setStatus(
        `Could not save notes: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const handleSaveThresholds = async (
    next: Omit<PortfolioThresholds, "updated_at">,
  ) => {
    try {
      const res = await fetch("/api/thresholds", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || "Could not save thresholds.");
      }
      setState((prev) => ({ ...prev, thresholds: payload }));
      setStatus("Saved alert thresholds.");
    } catch (err) {
      setStatus(
        `Could not save thresholds: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const triggerDownload = (kind: "holdings" | "transactions") => {
    setMenuOpen(false);
    const params = new URLSearchParams({ format: "xlsx" });
    if (selectedImport !== null) {
      params.set("importId", String(selectedImport));
    } else if (filters.member !== null) {
      params.set("memberId", filters.member);
    }
    const link = document.createElement("a");
    link.href = `/api/export/${kind}?${params.toString()}`;
    link.download = `${kind}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setStatus(`Wrote ${kind}.xlsx`);
  };

  const navItems: Array<{
    id: ActiveView;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "allocation", label: "Allocation", icon: PieChart },
    { id: "securities", label: "Securities", icon: Landmark },
    { id: "statements", label: "Statements", icon: History },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#F3F5F9] text-[#17243A] font-sans">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={handleFileSelected}
        className="hidden"
      />

      <header className="h-14 bg-white border-b border-[#E1E5ED] px-4 flex items-center justify-between shrink-0">
        <span className="text-[18px] font-semibold text-[#17243A]">
          NPS Family Portfolio
        </span>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            disabled={busy}
            onClick={() => setMenuOpen((o) => !o)}
            title="Portfolio actions"
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-[#F3F5F9] disabled:opacity-50 cursor-pointer"
          >
            <MoreVertical className="w-5 h-5 text-[#17243A]" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 mt-1 w-52 bg-white border border-[#E4E8EF] rounded-lg shadow-lg py-1 z-50">
              <button
                type="button"
                onClick={handleLoadStatementClick}
                className="w-full px-3.5 py-2.5 text-left text-xs text-[#17243A] hover:bg-[#F3F5F9] flex items-center gap-2.5 cursor-pointer"
              >
                <FileUp className="w-4 h-4 text-[#52627A]" />
                Load statement
              </button>
              <button
                type="button"
                onClick={handleRefreshNavs}
                className="w-full px-3.5 py-2.5 text-left text-xs text-[#17243A] hover:bg-[#F3F5F9] flex items-center gap-2.5 cursor-pointer"
              >
                <RefreshCw className="w-4 h-4 text-[#52627A]" />
                Refresh NAVs
              </button>
              <button
                type="button"
                onClick={() => triggerDownload("holdings")}
                className="w-full px-3.5 py-2.5 text-left text-xs text-[#17243A] hover:bg-[#F3F5F9] flex items-center gap-2.5 cursor-pointer"
              >
                <Download className="w-4 h-4 text-[#52627A]" />
                Export holdings
              </button>
              <button
                type="button"
                onClick={() => triggerDownload("transactions")}
                className="w-full px-3.5 py-2.5 text-left text-xs text-[#17243A] hover:bg-[#F3F5F9] flex items-center gap-2.5 cursor-pointer"
              >
                <ReceiptText className="w-4 h-4 text-[#52627A]" />
                Export transactions
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <nav className="w-[96px] shrink-0 bg-white border-r border-[#E1E5ED] py-3 flex flex-col items-center gap-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const selected = activeView === item.id && pending === null;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavigate(item.id)}
                className={`w-[80px] py-2.5 rounded-xl flex flex-col items-center gap-1 text-[11px] transition-colors cursor-pointer ${
                  selected
                    ? "bg-[#EAF0F8] text-[#17243A] font-semibold"
                    : "text-[#52627A] hover:bg-[#F3F5F9]"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <main className="flex-1 min-w-0 p-[18px] overflow-y-auto flex flex-col">
          <div className="px-1 pb-2 flex items-center gap-2 min-h-[26px]">
            {busy && (
              <div className="w-[18px] h-[18px] border-2 border-[#3B6FD8] border-t-transparent rounded-full animate-spin shrink-0" />
            )}
            <span className="text-xs text-[#52627A]">{status}</span>
          </div>

          <div className="flex-1 min-w-0">
            {pending !== null ? (
              <ReviewView
                filename={pending.filename}
                result={pending.result}
                onSaveHeaderProfile={handleSaveHeaderProfile}
                onSaveStatement={handleSaveStatement}
                onCancel={() => {
                  setPending(null);
                  setStatus("Statement import cancelled.");
                }}
                onMessage={(text) => setStatus(text)}
              />
            ) : activeView === "overview" ? (
              <OverviewView
                state={state}
                filters={filters}
                onFilterChange={handleFilterChange}
                onSaveNotes={handleSaveNotes}
                onSaveThresholds={handleSaveThresholds}
                onRefreshNavs={handleRefreshNavs}
                onLinkSchemeCode={handleLinkSchemeCode}
                busy={busy}
              />
            ) : activeView === "allocation" ? (
              <AllocationView
                years={state.years}
                holdingsByImport={state.holdingsByImport}
                filters={filters}
                onFilterChange={handleFilterChange}
                refreshTick={refreshTick}
              />
            ) : activeView === "securities" ? (
              <SecuritiesView
                years={state.years}
                holdingsByImport={state.holdingsByImport}
                filters={filters}
                onFilterChange={handleFilterChange}
                onRefreshSecurities={handleRefreshSecurities}
                busy={busy}
                refreshTick={refreshTick}
              />
            ) : (
              <StatementsView
                state={state}
                filters={filters}
                onFilterChange={handleFilterChange}
                selectedImport={selectedImport}
                onSelectImport={(id) => {
                  setSelectedImport(id);
                  setFilters({
                    member: null,
                    tier: null,
                    scheme: null,
                    year: null,
                  });
                  setStatus("Showing selected statement.");
                }}
                onBackToPortfolio={showHoldings}
                onLinkSchemeCode={handleLinkSchemeCode}
                onRefreshNavs={handleRefreshNavs}
                busy={busy}
                refreshTick={refreshTick}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
