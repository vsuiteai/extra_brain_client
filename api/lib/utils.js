import PDFDocument from 'pdfkit';
import { Storage } from "@google-cloud/storage";

import { getLatestTAM, getTAMSegmentSize } from "./statista/tam-segment/index.js";
import { createMedalliaClient } from "./medallia/index.js";
import { createCrayonClient } from "./crayon/index.js";
import { runGemini, enforceModelPolicy } from "../../services/aiProviders.js";

const storage = new Storage();
const bucketName = "vsuite-objects";
const bucket = storage.bucket(bucketName);

export const generateDeliverablesContent = async ({ companyData, context, deliverables }) => {
  const { model } = enforceModelPolicy('admin', 'gemini');
  const prompt = `You are producing board-ready deliverables for ${companyData.CompanyName || 'the company'} based on the context. For each deliverable in the list, return a concise, high-signal section in Markdown.
Deliverables: ${JSON.stringify(deliverables)}
Output (strict JSON only):
{"company": string, "sections":[{"title": string, "markdown": string}]}`;

  const raw = await runGemini({ model, prompt, context });
  let cleaned = raw.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  const m = cleaned.match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : cleaned);
}

export const renderPDFBuffer = ({ title, companyName, sections }) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      doc.fontSize(20).text(title || 'Strategic Deliverables Report', { align: 'center' });
      doc.moveDown().fontSize(14).text(companyName || 'Company', { align: 'center' });
      doc.addPage();

      for (const s of sections || []) {
        doc.fontSize(16).text(s.title || 'Section', { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(11).text(s.markdown || '', { align: 'left' });
        doc.addPage();
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

// Utility to generate tokens
export function generateTokens(app, payload) {
  const accessToken = app.jwt.sign(payload, { expiresIn: '1d' });
  const refreshToken = app.jwt.sign(payload, { expiresIn: '7d' });
  return { accessToken, refreshToken };
}

// Helper function to calculate market share
const calculateMarketShare = async (companyData) => {
  try {
    // Fallback to Gemini Deep Research if Statista key is not configured
    if (!process.env.STATISTIA_API_KEY) {
      const research = await fetchMetricsViaGeminiResearch(companyData);
      const ms = Number(
        research?.marketShare ?? 0
      )
      return Number.isFinite(ms) ? ms.toFixed(2) : '0.00';
    }

    const tamData = await getTAMSegmentSize(
      process.env.STATISTIA_API_KEY,
      companyData.Industry,
      'US',
      2024,
      new Date().getFullYear(),
      'USD'
    );
    
    const { value } = getLatestTAM(tamData);
    const revenue = companyData.Financials.Revenue;
    const marketShare = (revenue / value) * 100;
    
    return Math.min(marketShare, 100); // Cap at 100%
  } catch (error) {
    console.error('Error calculating market share:', error);
    return companyData.PeerBenchmarking?.MarketShare || 0;
  }
}

// Medallia NPS API integration
const getNPSScore = async (companyData) => {
  try {
    // Fallback to Gemini Deep Research if Medallia key is not configured
    if (!process.env.MEDALLIA_CLIENT_ID || !process.env.MEDALLIA_CLIENT_SECRET) {
      const research = await fetchMetricsViaGeminiResearch(companyData);
      const nps = Number(
        research?.npsScore ?? 0
      )
      return Number.isFinite(nps) ? nps.toFixed(2) : '0.00';
    }

    // Check if Medallia is configured
    if (!process.env.MEDALLIA_CLIENT_ID || !process.env.MEDALLIA_CLIENT_SECRET) {
      console.warn('Medallia not configured, falling back to stored NPS data');
      return getFallbackNPSScore(companyData);
    }

    // Create Medallia client
    const medalliaClient = createMedalliaClient();
    
    // Get NPS score from Medallia API
    // Use company domain or name as identifier for Medallia
    const companyIdentifier = companyData.domain || companyData.CompanyName || companyData.id;
    const npsData = await medalliaClient.getNPSScore({
      companyId: companyIdentifier,
      timeframe: '90d', // Last 90 days
      segment: 'all' // All customer segments
    });

    // Normalize NPS to 0-100 scale (NPS typically ranges from -100 to 100)
    const normalizedScore = Math.max(0, (npsData.npsScore + 100) / 2);
    
    console.log(`Retrieved NPS score from Medallia: ${npsData.npsScore} (normalized: ${normalizedScore})`);
    
    return normalizedScore;
    
  } catch (error) {
    console.error('Error fetching NPS score from Medallia:', error.message);
    
    // Fallback to stored data or default value
    return getFallbackNPSScore(companyData);
  }
}

// Fallback function for when Medallia is unavailable
const getFallbackNPSScore = (companyData) => {
  const npsScore = companyData.CustomerExperience?.NPS || 0;
  
  // Normalize NPS to 0-100 scale (NPS typically ranges from -100 to 100)
  return Math.max(0, (npsScore + 100) / 2);
}

// Salesforce API integration for win/loss ratio
const getWinLossRatio = async (companyData) => {
  try {
    // Try Salesforce first if configured
    // if (process.env.SALESFORCE_CONSUMER_KEY && process.env.SALESFORCE_CONSUMER_SECRET) {
    //   const salesforceRatio = await getSalesforceWinLossRatio(companyData);
    //   if (salesforceRatio !== null) {
    //     return salesforceRatio;
    //   }
    // }

    // Fallback to Gemini Deep Research if Salesforce is not configured or fails
    const research = await fetchMetricsViaGeminiResearch(companyData);
    const wl = Number(
      research?.winLossRatio ?? 0
    )
    if (Number.isFinite(wl) && wl > 0) {
      return wl.toFixed(2);
    }

    // Final fallback to stored win/loss data
    console.warn('Salesforce not configured, using stored win/loss data');
    return getFallbackWinLossRatio(companyData);
    
  } catch (error) {
    console.error('Error fetching win/loss data:', error.message);
    
    // Fallback to stored data or default value
    return getFallbackWinLossRatio(companyData);
  }
}

// Salesforce win/loss data integration
const getSalesforceWinLossRatio = async (companyData) => {
  try {
    const { SalesforceOAuth2 } = await import('salesforce-oauth2');
    const axios = await import('axios');
    
    // Initialize OAuth2 client
    const oauth2 = new SalesforceOAuth2({
      clientId: process.env.SALESFORCE_CONSUMER_KEY,
      clientSecret: process.env.SALESFORCE_CONSUMER_SECRET,
      redirectUri: process.env.SALESFORCE_REDIRECT_URI || 'http://localhost:8080/oauth/callback',
      environment: process.env.SALESFORCE_LOGIN_URL?.includes('test') ? 'sandbox' : 'production'
    });

    let accessToken;
    
    // Try to get access token using stored refresh token first
    if (process.env.SALESFORCE_REFRESH_TOKEN) {
      try {
        const tokenResponse = await oauth2.refreshToken(process.env.SALESFORCE_REFRESH_TOKEN);
        accessToken = tokenResponse.access_token;
        console.log('Successfully refreshed Salesforce access token');
      } catch (refreshError) {
        console.warn('Failed to refresh Salesforce token:', refreshError.message);
      }
    }
    
    // If no refresh token or refresh failed, try username/password flow
    if (!accessToken && process.env.SALESFORCE_USERNAME && process.env.SALESFORCE_PASSWORD) {
      try {
        const tokenResponse = await oauth2.getToken({
          username: process.env.SALESFORCE_USERNAME,
          password: process.env.SALESFORCE_PASSWORD + (process.env.SALESFORCE_SECURITY_TOKEN || '')
        });
        accessToken = tokenResponse.access_token;
        console.log('Successfully authenticated with Salesforce using username/password');
      } catch (authError) {
        console.warn('Failed to authenticate with Salesforce:', authError.message);
      }
    }
    
    if (!accessToken) {
      console.warn('No valid Salesforce access token available');
      return null;
    }
    
    // Query opportunities from Salesforce using REST API
    const currentYear = new Date().getFullYear();
    const instanceUrl = process.env.SALESFORCE_INSTANCE_URL || 'https://login.salesforce.com';
    
    const query = `
      SELECT StageName, Amount, CloseDate, IsWon, IsClosed, Account.Name
      FROM Opportunity 
      WHERE CloseDate = ${currentYear}
      AND (Account.Name LIKE '%${companyData.CompanyName}%' OR Account.Website LIKE '%${companyData.domain || ''}%')
      AND IsClosed = true
    `;

    const response = await axios.default.get(`${instanceUrl}/services/data/v58.0/query/`, {
      params: { q: query },
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    const result = response.data;
    
    if (!result.records || result.records.length === 0) {
      console.log('No Salesforce opportunities found for company');
      return null;
    }

    const wins = result.records.filter(opp => opp.IsWon === true).length;
    const losses = result.records.filter(opp => opp.IsWon === false).length;
    
    if (wins + losses === 0) {
      console.log('No closed opportunities found in Salesforce');
      return null;
    }
    
    const winLossRatio = (wins / (wins + losses)) * 100;
    
    console.log(`Salesforce win/loss: ${wins} wins, ${losses} losses (ratio: ${winLossRatio.toFixed(2)}%)`);
    
    return winLossRatio.toFixed(2);
    
  } catch (error) {
    console.error('Error fetching Salesforce win/loss data:', error.message);
    return null;
  }
}

// Fallback function for when Crayon is unavailable
const getFallbackWinLossRatio = (companyData) => {
  const wins = companyData.Sales?.Wins || 0;
  const losses = companyData.Sales?.Losses || 1;
  
  const winLossRatio = (wins / (wins + losses)) * 100;
  return winLossRatio;
}

// Crayon Competitor Intelligence API integration for competitor benchmarking
const getCompetitorBenchmark = async (companyData) => {
  try {
    // Fallback to Gemini Deep Research if Crayon key is not configured
    if (!process.env.CRAYON_API_KEY && (!process.env.CRAYON_CLIENT_ID || !process.env.CRAYON_CLIENT_SECRET)) {
      const research = await fetchMetricsViaGeminiResearch(companyData);
      const cb = Number(
        research?.competitorBenchmark ?? 0
      )
      return Number.isFinite(cb) ? cb.toFixed(2) : '0.00';
    }

    // Check if Crayon is configured
    if (!process.env.CRAYON_API_KEY && (!process.env.CRAYON_CLIENT_ID || !process.env.CRAYON_CLIENT_SECRET)) {
      console.warn('Crayon not configured, falling back to stored competitor benchmark data');
      return getFallbackCompetitorBenchmark(companyData);
    }

    // Create Crayon client
    const crayonClient = createCrayonClient();
    
    // Get competitive intelligence data from Crayon API
    const companyIdentifier = companyData.domain || companyData.CompanyName || companyData.id;
    const competitiveData = await crayonClient.getCompetitiveIntelligence({
      companyId: companyIdentifier,
      timeframe: '90d',
      includeMarketPosition: true
    });

    // Calculate relative performance vs industry benchmark
    const marketPosition = competitiveData.marketPosition || 50;
    const marketShare = competitiveData.marketShare || 0;
    
    // Combine market position and market share for benchmark score
    const benchmarkScore = (marketPosition + marketShare) / 2;
    
    console.log(`Retrieved competitor benchmark from Crayon: market position ${marketPosition}, market share ${marketShare}% (benchmark: ${benchmarkScore})`);
    
    return Math.min(benchmarkScore, 150); // Cap at 150% of benchmark
    
  } catch (error) {
    console.error('Error fetching competitor benchmark from Crayon:', error.message);
    
    // Fallback to stored data or default value
    return getFallbackCompetitorBenchmark(companyData);
  }
}

// Fallback function for when Crayon is unavailable
const getFallbackCompetitorBenchmark = (companyData) => {
  const industryBenchmark = companyData.PeerBenchmarking?.IndustryBenchmark || 50;
  const companyPerformance = companyData.PeerBenchmarking?.PerformanceScore || 50;
  
  // Calculate relative performance vs industry benchmark
  const benchmarkScore = (companyPerformance / industryBenchmark) * 100;
  return Math.min(benchmarkScore, 150); // Cap at 150% of benchmark
}

// Calculate weighted competitive index score
const calculateWeightedScore = ({ marketShare, npsScore, winLossRatio, competitorBenchmark }) => {
  // Weight configuration - adjust based on business priorities
  const weights = {
    marketShare: 0.3,      // 30% weight
    npsScore: 0.25,        // 25% weight  
    winLossRatio: 0.25,    // 25% weight
    competitorBenchmark: 0.2 // 20% weight
  };

  const weightedScore = 
    (marketShare * weights.marketShare) +
    (npsScore * weights.npsScore) +
    (winLossRatio * weights.winLossRatio) +
    (competitorBenchmark * weights.competitorBenchmark);

  // Normalize to 0-100 scale
  return Math.round(Math.min(Math.max(weightedScore, 0), 100));
}

// Gemini Deep Research fallback for key metrics
const fetchMetricsViaGeminiResearch = async (companyData) => {
  try {
    const researchModel = process.env.GEMINI_RESEARCH_MODEL || "gemini-1.5-pro";
    const { model } = enforceModelPolicy('admin', 'gemini');
    const chosenModel = researchModel || model;

    const instructions = `You are an analyst with web research capabilities.
Find the most recent, credible values for the following metrics for the specified company.
If exact values are unavailable, infer responsibly and provide ranges with clear caveats.
Return STRICT JSON only with the schema below and include 1-3 credible sources per metric.

Schema:
{
  "marketShare": number (0-100),
  "npsScore": number (0-100),
  "winLossRatio": number (0-100),
  "competitorBenchmark": number (0-150),
  "sources": [
    {"metric": "marketShare"|"npsScore"|"winLossRatio"|"competitorBenchmark", "title": string, "url": string}
  ]
}

Rules:
- Prefer primary sources, recent analyst reports, or official filings.
- Do not return prose, only JSON.
- Normalize NPS to 0-100.
- Win/loss ratio should be win rate percentage (0-100).
- Competitor benchmark is a relative score vs industry = 100 baseline (cap 150).`;

    const context = JSON.stringify({
      company: {
        name: companyData.CompanyName,
        domain: companyData.domain || null,
        industry: companyData.Industry || null,
        revenue: companyData?.Financials?.Revenue || null,
        country: companyData.country || 'US'
      }
    });

    const prompt = `Company: ${companyData.CompanyName} (${companyData.domain || 'domain n/a'})\nIndustry: ${companyData.Industry || 'n/a'}\nFind market share, NPS (normalized 0-100), win rate %, and a competitor benchmark score vs industry baseline 100.`;

    const raw = await runGemini({ model: chosenModel, prompt: `${instructions}\n\n${prompt}`, context });
    try {
      const parsed = JSON.parse(raw);
      return parsed;
    } catch (e) {
      // Try to extract JSON block if model returned extra text
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        return JSON.parse(match[0]);
      }
      throw e;
    }
  } catch (error) {
    console.warn('Gemini research failed, skipping:', error.message);
    return null;
  }
}

// Build comprehensive context for simulation generation
const buildSimulationContext = async (companyData) => {
  try {
    // Gather all relevant data points
    const [baseMarketShare, baseNpsScore, baseWinLossRatio, baseCompetitorBenchmark] = await Promise.all([
      companyData.Financials?.MarketShare || calculateMarketShare(companyData),
      companyData.vSuiteLayers?.BrandIdentity?.NPS || getNPSScore(companyData),
      getWinLossRatio(companyData),
      getCompetitorBenchmark(companyData)
    ]);

    // Optionally augment/override with Gemini Deep Research
    let research = await fetchMetricsViaGeminiResearch(companyData);

    const marketShare = Number(research?.marketShare ?? baseMarketShare) || 0;
    const npsScore = Number(research?.npsScore ?? baseNpsScore) || 0;
    const winLossRatio = Number(research?.winLossRatio ?? baseWinLossRatio) || 0;
    const competitorBenchmark = Number(research?.competitorBenchmark ?? baseCompetitorBenchmark) || 0;

    // Get TAM data for market context
    let tamData = null;
    try {
      tamData = await getTAMSegmentSize(
        process.env.STATISTIA_API_KEY,
        companyData.Industry,
        'US',
        2024,
        new Date().getFullYear(),
        'USD'
      );
    } catch (error) {
      console.warn('Could not fetch TAM data:', error.message);
    }

    const context = {
      company: {
        name: companyData.CompanyName,
        industry: companyData.Industry,
        revenue: companyData.Financials?.Revenue || 0,
        employees: companyData.Headcount || 0,
        founded: companyData.founded || 'Unknown',
        description: companyData.description || 'No description available'
      },
      marketIntelligence: {
        marketShare: marketShare,
        npsScore: npsScore,
        winLossRatio: winLossRatio,
        competitorBenchmark: competitorBenchmark,
        researchSources: Array.isArray(research?.sources) ? research.sources : undefined,
        tamData: tamData ? getLatestTAM(tamData) : null
      },
      financials: companyData.Financials || {},
      peerBenchmarking: companyData.PeerBenchmarking || {},
      customerExperience: companyData.CustomerExperience || {},
      sales: companyData.Sales || {}
    };

    return JSON.stringify(context, null, 2);
  } catch (error) {
    console.error('Error building simulation context:', error);
    return JSON.stringify({
      company: companyData,
      error: 'Could not gather full context'
    }, null, 2);
  }
};

// Generate AI-powered strategic simulation
// Generate AI-powered strategic simulation
const generateSimulation = async ({ companyData, context, prompt, framework, simulationType, scenario }) => {
  try {
    const systemPrompt = `You are a senior strategic consultant creating a Harvard Business School-style case simulation.

COMPANY CONTEXT:
${context}

ANALYSIS FRAMEWORK: ${framework}
SIMULATION TYPE: ${simulationType}
SCENARIO: ${scenario}

PRIMARY PROMPT: ${prompt}

Generate a comprehensive strategic simulation report with the following structure:

{
  "title": "Strategic Simulation: [Company Name] - [Simulation Type]",
  "executiveSummary": "2-3 sentence overview of key findings and recommendations",
  "problemStatement": "Clear definition of the strategic challenge or opportunity",
  "context": {
    "companyOverview": "Brief company background",
    "marketPosition": "Current market position and competitive standing",
    "keyMetrics": "Relevant financial and operational metrics"
  },
  "strategicAnalysis": {
    "framework": "${framework}",
    "analysis": "Detailed analysis using the specified framework",
    "keyInsights": ["Insight 1", "Insight 2", "Insight 3"]
  },
  "scenarios": [
    {
      "name": "Scenario 1",
      "description": "Description of scenario",
      "probability": "High/Medium/Low",
      "financialImpact": "Expected financial impact",
      "strategicImpact": "Strategic implications"
    }
  ],
  "recommendations": [
    {
      "action": "Specific recommended action",
      "rationale": "Why this action is recommended",
      "timeline": "Implementation timeline",
      "resources": "Required resources",
      "risks": "Associated risks"
    }
  ],
  "riskAssessment": {
    "highRisks": ["Risk 1", "Risk 2"],
    "mitigationStrategies": ["Strategy 1", "Strategy 2"],
    "contingencyPlans": ["Plan 1", "Plan 2"]
  },
  "implementationRoadmap": {
    "phase1": {
      "duration": "0-3 months",
      "actions": ["Action 1", "Action 2"],
      "milestones": ["Milestone 1", "Milestone 2"]
    },
    "phase2": {
      "duration": "3-6 months", 
      "actions": ["Action 1", "Action 2"],
      "milestones": ["Milestone 1", "Milestone 2"]
    },
    "phase3": {
      "duration": "6-12 months",
      "actions": ["Action 1", "Action 2"],
      "milestones": ["Milestone 1", "Milestone 2"]
    }
  },
  "roiProjections": {
    "baseline": "Current state metrics",
    "optimistic": "Best case scenario metrics",
    "realistic": "Most likely scenario metrics", 
    "pessimistic": "Worst case scenario metrics",
    "paybackPeriod": "Expected payback period",
    "npv": "Net Present Value estimate"
  },
  "nextSteps": [
    "Immediate action item 1",
    "Immediate action item 2",
    "Immediate action item 3"
  ]
}

Ensure the analysis is:
- Data-driven and evidence-based
- Specific to the company's industry and situation
- Actionable with clear next steps
- Realistic in terms of timelines and resources
- Comprehensive in risk assessment

Return ONLY the JSON object, no additional text.`;

    const { model } = enforceModelPolicy('admin', 'gemini');
    
    const result = await runGemini({
      model,
      prompt: systemPrompt,
      context: context
    });
    
    // Parse the JSON response
    let cleanedResult = result.trim();
    try {      
      // Clean the response - remove markdown code blocks if present
      
      // Remove ```json and ``` markers
      if (cleanedResult.startsWith('```json')) {
        cleanedResult = cleanedResult.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanedResult.startsWith('```')) {
        cleanedResult = cleanedResult.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      
      // Try to extract JSON if there's extra text
      const jsonMatch = cleanedResult.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanedResult = jsonMatch[0];
      }
      
      return JSON.parse(cleanedResult);
    } catch (parseError) {
      console.error('Error parsing AI response:', parseError);
      console.error('Cleaned result:', cleanedResult);
      // Fallback to a structured response if JSON parsing fails
      return {
        title: `${companyData.CompanyName} - ${simulationType} Simulation`,
        executiveSummary: "AI-generated strategic analysis completed",
        problemStatement: "Strategic challenge analysis",
        context: {
          companyOverview: companyData.CompanyName,
          marketPosition: "Analysis in progress",
          keyMetrics: "Metrics being calculated"
        },
        strategicAnalysis: {
          framework: framework,
          analysis: result,
          keyInsights: ["Analysis completed", "Review required"]
        },
        scenarios: [],
        recommendations: [],
        riskAssessment: {
          highRisks: [],
          mitigationStrategies: [],
          contingencyPlans: []
        },
        implementationRoadmap: {
          phase1: { duration: "0-3 months", actions: [], milestones: [] },
          phase2: { duration: "3-6 months", actions: [], milestones: [] },
          phase3: { duration: "6-12 months", actions: [], milestones: [] }
        },
        roiProjections: {
          baseline: "TBD",
          optimistic: "TBD", 
          realistic: "TBD",
          pessimistic: "TBD",
          paybackPeriod: "TBD",
          npv: "TBD"
        },
        nextSteps: ["Review AI analysis", "Validate assumptions", "Refine recommendations"]
      };
    }
    
  } catch (error) {
    console.error('Error generating simulation:', error);
    throw new Error(`Simulation generation failed: ${error.message}`);
  }
};

// ---- NPV/IRR helpers and Scenario ROI calculator ----
const computeNPV = (rate, cashflows) => {
  if (!Array.isArray(cashflows)) return 0;
  // cashflows: [CF0, CF1, ..., CFn] where CF0 is initial (typically negative)
  return cashflows.reduce((acc, cf, t) => acc + (cf / Math.pow(1 + rate, t)), 0);
};

// Simple IRR via Newton-Raphson with safeguards
const computeIRR = (cashflows, guess = 0.1) => {
  let r = guess;
  for (let i = 0; i < 100; i++) {
    let npv = 0;
    let dnpv = 0;
    for (let t = 0; t < cashflows.length; t++) {
      const cf = cashflows[t];
      const denom = Math.pow(1 + r, t);
      npv += cf / denom;
      if (t > 0) dnpv += (-t * cf) / (Math.pow(1 + r, t + 1));
    }
    const newR = r - npv / (dnpv || 1e-9);
    if (!isFinite(newR)) break;
    if (Math.abs(newR - r) < 1e-7) return newR;
    r = Math.max(-0.99, newR);
  }
  return r;
};

// Create yearly cashflows from a projection using NetIncome (fallback EBITDA)
const buildCashflowsFromProjection = ({ projection, years = 5, capexPct = 0.03, nwcPct = 0.01 }) => {
  const ni = Number(projection?.NetIncome);
  const ebitda = Number(projection?.EBITDA);
  const base = isFinite(ni) && ni > 0 ? ni : (isFinite(ebitda) ? ebitda * 0.7 : 0); // rough FCF proxy
  const growth = Number(projection?.growthRate || 0.03);
  const flows = [];
  // CF0 assumed 0 unless provided explicitly via initial investment/sale proceeds
  flows.push(Number(projection?.initialInvestment || 0)); // allow negative for investments, positive for proceeds
  let f = base;
  for (let t = 1; t <= years; t++) {
    if (t > 1) f = f * (1 + growth);
    const capex = -Math.abs(f * capexPct);
    const nwc = -Math.abs(f * nwcPct);
    flows.push(f + capex + nwc);
  }
  // Simple terminal value using Gordon growth with conservative multiple
  const terminalGrowth = Math.min(growth, 0.03);
  const terminalMultiple = Number(projection?.terminalMultiple || 8);
  const terminal = (f * (1 + terminalGrowth)) * terminalMultiple;
  flows[flows.length - 1] += terminal;
  return flows;
};

// Use Gemini to fill missing roiProjections when needed
const fillRoiProjectionsViaGemini = async ({ companyData, simulationResults }) => {
  try {
    const { model } = enforceModelPolicy('admin', 'gemini');
    const ctx = JSON.stringify({
      company: companyData,
      results: simulationResults
    });
    const prompt = `Fill missing roiProjections for the simulation context. Use NetIncome if available, else EBITDA*0.7 as FCF proxy.
Return STRICT JSON only with:
{
  "baseline": {"EBITDA": number, "NetIncome": number, "initialInvestment": number, "growthRate": number, "terminalMultiple": number},
  "optimistic": {"EBITDA": number, "NetIncome": number, "initialInvestment": number, "growthRate": number, "terminalMultiple": number},
  "realistic": {"EBITDA": number, "NetIncome": number, "initialInvestment": number, "growthRate": number, "terminalMultiple": number},
  "pessimistic": {"EBITDA": number, "NetIncome": number, "initialInvestment": number, "growthRate": number, "terminalMultiple": number},
  "discountRate": number
}
Rules:
- discountRate ~ WACC; default 10-12% if unknown.
- optimistic growthRate > realistic > pessimistic.
- initialInvestment positive for sale proceeds, negative for capex/investment.
- Use reasonable ranges based on the context.`;
    const raw = await runGemini({ model, prompt, context: ctx });
    try {
      return JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      return m ? JSON.parse(m[0]) : null;
    }
  } catch (e) {
    console.warn('Gemini roiProjections fill failed:', e.message);
    return null;
  }
};

// Main calculator
const calculateScenarioROI = async ({ companyData, simulationResults, horizonYears = 5 }) => {
  const rp = simulationResults?.roiProjections || {};
  let projections = {
    baseline: rp.baseline,
    optimistic: rp.optimistic,
    realistic: rp.realistic,
    pessimistic: rp.pessimistic,
    discountRate: Number(rp.discountRate)
  };

  // If any projection missing or non-numeric, try Gemini to fill
  const needsFill = ['baseline','optimistic','realistic','pessimistic'].some(k => {
    const obj = projections[k];
    return !obj || (Number(obj?.NetIncome) <= 0 && Number(obj?.EBITDA) <= 0);
  }) || !isFinite(projections.discountRate);

  if (needsFill) {
    const filled = await fillRoiProjectionsViaGemini({ companyData, simulationResults });
    if (filled) {
      projections = {
        baseline: projections.baseline || filled.baseline,
        optimistic: projections.optimistic || filled.optimistic,
        realistic: projections.realistic || filled.realistic,
        pessimistic: projections.pessimistic || filled.pessimistic,
        discountRate: isFinite(projections.discountRate) ? projections.discountRate : Number(filled.discountRate || 0.1)
      };
    }
  }

  const rate = isFinite(projections.discountRate) ? projections.discountRate : 0.1;

  // Choose "realistic" for scenario vs baseline by default
  const baselineCF = buildCashflowsFromProjection({ projection: projections.baseline, years: horizonYears });
  const scenarioCF = buildCashflowsFromProjection({ projection: projections.realistic || projections.optimistic || projections.pessimistic, years: horizonYears });

  const npvBaseline = computeNPV(rate, baselineCF);
  const npvScenario = computeNPV(rate, scenarioCF);
  const irrScenario = computeIRR(scenarioCF);

  const deltaNPV = npvScenario - npvBaseline;
  const roiPct = (Math.abs(npvBaseline) > 1e-6) ? (deltaNPV / Math.abs(npvBaseline)) * 100 : (npvScenario !== 0 ? 100 : 0);

  return {
    discountRate: rate,
    horizonYears,
    baseline: { cashflows: baselineCF, npv: npvBaseline },
    scenario: { cashflows: scenarioCF, npv: npvScenario, irr: irrScenario },
    deltaNPV,
    scenarioRoiPercent: Number(roiPct.toFixed(2))
  };
};

// Run multi-parameter sensitivity sweeps over roiProjections inputs
const runSensitivityAnalysis = ({ baseProjections, horizonYears = 5, sweeps = {} }) => {
  const { baseline, realistic, optimistic, pessimistic, discountRate } = baseProjections || {};
  const scenarioProj = realistic || optimistic || pessimistic || baseline || {};

  const toList = (arr, fallback) => (Array.isArray(arr) && arr.length ? arr : [fallback]).filter(v => v !== undefined);

  const rates = toList(sweeps.discountRate, isFinite(discountRate) ? Number(discountRate) : 0.1);
  const growths = toList(sweeps.growthRate, isFinite(Number(scenarioProj?.growthRate)) ? Number(scenarioProj.growthRate) : 0.03);
  const multiples = toList(sweeps.terminalMultiple, isFinite(Number(scenarioProj?.terminalMultiple)) ? Number(scenarioProj.terminalMultiple) : 8);
  const capexes = toList(sweeps.capexPct, 0.03);
  const nwcs = toList(sweeps.nwcPct, 0.01);

  const results = [];
  for (const r of rates) {
    for (const g of growths) {
      for (const m of multiples) {
        for (const c of capexes) {
          for (const n of nwcs) {
            const baseCF = buildCashflowsFromProjection({ projection: baseline || {}, years: horizonYears, capexPct: Number(c), nwcPct: Number(n) });
            const scenCF = buildCashflowsFromProjection({ projection: { ...scenarioProj, growthRate: Number(g), terminalMultiple: Number(m) }, years: horizonYears, capexPct: Number(c), nwcPct: Number(n) });
            const npvBase = computeNPV(Number(r), baseCF);
            const npvScen = computeNPV(Number(r), scenCF);
            const irrScen = computeIRR(scenCF);
            const deltaNPV = npvScen - npvBase;
            results.push({
              discountRate: Number(r),
              growthRate: Number(g),
              terminalMultiple: Number(m),
              capexPct: Number(c),
              nwcPct: Number(n),
              baselineNPV: npvBase,
              scenarioNPV: npvScen,
              deltaNPV,
              scenarioIRR: irrScen
            });
          }
        }
      }
    }
  }
  return results;
};

export { 
  calculateMarketShare, 
  getNPSScore, 
  getWinLossRatio, 
  getCompetitorBenchmark, 
  calculateWeightedScore,
  buildSimulationContext,
  generateSimulation,
  fetchMetricsViaGeminiResearch,
  computeNPV,
  computeIRR,
  calculateScenarioROI,
  runSensitivityAnalysis
};

// Export storage components for use in controllers
export { storage, bucket };