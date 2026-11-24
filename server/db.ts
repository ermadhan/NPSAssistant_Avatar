import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FundNav, ParseResult, PortfolioDisclosure } from "./models.ts";

export interface ImportRecord {
  id: number;
  file_name: string;
  file_hash: string;
  tier: string;
  financial_year: string;
  period_start: string;
  period_end: string;
  fingerprint: string;
  imported_at: string;
  is_current: number;
  year_mismatch_confirmed: number;
}

export interface SnapshotRecord {
  import_id: number;
  pran: string;
  subscriber_name: string;
  scheme_choice: string;
  holdings_value: number;
  contribution_count: number;
  total_contribution: number;
  total_withdrawal: number;
  notional_gain: number;
  charges: number;
  xirr: number | null;
  as_of_date: string;
  nav_date: string | null;
  generation_date: string | null;
}

export interface StoredHoldingRow {
  id: number;
  import_id: number;
  scheme_name: string;
  asset_class: string;
  tier: string;
  units: number;
  statement_nav: number;
  statement_nav_date: string | null;
  market_value: number;
  net_contribution: number | null;
  scheme_code: string | null;
}

export interface StoredContributionRow {
  id: number;
  import_id: number;
  txn_date: string;
  particulars: string;
  uploaded_by: string;
  employee_amount: number;
  employer_amount: number;
  total: number;
  tier: string;
}

export interface StoredTransactionRow {
  id: number;
  import_id: number;
  txn_date: string;
  scheme_name: string;
  description: string;
  narration_kind: string;
  amount: number | null;
  nav: number | null;
  units: number | null;
  tier: string;
}

export interface NavQuoteRecord {
  scheme_code: string;
  scheme_name: string;
  nav: number;
  nav_date: string;
  fetched_at: string;
}

export interface DisclosureRecord {
  id: number;
  fund_manager: string;
  disclosure_date: string;
  source_url: string;
  fetched_at: string;
}

export interface StoredSecurityPosition {
  id: number;
  disclosure_id: number;
  scheme_asset: string;
  tier: string;
  security_name: string;
  isin: string;
  industry: string;
  instrument_type: string;
  quantity: number | null;
  market_value: number;
  portfolio_weight: number;
  rating: string;
}

export interface EnrichedHoldingRow extends StoredHoldingRow {
  as_of_date: string;
  subscriber_name: string;
  pran: string;
  member_id: string;
  financial_year: string;
  latest_nav: number | null;
  latest_nav_date: string | null;
  nav_date?: string | null;
}

export interface EnrichedTransactionRow extends StoredTransactionRow {
  financial_year?: string;
  subscriber_name: string;
  pran?: string;
  member_id?: string;
}

export interface YearListRow {
  id: number;
  tier: string;
  financial_year: string;
  file_name: string;
  as_of_date: string;
  holdings_value: number;
  subscriber_name: string;
  pran: string;
  xirr: number | null;
  member_id: string;
}

export interface EnrichedSecurityRow extends StoredSecurityPosition {
  fund_manager: string;
  disclosure_date: string;
  source_url: string;
  fetched_at: string;
}

function memberIdFor(pran: string, subscriberName: string): string {
  return pran && pran.trim() !== "" ? pran : subscriberName;
}

function isoSecondsNow(): string {
  return new Date().toISOString().slice(0, 19);
}

class InMemoryPortfolioDb {
  private nextImportId = 1;
  private nextHoldingId = 1;
  private nextContributionId = 1;
  private nextTxnId = 1;
  private nextDisclosureId = 1;
  private nextSecurityPositionId = 1;

  public imports: ImportRecord[] = [];
  public snapshots = new Map<number, SnapshotRecord>();
  public holdings: StoredHoldingRow[] = [];
  public contributions: StoredContributionRow[] = [];
  public schemeTransactions: StoredTransactionRow[] = [];
  public formatProfiles = new Map<string, { mapping_json: string; created_at: string }>();
  public narrationAliases = new Map<string, string>();
  public schemeLinks = new Map<string, string>();
  public navQuotes = new Map<string, NavQuoteRecord>();
  public securityDisclosures: DisclosureRecord[] = [];
  public securityPositions: StoredSecurityPosition[] = [];
  public notes: { content: string; updated_at: string | null } = {
    content: "",
    updated_at: null,
  };
  public readonly dataFilePath: string;

