# Manual Financial Upload Implementation

## Overview
This implementation allows clients to upload Excel/CSV files with financial data and automatically maps columns to vSuite's schema.

## Files Created

### Controllers
- `api/controllers/uploads.controllers.js` - Handles analyze, commit, and status endpoints
- `api/controllers/financial.controllers.js` - Retrieves financial snapshot data

### Routes
- `api/routes/uploads.routes.js` - Upload API routes
- `api/routes/financial.routes.js` - Financial data API routes

### Workers
- `api/workers/uploadWorker.js` - Processes uploads asynchronously

### Utilities
- `api/lib/uploadUtils.js` - File parsing, mapping suggestions, data normalization

## Firestore Collections

### uploads
```javascript
{
  id: string,                 // "upl_..."
  tenantId: string,
  type: "FinancialTemplateV1",
  filename: string,
  storagePath: string,        // GCS path
  status: "pending" | "processing" | "succeeded" | "failed",
  errorMessage?: string,
  rowCount?: number,
  createdAt: Date,
  processedAt?: Date
}
```

### uploadMappings
```javascript
{
  tenantId: string,
  type: "FinancialTemplateV1",
  mapping: {
    month: number,
    revenue: number,
    cogs?: number,
    opex?: number,
    ebitda?: number,
    cash?: number,
    ar?: number,
    ap?: number,
    inventory?: number
  },
  options: {
    headerRow: number,
    dataStartRow: number,
    dateFormat: string
  },
  createdAt: Date,
  updatedAt: Date
}
```

### financialSnapshotMonthly
```javascript
{
  id: string,                 // "{tenantId}_{month}"
  tenantId: string,
  month: string,              // "YYYY-MM"
  revenue: number,
  cogs: number,
  opex: number,
  ebitda: number,
  cash: number | null,
  arDays: number | null,
  apDays: number | null,
  inventoryDays: number | null,
  source: "upload" | "quickbooks" | "xero" | ...,
  updatedAt: Date
}
```

## API Endpoints

### POST /api/uploads/financial/analyze
Upload a file and get column suggestions.

**Query params:** `companyId` (required)

**Request:** multipart/form-data with `file` field

**Response:**
```json
{
  "uploadId": "upl_...",
  "columns": [
    {
      "index": 0,
      "name": "Date",
      "sample": ["01/31/2025", "02/28/2025"]
    }
  ],
  "suggestedMapping": {
    "month": 0,
    "revenue": 1,
    "cogs": 2
  },
  "requiredFields": ["month", "revenue"],
  "optionsDefaults": {
    "headerRow": 1,
    "dataStartRow": 2,
    "dateFormat": "auto"
  }
}
```

### POST /api/uploads/financial/commit
Confirm mapping and start processing.

**Query params:** `companyId` (required)

**Request:**
```json
{
  "uploadId": "upl_...",
  "mapping": {
    "month": 0,
    "revenue": 1,
    "cogs": 2,
    "opex": 3
  },
  "options": {
    "headerRow": 1,
    "dataStartRow": 2,
    "dateFormat": "auto"
  }
}
```

**Response:**
```json
{
  "uploadId": "upl_...",
  "status": "queued"
}
```

### GET /api/uploads/:uploadId
Check upload status.

**Query params:** `companyId` (required)

**Response:**
```json
{
  "id": "upl_...",
  "type": "FinancialTemplateV1",
  "status": "succeeded",
  "rowCount": 18,
  "errorMessage": null,
  "processedAt": "2025-11-11T16:22:12Z"
}
```

### GET /api/financial/summary
Get financial snapshots.

**Query params:** 
- `companyId` (required)
- `startMonth`, `endMonth` (optional)

**Response:**
```json
{
  "data": [
    {
      "month": "2025-01",
      "revenue": 120000,
      "cogs": 45000,
      "opex": 30000,
      "ebitda": 45000,
      "cash": 50000,
      "arDays": 45,
      "apDays": 30,
      "inventoryDays": 60,
      "source": "upload"
    }
  ]
}
```

### GET /api/financial/source
Get current data source info.

**Query params:** `companyId` (required)

**Response:**
```json
{
  "currentSource": "upload",
  "lastUploadAt": "2025-11-11T16:22:12Z",
  "lastIntegrationSyncAt": null
}
```

## Environment Variables

Add to `.env`:
```
GCS_BUCKET=vsuite-objects
```

## Dependencies Added
- `xlsx` - For Excel/CSV parsing

## How It Works

1. **Upload & Analyze**: Client uploads file → system parses headers and samples → suggests column mapping
2. **Commit**: Client confirms/adjusts mapping → system saves mapping for future uploads → starts async processing
3. **Process**: Worker downloads file → parses all rows → normalizes data → upserts into `financialSnapshotMonthly`
4. **Reuse**: Next upload auto-applies saved mapping for one-click processing

## Mapping Heuristics

The system uses a two-tier approach:

1. **Rule-based matching** (primary): Synonym matching for common column names
   - **month**: "month", "period", "date", "periodending"
   - **revenue**: "revenue", "income", "sales", "totalsales"
   - **cogs**: "cogs", "costofgoods", "costofgoodssold"
   - **opex**: "opex", "operatingexpenses", "expenses"
   - And more...

2. **AI-powered fallback** (when needed): Uses Gemini to suggest mappings when:
   - Critical fields (month, revenue) are not found
   - More than 3 fields remain unmatched
   - Handles unusual or custom column names

## Data Normalization

- Removes `$`, `,`, spaces from numbers
- Parses dates in multiple formats (MM/DD/YYYY, YYYY-MM-DD, Excel serial)
- Calculates derived metrics (arDays, apDays, inventoryDays, ebitda)
- Handles missing optional fields gracefully

## Integration with Dashboards

Existing dashboards query `financialSnapshotMonthly` collection and work unchanged. The `source` field indicates data origin ("upload", "quickbooks", "xero", etc.).
