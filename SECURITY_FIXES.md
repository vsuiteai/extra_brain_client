# Security Vulnerability Fixes

## Summary
All 13 npm security vulnerabilities have been successfully resolved.

## Changes Made

### 1. Removed `salesforce-oauth2` package
- **Reason**: Not actively used in the codebase (code was commented out in `api/lib/utils.js`)
- **Impact**: Removed 46 vulnerable transitive dependencies including:
  - `request` (deprecated package with multiple vulnerabilities)
  - `har-validator` with vulnerable `ajv`
  - `cryptiles`, `form-data`, `hawk`, `hoek`, `boom`, `sntp`
  - `tough-cookie`, `underscore`

### 2. Replaced `xlsx` with `exceljs`
- **Reason**: `xlsx` had high severity vulnerabilities:
  - Prototype Pollution (GHSA-4r6h-8v6p-xvw6)
  - Regular Expression Denial of Service (GHSA-5pgg-2g8v-p4x9)
- **Impact**: Secure Excel/CSV file parsing
- **Files Modified**: `api/lib/uploadUtils.js`

## Code Changes

### api/lib/uploadUtils.js
- Replaced `import * as XLSX from 'xlsx'` with `import ExcelJS from 'exceljs'`
- Updated `parseFileHeaders()` to use ExcelJS API
- Updated `parseFileWithMapping()` to use ExcelJS API
- Updated `normalizeMonth()` to handle Excel date serials without XLSX.SSF

## Verification

```bash
npm audit
# Result: found 0 vulnerabilities ✓
```

## Testing Recommendations

1. **File Upload Testing**: Test Excel (.xlsx, .xls) and CSV file uploads to ensure parsing still works correctly
2. **Date Parsing**: Verify that date/month columns are parsed correctly from Excel files
3. **Financial Data Import**: Test the financial data upload workflow end-to-end

## Migration Notes

### ExcelJS vs XLSX API Differences

**Before (XLSX):**
```javascript
const workbook = XLSX.read(buffer, { type: 'buffer' });
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
```

**After (ExcelJS):**
```javascript
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(buffer);
const worksheet = workbook.worksheets[0];
const rows = [];
worksheet.eachRow((row) => {
  rows.push(row.values.slice(1)); // ExcelJS is 1-indexed
});
```

## Dependencies Removed
- `salesforce-oauth2@^0.2.0` (and 46 transitive dependencies)
- `xlsx@^0.18.5` (and 9 transitive dependencies)

## Dependencies Added
- `exceljs@^4.4.0` (82 dependencies, all secure)

## Next Steps
1. Test file upload functionality thoroughly
2. Consider adding integration tests for file parsing
3. Monitor for any new vulnerabilities with `npm audit` regularly