  constructor(dataFilePath: string = resolveDataFilePath()) {
    this.dataFilePath = dataFilePath;
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.dataFilePath)) return;
      const raw = fs.readFileSync(this.dataFilePath, "utf-8");
      if (!raw.trim()) return;
      const parsed = JSON.parse(raw) as Partial<{
        nextImportId: number;
        nextHoldingId: number;
        nextContributionId: number;
        nextTxnId: number;
        nextDisclosureId: number;
        nextSecurityPositionId: number;
        imports: ImportRecord[];
        snapshots: Array<[number, SnapshotRecord]>;
        holdings: StoredHoldingRow[];
        contributions: StoredContributionRow[];
        schemeTransactions: StoredTransactionRow[];
        formatProfiles: Array<[string, { mapping_json: string; created_at: string }]>;
        narrationAliases: Array<[string, string]>;
        schemeLinks: Array<[string, string]>;
        navQuotes: Array<[string, NavQuoteRecord]>;
        securityDisclosures: DisclosureRecord[];
        securityPositions: StoredSecurityPosition[];
        notes: { content: string; updated_at: string | null };
      }>;
      this.nextImportId = parsed.nextImportId ?? 1;
      this.nextHoldingId = parsed.nextHoldingId ?? 1;
      this.nextContributionId = parsed.nextContributionId ?? 1;
      this.nextTxnId = parsed.nextTxnId ?? 1;
      this.nextDisclosureId = parsed.nextDisclosureId ?? 1;
      this.nextSecurityPositionId = parsed.nextSecurityPositionId ?? 1;
      this.imports = parsed.imports ?? [];
      this.snapshots = new Map(parsed.snapshots ?? []);
      this.holdings = parsed.holdings ?? [];
      this.contributions = parsed.contributions ?? [];
      this.schemeTransactions = parsed.schemeTransactions ?? [];
      this.formatProfiles = new Map(parsed.formatProfiles ?? []);
      this.narrationAliases = new Map(parsed.narrationAliases ?? []);
      this.schemeLinks = new Map(parsed.schemeLinks ?? []);
      this.navQuotes = new Map(parsed.navQuotes ?? []);
      this.securityDisclosures = parsed.securityDisclosures ?? [];
      this.securityPositions = parsed.securityPositions ?? [];
      this.notes = parsed.notes ?? { content: "", updated_at: null };
    } catch (err) {
      console.warn("Could not load local portfolio data:", err);
    }
  }

  private persist(): void {
    try {
      const dir = path.dirname(this.dataFilePath);
      fs.mkdirSync(dir, { recursive: true });
      const payload = {
        nextImportId: this.nextImportId,
        nextHoldingId: this.nextHoldingId,
        nextContributionId: this.nextContributionId,
        nextTxnId: this.nextTxnId,
        nextDisclosureId: this.nextDisclosureId,
        nextSecurityPositionId: this.nextSecurityPositionId,
        imports: this.imports,
        snapshots: Array.from(this.snapshots.entries()),
        holdings: this.holdings,
        contributions: this.contributions,
        schemeTransactions: this.schemeTransactions,
        formatProfiles: Array.from(this.formatProfiles.entries()),
        narrationAliases: Array.from(this.narrationAliases.entries()),
        schemeLinks: Array.from(this.schemeLinks.entries()),
        navQuotes: Array.from(this.navQuotes.entries()),
        securityDisclosures: this.securityDisclosures,
        securityPositions: this.securityPositions,
        notes: this.notes,
      };
      const tmpPath = `${this.dataFilePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(payload), "utf-8");
      fs.renameSync(tmpPath, this.dataFilePath);
    } catch (err) {
      console.warn("Could not save local portfolio data:", err);
    }
  }

  fileHashExists(fileHash: string): boolean {
    return this.imports.some((imp) => imp.file_hash === fileHash);
  }

  narrationAliasMap(): Record<string, string> {
    return Object.fromEntries(this.narrationAliases.entries());
  }

  saveNarrationAlias(phrase: string, kind: string): void {
    this.narrationAliases.set(phrase, kind);
    this.persist();
  }

  profileMapping(fingerprint: string): string | null {
    return this.formatProfiles.get(fingerprint)?.mapping_json ?? null;
  }

  saveProfile(fingerprint: string, mappingJson: string): void {
    this.formatProfiles.set(fingerprint, {
      mapping_json: mappingJson,
      created_at: isoSecondsNow(),
    });
    this.persist();
  }

  saveImport(result: ParseResult, fileName: string, fileHash: string): number {
    const accountKey = memberIdFor(result.pran, result.subscriber_name);
    for (const imp of this.imports) {
      if (
        imp.tier === result.tier &&
        imp.financial_year === result.financial_year &&
        imp.is_current === 1
      ) {
        const snap = this.snapshots.get(imp.id);
        if (snap && memberIdFor(snap.pran, snap.subscriber_name) === accountKey) {
          imp.is_current = 0;
        }
      }
    }

    const importId = this.nextImportId++;
    this.imports.push({
      id: importId,
      file_name: fileName,
      file_hash: fileHash,
      tier: result.tier,
      financial_year: result.financial_year,
      period_start: result.period_start,
      period_end: result.period_end,
      fingerprint: result.fingerprint,
      imported_at: isoSecondsNow(),
      is_current: 1,
      year_mismatch_confirmed: result.year_mismatch ? 1 : 0,
    });

    this.snapshots.set(importId, {
      import_id: importId,
      pran: result.pran,
      subscriber_name: result.subscriber_name,
      scheme_choice: result.scheme_choice,
      holdings_value: result.holdings_value,
      contribution_count: result.contribution_count,
      total_contribution: result.total_contribution,
      total_withdrawal: result.total_withdrawal,
      notional_gain: result.notional_gain,
      charges: result.charges,
      xirr: result.xirr,
      as_of_date: result.as_of_date,
      nav_date: result.nav_date,
      generation_date: result.generation_date,
    });

    for (const holding of result.holdings) {
      this.holdings.push({
        id: this.nextHoldingId++,
        import_id: importId,
        scheme_name: holding.scheme_name,
        asset_class: holding.asset_class,
        tier: result.tier,
        units: holding.units,
        statement_nav: holding.statement_nav,
        statement_nav_date: result.nav_date,
        market_value: holding.market_value,
        net_contribution: holding.net_contribution,
        scheme_code: this.schemeLinks.get(holding.scheme_name) ?? null,
      });
    }

    for (const row of result.contributions) {
      this.contributions.push({
        id: this.nextContributionId++,
        import_id: importId,
        txn_date: row.txn_date,
        particulars: row.particulars,
        uploaded_by: row.uploaded_by,
        employee_amount: row.employee_amount,
        employer_amount: row.employer_amount,
        total: row.total,
        tier: result.tier,
      });
    }

    for (const row of result.transactions) {
      this.schemeTransactions.push({
        id: this.nextTxnId++,
        import_id: importId,
        txn_date: row.txn_date,
        scheme_name: row.scheme_name,
        description: row.description,
        narration_kind: row.narration_kind,
        amount: row.amount,
        nav: row.nav,
        units: row.units,
        tier: result.tier,
      });
    }

    this.persist();
    return importId;
  }

  listYears(): YearListRow[] {
    const rows: YearListRow[] = [];
    for (const imp of this.imports) {
      if (imp.is_current !== 1) continue;
      const snap = this.snapshots.get(imp.id);
      if (!snap) continue;
      rows.push({
        id: imp.id,
        tier: imp.tier,
        financial_year: imp.financial_year,
        file_name: imp.file_name,
        as_of_date: snap.as_of_date,
        holdings_value: snap.holdings_value,
        subscriber_name: snap.subscriber_name,
        pran: snap.pran,
        xirr: snap.xirr,
        member_id: memberIdFor(snap.pran, snap.subscriber_name),
      });
    }
    rows.sort((a, b) => {
      if (a.as_of_date !== b.as_of_date) return b.as_of_date.localeCompare(a.as_of_date);
      if (a.subscriber_name !== b.subscriber_name) {
        return a.subscriber_name.localeCompare(b.subscriber_name);
      }
      return a.tier.localeCompare(b.tier);
    });
    return rows;
  }

  currentHoldingRows(): EnrichedHoldingRow[] {
    const maxAsOfByAccountTier = new Map<string, string>();
    for (const imp of this.imports) {
      if (imp.is_current !== 1) continue;
      const snap = this.snapshots.get(imp.id);
      if (!snap) continue;
      const key = `${memberIdFor(snap.pran, snap.subscriber_name)}::${imp.tier}`;
      const prev = maxAsOfByAccountTier.get(key);
      if (!prev || snap.as_of_date > prev) {
        maxAsOfByAccountTier.set(key, snap.as_of_date);
      }
    }

    const activeImportIds = new Set<number>();
    for (const imp of this.imports) {
      if (imp.is_current !== 1) continue;
      const snap = this.snapshots.get(imp.id);
      if (!snap) continue;
      const key = `${memberIdFor(snap.pran, snap.subscriber_name)}::${imp.tier}`;
      if (maxAsOfByAccountTier.get(key) === snap.as_of_date) {
        activeImportIds.add(imp.id);
      }
    }

    const rows: EnrichedHoldingRow[] = [];
    for (const h of this.holdings) {
      if (!activeImportIds.has(h.import_id)) continue;
      const imp = this.imports.find((i) => i.id === h.import_id);
      const snap = this.snapshots.get(h.import_id);
      if (!imp || !snap) continue;
      const quote = h.scheme_code ? this.navQuotes.get(h.scheme_code) : undefined;
      rows.push({
        ...h,
        as_of_date: snap.as_of_date,
        subscriber_name: snap.subscriber_name,
        pran: snap.pran,
        member_id: memberIdFor(snap.pran, snap.subscriber_name),
        financial_year: imp.financial_year,
        latest_nav: quote ? quote.nav : null,
        latest_nav_date: quote ? quote.nav_date : null,
        nav_date: quote ? quote.nav_date : null,
      });
    }
    rows.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier.localeCompare(b.tier);
      return a.asset_class.localeCompare(b.asset_class);
    });
    return rows;
  }

  holdingsForImport(importId: number): EnrichedHoldingRow[] {
    const imp = this.imports.find((i) => i.id === importId);
    const snap = this.snapshots.get(importId);
    if (!imp || !snap) return [];
    const rows: EnrichedHoldingRow[] = [];
    for (const h of this.holdings) {
      if (h.import_id !== importId) continue;
      const quote = h.scheme_code ? this.navQuotes.get(h.scheme_code) : undefined;
      rows.push({
        ...h,
        as_of_date: snap.as_of_date,
        subscriber_name: snap.subscriber_name,
        pran: snap.pran,
        member_id: memberIdFor(snap.pran, snap.subscriber_name),
        financial_year: imp.financial_year,
        latest_nav: quote ? quote.nav : null,
        latest_nav_date: quote ? quote.nav_date : null,
      });
    }
    rows.sort((a, b) => a.asset_class.localeCompare(b.asset_class));
    return rows;
  }

  transactionsForImport(importId: number): EnrichedTransactionRow[] {
    const snap = this.snapshots.get(importId);
    if (!snap) return [];
    return this.schemeTransactions
      .filter((t) => t.import_id === importId)
      .map((t) => ({
        ...t,
        subscriber_name: snap.subscriber_name,
      }))
      .sort((a, b) => {
        if (a.txn_date !== b.txn_date) return a.txn_date.localeCompare(b.txn_date);
        if (a.scheme_name !== b.scheme_name) return a.scheme_name.localeCompare(b.scheme_name);
        return a.id - b.id;
      });
  }

  allCurrentTransactions(): EnrichedTransactionRow[] {
    const currentIds = new Set(
      this.imports.filter((i) => i.is_current === 1).map((i) => i.id),
    );
    const rows: EnrichedTransactionRow[] = [];
    for (const t of this.schemeTransactions) {
      if (!currentIds.has(t.import_id)) continue;
      const imp = this.imports.find((i) => i.id === t.import_id);
      const snap = this.snapshots.get(t.import_id);
      if (!imp || !snap) continue;
      rows.push({
        ...t,
        financial_year: imp.financial_year,
        subscriber_name: snap.subscriber_name,
        pran: snap.pran,
        member_id: memberIdFor(snap.pran, snap.subscriber_name),
      });
    }
    rows.sort((a, b) => {
      if (a.txn_date !== b.txn_date) return a.txn_date.localeCompare(b.txn_date);
      if (a.scheme_name !== b.scheme_name) return a.scheme_name.localeCompare(b.scheme_name);
      return a.id - b.id;
    });
    return rows;
  }

  distinctHoldingSchemeNames(): string[] {
    return Array.from(new Set(this.holdings.map((h) => h.scheme_name))).sort();
  }

  setSchemeCode(statementName: string, schemeCode: string): void {
    this.schemeLinks.set(statementName, schemeCode);
    for (const h of this.holdings) {
      if (h.scheme_name === statementName) {
        h.scheme_code = schemeCode;
      }
    }
    this.persist();
  }

  applySavedLinks(): void {
    for (const h of this.holdings) {
      const code = this.schemeLinks.get(h.scheme_name);
      if (code) {
        h.scheme_code = code;
      }
    }
    this.persist();
  }

  saveNavQuote(
    schemeCode: string,
    schemeName: string,
    nav: number,
    navDate: string,
    fetchedAt: string = isoSecondsNow(),
  ): void {
    this.navQuotes.set(schemeCode, {
      scheme_code: schemeCode,
      scheme_name: schemeName,
      nav,
      nav_date: navDate,
      fetched_at: fetchedAt,
    });
    this.persist();
  }

  saveNavQuotes(funds: FundNav[], fetchedAt: string = isoSecondsNow()): void {
    for (const fund of funds) {
      this.navQuotes.set(fund.scheme_code, {
        scheme_code: fund.scheme_code,
        scheme_name: fund.scheme_name,
        nav: fund.nav,
        nav_date: fund.nav_date,
        fetched_at: fetchedAt,
      });
    }
    this.persist();
  }

  saveSecurityDisclosure(disclosure: PortfolioDisclosure): void {
    const fetchedAt = isoSecondsNow();
    let existing = this.securityDisclosures.find(
      (d) =>
        d.fund_manager === disclosure.fund_manager &&
        d.disclosure_date === disclosure.as_of_date,
    );
    if (existing) {
      existing.source_url = disclosure.source_url;
      existing.fetched_at = fetchedAt;
    } else {
      existing = {
        id: this.nextDisclosureId++,
        fund_manager: disclosure.fund_manager,
        disclosure_date: disclosure.as_of_date,
        source_url: disclosure.source_url,
        fetched_at: fetchedAt,
      };
      this.securityDisclosures.push(existing);
    }

    this.securityPositions = this.securityPositions.filter(
      (p) => p.disclosure_id !== existing!.id,
    );
    for (const pos of disclosure.positions) {
      this.securityPositions.push({
        id: this.nextSecurityPositionId++,
        disclosure_id: existing.id,
        scheme_asset: pos.scheme_asset,
        tier: pos.tier,
        security_name: pos.security_name,
        isin: pos.isin,
        industry: pos.industry,
        instrument_type: pos.instrument_type,
        quantity: pos.quantity,
        market_value: pos.market_value,
        portfolio_weight: pos.portfolio_weight,
        rating: pos.rating,
      });
    }
    this.persist();
  }

  latestSecurityDisclosures(): EnrichedSecurityRow[] {
    const maxDateByManager = new Map<string, string>();
    for (const d of this.securityDisclosures) {
      const prev = maxDateByManager.get(d.fund_manager);
      if (!prev || d.disclosure_date > prev) {
        maxDateByManager.set(d.fund_manager, d.disclosure_date);
      }
    }
    const latestIds = new Map<number, DisclosureRecord>();
    for (const d of this.securityDisclosures) {
      if (maxDateByManager.get(d.fund_manager) === d.disclosure_date) {
        latestIds.set(d.id, d);
      }
    }
    const rows: EnrichedSecurityRow[] = [];
    for (const p of this.securityPositions) {
      const d = latestIds.get(p.disclosure_id);
      if (!d) continue;
      rows.push({
        ...p,
        fund_manager: d.fund_manager,
        disclosure_date: d.disclosure_date,
        source_url: d.source_url,
        fetched_at: d.fetched_at,
      });
    }
    rows.sort((a, b) => {
      if (a.fund_manager !== b.fund_manager) return a.fund_manager.localeCompare(b.fund_manager);
      if (a.scheme_asset !== b.scheme_asset) return a.scheme_asset.localeCompare(b.scheme_asset);
      if (a.tier !== b.tier) return a.tier.localeCompare(b.tier);
      return b.market_value - a.market_value;
    });
    return rows;
  }

  getImportFinancialYear(importId: number): string {
    return this.imports.find((i) => i.id === importId)?.financial_year ?? "";
  }

  getNotes(): { content: string; updated_at: string | null } {
    return this.notes;
  }

  saveNotes(content: string): { content: string; updated_at: string | null } {
    this.notes = {
      content,
      updated_at: isoSecondsNow(),
    };
    this.persist();
    return this.notes;
  }
}

function resolveDataFilePath(): string {
  if (process.env.NPS_DATA_FILE) {
    return path.resolve(process.env.NPS_DATA_FILE);
  }
  if (process.env.NPS_DATA_DIR) {
    return path.join(path.resolve(process.env.NPS_DATA_DIR), "portfolio.json");
  }
  if (process.platform === "win32") {
    const base =
      process.env.LOCALAPPDATA ||
      path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "NpsPortfolio", "portfolio.json");
  }
  const base =
    process.env.XDG_DATA_HOME ||
    path.join(os.homedir(), ".local", "share");
  return path.join(base, "NpsPortfolio", "portfolio.json");
}

export const db = new InMemoryPortfolioDb();
