import ExcelJS from 'exceljs';
import { runGemini } from '../../services/aiProviders.js';

// Parse file headers and sample rows
export async function parseFileHeaders(buffer, filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const workbook = new ExcelJS.Workbook();

  if (ext === 'csv') {
    await workbook.csv.read(buffer);
  } else if (ext === 'xlsx' || ext === 'xls') {
    await workbook.xlsx.load(buffer);
  } else {
    throw new Error('Unsupported file format');
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('No worksheet found in file');

  const rows = [];
  worksheet.eachRow((row) => {
    rows.push(row.values.slice(1)); // ExcelJS row.values is 1-indexed
  });

  if (rows.length < 2) throw new Error('File must have at least header and one data row');

  const headerRow = rows[0];
  const sampleRows = rows.slice(1, 6); // First 5 data rows

  const columns = headerRow.map((name, index) => ({
    index,
    name: name || `Column ${index + 1}`,
    sample: sampleRows.map(row => row[index] || '').filter(v => v !== '')
  }));

  return {
    columns,
    options: {
      headerRow: 1,
      dataStartRow: 2,
      dateFormat: 'auto'
    }
  };
}

// Parse full file with mapping
export async function parseFileWithMapping(buffer, filename, options) {
  const ext = filename.split('.').pop().toLowerCase();
  const workbook = new ExcelJS.Workbook();

  if (ext === 'csv') {
    await workbook.csv.read(buffer);
  } else {
    await workbook.xlsx.load(buffer);
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('No worksheet found in file');

  const rows = [];
  worksheet.eachRow((row) => {
    rows.push(row.values.slice(1)); // ExcelJS row.values is 1-indexed
  });

  const dataStartRow = options.dataStartRow || 2;
  return rows.slice(dataStartRow - 1);
}

// Suggest mapping based on header names
export async function suggestMapping(headers) {
  const synonyms = {
    month: ['month', 'period', 'date', 'periodending', 'periodend', 'monthending'],
    revenue: ['revenue', 'income', 'sales', 'totalsales', 'totalincome', 'totalrevenue'],
    cogs: ['cogs', 'costofgoods', 'costofgoodssold', 'cos'],
    opex: ['opex', 'operatingexpenses', 'expenses', 'sgna', 'overhead', 'operatingexpense'],
    ebitda: ['ebitda', 'operatingprofit', 'operatingincome'],
    cash: ['cash', 'cashandcashequivalents', 'cashbalance'],
    ar: ['accountsreceivable', 'ar', 'tradeaccountsreceivable', 'receivables'],
    ap: ['accountspayable', 'ap', 'tradepayables', 'payables'],
    inventory: ['inventory', 'stock', 'inventorybalance']
  };

  const mapping = {};
  const unmatchedFields = [];

  for (const [field, syns] of Object.entries(synonyms)) {
    const idx = bestMatch(syns, headers);
    if (idx !== null) {
      mapping[field] = idx;
    } else {
      unmatchedFields.push(field);
    }
  }

  // Use AI fallback if critical fields are missing
  if (!mapping.month || !mapping.revenue || unmatchedFields.length > 3) {
    try {
      const aiMapping = await suggestMappingWithAI(headers);
      // Merge AI suggestions for missing fields only
      for (const field of unmatchedFields) {
        if (aiMapping[field] !== undefined) {
          mapping[field] = aiMapping[field];
        }
      }
      // Override if AI found critical fields we missed
      if (!mapping.month && aiMapping.month !== undefined) mapping.month = aiMapping.month;
      if (!mapping.revenue && aiMapping.revenue !== undefined) mapping.revenue = aiMapping.revenue;
    } catch (err) {
      console.error('AI mapping fallback failed:', err);
    }
  }

  return mapping;
}

// AI-powered mapping suggestion
async function suggestMappingWithAI(headers) {
  const prompt = `Given these column headers from a financial spreadsheet, map them to our schema fields.

Headers (with index):
${headers.map((h, i) => `${i}: "${h}"`).join('\n')}

Schema fields needed:
- month: period/date column (REQUIRED)
- revenue: total revenue/income/sales (REQUIRED)
- cogs: cost of goods sold (optional)
- opex: operating expenses (optional)
- ebitda: earnings before interest, taxes, depreciation, amortization (optional)
- cash: cash balance (optional)
- ar: accounts receivable (optional)
- ap: accounts payable (optional)
- inventory: inventory balance (optional)

Respond ONLY with a JSON object mapping field names to column indices. Use null for fields that don't exist.
Example: {"month":0,"revenue":1,"cogs":2,"opex":null}

JSON:`;

  const response = await runGemini({
    model: 'gemini-2.0-flash-exp',
    prompt,
    context: ''
  });

  // Extract JSON from response
  const jsonMatch = response.match(/\{[^}]+\}/);
  if (!jsonMatch) throw new Error('Invalid AI response');
  
  return JSON.parse(jsonMatch[0]);
}

function bestMatch(synonyms, headers) {
  const normSyns = synonyms.map(norm);
  let bestIdx = null;
  let bestScore = 0;

  headers.forEach((h, idx) => {
    const nh = norm(h);
    for (const s of normSyns) {
      if (nh.includes(s) || s.includes(nh)) {
        const score = nh === s ? 2 : 1;
        if (score > bestScore) {
          bestScore = score;
          bestIdx = idx;
        }
      }
    }
  });

  return bestIdx;
}

function norm(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Helper functions for data conversion
export function toNumber(v) {
  if (typeof v === 'number') return v;
  if (!v) return 0;
  const str = String(v).replace(/[$,\s]/g, '');
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

export function toOptionalNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  return toNumber(v);
}

export function normalizeMonth(raw) {
  if (!raw) return null;

  // Try parsing as Excel date serial (days since 1900-01-01)
  if (typeof raw === 'number') {
    const excelEpoch = new Date(1900, 0, 1);
    const date = new Date(excelEpoch.getTime() + (raw - 2) * 86400000); // -2 for Excel's leap year bug
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  // Try parsing as string
  const str = String(raw).trim();
  
  // YYYY-MM format
  if (/^\d{4}-\d{2}$/.test(str)) return str;
  
  // Try common date formats
  const patterns = [
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,  // MM/DD/YYYY or DD/MM/YYYY
    /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/,  // YYYY/MM/DD
    /^(\d{1,2})-(\d{1,2})-(\d{4})$/,    // MM-DD-YYYY
    /^(\d{4})-(\d{1,2})-(\d{1,2})$/     // YYYY-MM-DD
  ];

  for (const pattern of patterns) {
    const match = str.match(pattern);
    if (match) {
      let year, month;
      if (match[1].length === 4) {
        year = match[1];
        month = match[2];
      } else {
        year = match[3];
        month = match[1]; // Assume MM/DD/YYYY
      }
      return `${year}-${String(month).padStart(2, '0')}`;
    }
  }

  return null;
}
