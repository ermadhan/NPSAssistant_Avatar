# NPS Family Portfolio

Local-only web application for families to view all of their NPS accounts on their own Windows PC. Download each member's CRA transaction statement CSV from the NPS website, then load it here. The app displays current units for Tier 1 and Tier 2 and prices them with the latest NAV from [npsnav.in](https://npsnav.in/nps-api).

This application is designed **strictly for local use — not for cloud hosting**. Because NPS statements contain personally identifiable information (PRAN, subscriber name) and personal financial history, all imported statements, narration rules, NAV caches, and security disclosures are stored **exclusively on your local computer** and are never uploaded to any cloud database or third-party server.

## Privacy & Local Persistence

- **No cloud database**: All portfolio data stays on your machine.
- **Windows storage location**: Data is saved automatically to:
  ```text
  %LOCALAPPDATA%\NpsPortfolio\portfolio.json
  ```
- **Custom storage path** (optional): Set the `NPS_DATA_DIR` or `NPS_DATA_FILE` environment variable before starting the server if you want to store your portfolio file in a specific local folder (for example, an encrypted drive or local backup folder).
- **Outbound requests**: The app only makes read-only requests when you explicitly click:
  - **Refresh NAVs** → fetches public scheme NAVs from `npsnav.in`
  - **Refresh ICICI / HDFC / LIC portfolio** → fetches public monthly disclosure workbooks from the official pension fund websites
  Your PRAN, name, holdings, and transactions never leave your computer.

## Portfolio Views

- **Overview** shows scheme positions, current value, estimated net invested, calculated XIRR, and the XIRR reported in the latest statement, plus a consolidated Family & Account balances summary.
- **Allocation** rolls each member and the family up by Tier 1/Tier 2 and Equity, Corporate, Government, and Alternative scheme categories. Current value uses the latest NAV when available and otherwise falls back to the statement NAV.
- **Statements** retains imported statement history and transactions, lets you inspect individual statement snapshots, and allows manual scheme-code linking if needed.
- **Securities** estimates stock, government-bond, corporate-bond, and money-market exposure from the latest supported official Tier 1 and Tier 2 E, C, and G portfolio disclosures from ICICI, HDFC, and LIC Pension Funds.

Overview, Allocation, Securities, and Statements share compact dropdown filters for **Name**, **Tier**, **Scheme**, and **Financial year**. Currency values use Indian numbering (comma grouping below 1 Lakh, then Lakh and Crore), while `.xlsx` exports retain numeric values.

## Statement Importer

- Supports the current CRA CSV transaction statement layout and the legacy FY 2020-21 layout with schemes arranged as columns.
- Unrecognized column layouts prompt for header mapping on the Review screen; unfamiliar transaction narrations prompt for classification and are remembered for future imports.
- Duplicate file imports (by SHA-256 hash) are prevented automatically.
- Accounts are identified by PRAN (or subscriber name if PRAN is missing), so importing a newer statement for one person and tier replaces only that account's current snapshot while preserving older financial-year snapshots in history.

## Running on Windows

### Prerequisites

- **Node.js 22 LTS** (or Node.js 20+) installed from [nodejs.org](https://nodejs.org/). Verify in PowerShell:
  ```powershell
  node -v
  npm -v
  ```

### Install Dependencies

Open PowerShell in the project folder and run:

```powershell
npm install
```

### Start Locally (Recommended for Daily Local Use)

Build the frontend once and start the local Node.js server:

```powershell
npm run build
npm start
```

Or run in development mode:

```powershell
npm run dev
```

Then open your browser to:

```text
http://localhost:3000
```

### Custom Local Data Folder on Windows (Optional)

To keep your local portfolio data in a custom folder instead of `%LOCALAPPDATA%\NpsPortfolio\portfolio.json`:

```powershell
$env:NPS_DATA_DIR = "D:\Private\NpsPortfolioData"
npm start
```

### Backing Up Your Data

To back up your entire imported portfolio, header mappings, narration rules, and cached disclosures, simply copy:

```text
%LOCALAPPDATA%\NpsPortfolio\portfolio.json
```

You can also export holdings and transactions at any time as `.xlsx` spreadsheets from the top-right **Portfolio actions** (`⋮`) menu.
