import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { allocationSummary, familyPortfolio, xirrTrends } from "./server/analytics.ts";
import { db, type AlertAssetClass, type EnrichedHoldingRow } from "./server/db.ts";
import {
  buildSecurityExposure,
  fetchLatestHdfcDisclosure,
  fetchLatestIciciDisclosure,
  fetchLatestLicDisclosure,
  fetchLatestSbiDisclosure,
} from "./server/securities.ts";
import {
  ImportRejected,
  exportHoldingsBuffer,
  exportTransactionsBuffer,
  parseStatement,
  refreshNavs,
  saveHeaderProfile,
  saveSecurityDisclosure,
  saveStatement,
} from "./server/service.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

function rowsForFinancialYear(financialYear: string | null): EnrichedHoldingRow[] {
  const years = db.listYears();
  if (!financialYear) {
    return db.currentHoldingRows();
  }
  const rows: EnrichedHoldingRow[] = [];
  for (const statement of years) {
    if (statement.financial_year !== financialYear) continue;
    for (const row of db.holdingsForImport(statement.id)) {
      rows.push({
        ...row,
        latest_nav: null,
        latest_nav_date: null,
      });
    }
  }
  return rows;
}

function filterHoldingRows(
  rows: EnrichedHoldingRow[],
  filters: {
    member?: string | null;
    tier?: string | null;
    scheme?: string | null;
    year?: string | null;
  },
): EnrichedHoldingRow[] {
  return rows.filter((row) => {
    if (filters.member && row.member_id !== filters.member) return false;
    if (filters.tier && row.tier !== filters.tier) return false;
    if (filters.scheme && row.scheme_name !== filters.scheme) return false;
    if (filters.year && row.financial_year !== filters.year) return false;
    return true;
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "25mb" }));

  app.get("/api/state", (_req, res) => {
    const years = db.listYears();
    const holdingsByImport: Record<number, EnrichedHoldingRow[]> = {};
    for (const y of years) {
      holdingsByImport[y.id] = db.holdingsForImport(y.id);
    }
    const currentHoldings = db.currentHoldingRows();
    const analytics = familyPortfolio();
    const disclosures = db.latestSecurityDisclosures();
    const catalog = Array.from(db.navQuotes.values());
    const notes = db.getNotes();
    const thresholds = db.getThresholds();

    res.json({
      years,
      currentHoldings,
      holdingsByImport,
      analytics,
      disclosures,
      catalog,
      notes,
      thresholds,
    });
  });

  app.get("/api/notes", (_req, res) => {
    res.json(db.getNotes());
  });

  app.put("/api/notes", (req, res) => {
    const { content } = req.body as { content?: unknown };
    if (typeof content !== "string") {
      res.status(400).json({ error: "content must be a string." });
      return;
    }
    const saved = db.saveNotes(content);
    res.json(saved);
  });

  app.get("/api/thresholds", (_req, res) => {
    res.json(db.getThresholds());
  });

  app.put("/api/thresholds", (req, res) => {
    const {
      min_gain_inr,
      target_asset_class,
      target_allocation_pct,
      max_deviation_pct,
    } = req.body as {
      min_gain_inr?: unknown;
      target_asset_class?: unknown;
      target_allocation_pct?: unknown;
      max_deviation_pct?: unknown;
    };

    const validAssets: AlertAssetClass[] = [
      "Equity",
      "Corporate",
      "Government",
      "Alternative",
    ];
    if (
      typeof target_asset_class !== "string" ||
      !validAssets.includes(target_asset_class as AlertAssetClass)
    ) {
      res.status(400).json({ error: "Invalid target_asset_class." });
      return;
    }
    if (
      min_gain_inr !== null &&
      min_gain_inr !== undefined &&
      (typeof min_gain_inr !== "number" || !Number.isFinite(min_gain_inr))
    ) {
      res.status(400).json({ error: "min_gain_inr must be a number or null." });
      return;
    }
    if (
      target_allocation_pct !== null &&
      target_allocation_pct !== undefined &&
      (typeof target_allocation_pct !== "number" ||
        !Number.isFinite(target_allocation_pct) ||
        target_allocation_pct < 0 ||
        target_allocation_pct > 100)
    ) {
      res.status(400).json({
        error: "target_allocation_pct must be between 0 and 100 or null.",
      });
      return;
    }
    if (
      typeof max_deviation_pct !== "number" ||
      !Number.isFinite(max_deviation_pct) ||
      max_deviation_pct < 0 ||
      max_deviation_pct > 100
    ) {
      res.status(400).json({
        error: "max_deviation_pct must be a number between 0 and 100.",
      });
      return;
    }

    const saved = db.saveThresholds({
      min_gain_inr:
        min_gain_inr === undefined || min_gain_inr === null ? null : min_gain_inr,
      target_asset_class: target_asset_class as AlertAssetClass,
      target_allocation_pct:
        target_allocation_pct === undefined || target_allocation_pct === null
          ? null
          : target_allocation_pct,
      max_deviation_pct,
    });
    res.json(saved);
  });

  app.get("/api/xirr-trends", (req, res) => {
    const member = (req.query.member as string) || null;
    const tier = (req.query.tier as string) || null;
    const scheme = (req.query.scheme as string) || null;
    const points = xirrTrends({ member, tier, scheme });
    res.json({ points });
  });

  app.get("/api/allocation", (req, res) => {
    const member = (req.query.member as string) || null;
    const tier = (req.query.tier as string) || null;
    const scheme = (req.query.scheme as string) || null;
    const year = (req.query.year as string) || null;

    const data = familyPortfolio();
    const visibleRows = filterHoldingRows(rowsForFinancialYear(year), {
      member,
      tier,
      scheme,
      year,
    });

    const analyticsByKey = new Map(
      data.positions.map((pos) => [
        `${pos.member_id}::${pos.tier}::${pos.scheme_name}`,
        pos,
      ]),
    );
    const assetNames: Record<string, string> = {
      E: "Equity",
      C: "Corporate",
      G: "Government",
      A: "Alternative",
    };

    const positions = visibleRows.map((holding) => {
      const key = `${holding.member_id}::${holding.tier}::${holding.scheme_name}`;
      const pos = analyticsByKey.get(key);
      const price =
        holding.latest_nav !== null
          ? Number(holding.latest_nav)
          : Number(holding.statement_nav);
      return {
        member_id: holding.member_id,
        member: holding.subscriber_name || "NPS subscriber",
        tier: holding.tier,
        scheme_name: holding.scheme_name,
        asset_class: assetNames[holding.asset_class] ?? "Other",
        current_value: Number(holding.units) * price,
        net_invested: !year ? (pos?.net_invested ?? null) : 0.0,
        invested_complete: !year ? (pos?.invested_complete ?? false) : true,
      };
    });

    const rows = allocationSummary(positions);
    res.json({
      rows,
      hasPositions: positions.length > 0,
      hasVisibleRows: visibleRows.length > 0,
    });
  });

  app.get("/api/securities/exposure", (req, res) => {
    const member = (req.query.member as string) || null;
    const tier = (req.query.tier as string) || null;
    const scheme = (req.query.scheme as string) || null;
    const year = (req.query.year as string) || null;

    const currentRows = filterHoldingRows(rowsForFinancialYear(year), {
      member,
      tier,
      scheme,
      year,
    });
    const disclosures = db.latestSecurityDisclosures();
    const holdingMetrics = new Map<
      string,
      { net_invested: number | null; invested_complete: boolean }
    >();
    if (!year) {
      const portfolio = familyPortfolio();
      for (const pos of portfolio.positions) {
        holdingMetrics.set(
          `${pos.member_id}::${pos.tier}::${pos.scheme_name}`,
          {
            net_invested: pos.net_invested,
            invested_complete: pos.invested_complete,
          },
        );
      }
    }
    const exposure = buildSecurityExposure(
      currentRows,
      disclosures,
      null,
      holdingMetrics,
    );
    const disclosureDates: Record<string, string> = {};
    const sourceUrls = new Set<string>();
    for (const row of disclosures) {
      disclosureDates[row.fund_manager] = row.disclosure_date;
      sourceUrls.add(row.source_url);
    }

    res.json({
      hasHoldings: currentRows.length > 0,
      hasAnyCurrentHoldings: db.currentHoldingRows().length > 0,
      hasDisclosures: disclosures.length > 0,
      disclosureDates,
      sourceUrls: Array.from(sourceUrls).sort(),
      exposure,
    });
  });

  app.get("/api/statements/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid statement ID" });
      return;
    }
    const holdings = db.holdingsForImport(id);
    const transactions = db.transactionsForImport(id);
    res.json({ holdings, transactions });
  });

  app.post("/api/statements/parse", (req, res) => {
    try {
      const { filename, content } = req.body as {
        filename?: string;
        content?: string;
      };
      if (!filename || typeof content !== "string") {
        res.status(400).json({ error: "filename and content are required." });
        return;
      }
      const result = parseStatement(filename, content);
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post("/api/statements/save-profile", (req, res) => {
    try {
      const { fingerprint, extraAliases, filename, content } = req.body as {
        fingerprint?: string;
        extraAliases?: Record<string, Record<string, string[]>>;
        filename?: string;
        content?: string;
      };
      if (!fingerprint || !extraAliases || !filename || typeof content !== "string") {
        res.status(400).json({ error: "Missing required fields." });
        return;
      }
      saveHeaderProfile(fingerprint, extraAliases);
      const result = parseStatement(filename, content);
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post("/api/statements/save", (req, res) => {
    try {
      const { filename, content, confirmYear, narrationMap } = req.body as {
        filename?: string;
        content?: string;
        confirmYear?: boolean;
        narrationMap?: Record<string, string>;
      };
      if (!filename || typeof content !== "string") {
        res.status(400).json({ error: "filename and content are required." });
        return;
      }
      const importId = saveStatement(filename, content, {
        confirmYear: Boolean(confirmYear),
        narrationMap: narrationMap ?? {},
      });
      res.json({ importId });
    } catch (err) {
      const status = err instanceof ImportRejected ? 422 : 400;
      res.status(status).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post("/api/navs/refresh", async (_req, res) => {
    try {
      const outcome = await refreshNavs();
      res.json(outcome);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post("/api/schemes/link", (req, res) => {
    const { statementName, schemeCode } = req.body as {
      statementName?: string;
      schemeCode?: string;
    };
    if (!statementName || !schemeCode) {
      res.status(400).json({ error: "statementName and schemeCode are required." });
      return;
    }
    db.setSchemeCode(statementName, schemeCode);
    res.json({ ok: true });
  });

  app.post("/api/securities/refresh", async (req, res) => {
    try {
      const { manager } = req.body as { manager?: string };
      const fetchers: Record<string, () => Promise<ReturnType<typeof fetchLatestIciciDisclosure> extends Promise<infer T> ? T : never>> = {
        ICICI: fetchLatestIciciDisclosure,
        HDFC: fetchLatestHdfcDisclosure,
        LIC: fetchLatestLicDisclosure,
        SBI: fetchLatestSbiDisclosure,
      };
      const fetcher = manager ? fetchers[manager] : undefined;
      if (!fetcher || !manager) {
        res.status(400).json({ error: "Unsupported pension fund manager." });
        return;
      }
      const disclosure = await fetcher();
      saveSecurityDisclosure(disclosure);
      res.json({
        fund_manager: disclosure.fund_manager,
        as_of_date: disclosure.as_of_date,
        position_count: disclosure.positions.length,
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.get("/api/export/holdings", (req, res) => {
    try {
      const format = req.query.format === "csv" ? "csv" : "xlsx";
      const importId = req.query.importId ? Number(req.query.importId) : null;
      const memberId = (req.query.memberId as string) || null;
      const buf = exportHoldingsBuffer(format, importId, memberId);
      const mime =
        format === "csv"
          ? "text/csv; charset=utf-8"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      res.setHeader("Content-Type", mime);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="holdings.${format}"`,
      );
      res.send(buf);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.get("/api/export/transactions", (req, res) => {
    try {
      const format = req.query.format === "csv" ? "csv" : "xlsx";
      const importId = req.query.importId ? Number(req.query.importId) : null;
      const memberId = (req.query.memberId as string) || null;
      const buf = exportTransactionsBuffer(format, importId, memberId);
      const mime =
        format === "csv"
          ? "text/csv; charset=utf-8"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      res.setHeader("Content-Type", mime);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="transactions.${format}"`,
      );
      res.send(buf);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== "true",
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get("*", (_req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`NPS Family Portfolio listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
