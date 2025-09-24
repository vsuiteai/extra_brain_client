import { Timestamp } from '@google-cloud/firestore';

import { db } from '../firestore.js';
import { getLatestTAM, getTAMSegmentSize } from '../lib/statista/tam-segment/index.js';
import {
  calculateMarketShare, 
  calculateWeightedScore, 
  getCompetitorBenchmark, 
  getNPSScore,
  getWinLossRatio,
  generateSimulation,
  buildSimulationContext,
  renderPDFBuffer,
  generateDeliverablesContent,
  calculateScenarioROI,
  runSensitivityAnalysis
} from '../lib/utils.js';

const getMarketShare = async (req, reply) => {
  const { companyId } = req.params;
  const companyDoc = await db.collection('companies').doc(companyId).get();
  if (!companyDoc.exists) {
    return reply.code(404).send({ error: 'Company not found' });
  }

  const companyData = companyDoc.data();
  
  try {
    // Fallback to Gemini Deep Research if Statista key is not configured
    if (!process.env.STATISTIA_API_KEY) {
      const research = await fetchMetricsViaGeminiResearch(companyData);
      const ms = Number(
        research?.marketShare ?? 0
      )
      return reply.code(200).send({
        data: { marketShare: Number.isFinite(ms) ? ms.toFixed(2) : '0.00', sources: research?.sources }
      });
    }

    const tamData = await getTAMSegmentSize(
      process.env.STATISTIA_API_KEY,
      companyData.industry,
      'US',
      2024,
      new Date().getFullYear(),
      'USD'
    )

    const { value } = getLatestTAM(tamData);
    const revenue = companyData.Financials.Revenue;

    // Calculate market share
    const marketShare = ((revenue / value) * 100).toFixed(2);

    return reply.code(200).send({ data: { marketShare } });
  } catch (error) {
    console.error('Error fetching market share:', error);
    return reply.code(500).send({ error: 'Failed to fetch market share' });
  }
}

// need to use ERP/Accounting API
const getRevenueGrowth = async (req, reply) => {
  const { companyId } = req.params;
  const companyDoc = await db.collection('companies').doc(companyId).get();
  if (!companyDoc.exists) {
    return reply.code(404).send({ error: 'Company not found' });
  }

  const companyData = companyDoc.data();

  const revenueGrowth = companyData.PeerBenchmarking.RevenueGrowth;

  return reply.code(200).send({ revenueGrowth });
}

// Enhanced implementation with weighted score calculation using Competitor Intelligence API
const getCompetitiveIndexScore = async (req, reply) => {
  const { companyId } = req.params;
  const companyDoc = await db.collection('companies').doc(companyId).get();
  if (!companyDoc.exists) {
    return reply.code(404).send({ error: 'Company not found' });
  }

  const companyData = companyDoc.data();

  try {
    // Get market share (already implemented)
    const marketShare = await calculateMarketShare(companyData);
    
    // Get NPS score (placeholder for NPS API integration)
    const npsScore = await getNPSScore(companyData);
    
    // Get win/loss ratio (placeholder for CRM/Competitor Intelligence API)
    const winLossRatio = await getWinLossRatio(companyData);
    
    // Get competitor benchmark data (placeholder for Competitor Intelligence API)
    const competitorBenchmark = await getCompetitorBenchmark(companyData);

    // Calculate weighted competitive index score
    const competitiveIndexScore = calculateWeightedScore({
      marketShare,
      npsScore,
      winLossRatio,
      competitorBenchmark
    });

    // Store the calculated score back to the database
    await db.collection('companies').doc(companyId).update({
      'PeerBenchmarking.CompetitiveIndexScore': competitiveIndexScore,
      'PeerBenchmarking.LastUpdated': Timestamp.now()
    });

    return reply.code(200).send({ 
      competitiveIndexScore,
      breakdown: {
        marketShare,
        npsScore,
        winLossRatio,
        competitorBenchmark
      }
    });

  } catch (error) {
    console.error('Error calculating competitive index score:', error);
    
    // Fallback to stored value if calculation fails
    const fallbackScore = companyData.PeerBenchmarking?.CompetitiveIndexScore || 0;
    return reply.code(200).send({ 
      competitiveIndexScore: fallbackScore,
      warning: 'Using cached score due to calculation error'
    });
  }
}

// need to calculate NPV/IRR vs baseline using scenario engine
const getScenarioROI = async (req, reply) => {
  const { companyId } = req.params;

  const companyDoc = await db.collection('companies').doc(companyId).get();
  if (!companyDoc.exists) {
    return reply.code(404).send({ error: 'Company not found' });
  }
  const companyData = companyDoc.data();

  try {
    // Use the latest completed simulation as input
    const sims = await db.collection('simulations')
      .where('companyId', '==', companyId)
      .where('status', '==', 'completed')
      .orderBy('updatedAt', 'desc')
      .limit(1)
      .get();

    if (sims.empty) {
      return reply.code(404).send({ error: 'No completed simulations found for company' });
    }

    const sim = sims.docs[0].data();
    const calc = await calculateScenarioROI({ companyData, simulationResults: sim.results, horizonYears: 5 });

    return reply.code(200).send({
      data: {
        scenarioRoiPercent: calc.scenarioRoiPercent,
        discountRate: calc.discountRate,
        horizonYears: calc.horizonYears,
        baselineNPV: calc.baseline.npv,
        scenarioNPV: calc.scenario.npv,
        scenarioIRR: calc.scenario.irr
      }
    });
  } catch (e) {
    console.error('Error computing Scenario ROI:', e);
    return reply.code(500).send({ error: 'Failed to compute Scenario ROI', details: e.message });
  }
}

const getSimulationByStatus = async (req, reply) => {
  const { companyId, status } = req.params;
  const companyDoc = await db.collection('companies').doc(companyId).get();
  if (!companyDoc.exists) {
    return reply.code(404).send({ error: 'Company not found' });
  }

  const simulations = await db.collection('simulations').where('companyId', '==', companyId).where('status', '==', status).get();
  const simulationsData = simulations.docs.map(doc => ({ ...doc.data(), id: doc.id }));
  return reply.code(200).send({ simulationsData });
}

const filterSimulationsByTimeframe = async (req, reply) => {
  const { companyId, days } = req.params;
  const cutoffDate = new Date();
  const companyDoc = await db.collection('companies').doc(companyId).get();
  if (!companyDoc.exists) {
    return reply.code(404).send({ error: 'Company not found' });
  }

  cutoffDate.setDate(cutoffDate.getDate() - days);

  // Convert to Firestore Timestamp
  const cutoffTimestamp = Timestamp.fromDate(cutoffDate);

  const query = db.collection('simulations')
    .where('companyId', '==', companyId)
    .where('updatedAt', '>=', cutoffTimestamp)
    .orderBy('updatedAt', 'desc');
  
  const simulations = await query.get();
  const simulationsData = simulations.docs.map(doc => doc.data());
  return reply.code(200).send({ data: simulationsData });
}

const searchSimulations = async (req, reply) => {
  const { companyId, query } = req.params;
  const companyDoc = await db.collection('companies').doc(companyId).get();
  if (!companyDoc.exists) {
    return reply.code(404).send({ error: 'Company not found' });
  }

  if (!query) {
    return reply.code(400).send({ error: 'Query is required' });
  }

  const simulations = await db.collection('simulations').where('name', '>=', query).where('name', '<=', query + '\uf8ff')
    .get();
  const simulationsData = simulations.docs.map(doc => ({ ...doc.data(), id: doc.id }) );

  return reply.code(200).send({ data: simulationsData });
}

const createSimulation = async (req, reply) => {
  const { companyId } = req.params;
  const { simulationType, framework, scenario } = req.body;
  
  try {
    // Get company data
    const companyDoc = await db.collection('companies').doc(companyId).get();
    if (!companyDoc.exists) {
      return reply.code(404).send({ error: 'Company not found' });
    }
    
    const companyData = companyDoc.data();
    
    // Get brain prompts for Strategic Simulation layer
    const brainPrompts = {
      primary: "Run strategic simulations for acquisitions, divestitures, market expansions, and paradigm shifts using multi-lens frameworks. Provide Harvard-style case narratives with ROI tables.",
      subPrompts: [
        "Simulate divesting a non-core business unit with financial and strategic impacts.",
        "Create a Blue Ocean strategy canvas for entering uncontested markets.", 
        "Perform PESTEL analysis for geopolitical/regulatory disruptions."
      ]
    };
    
    // Determine which prompt to use
    let selectedPrompt = brainPrompts.primary;
    if (simulationType === 'divestiture') {
      selectedPrompt = brainPrompts.subPrompts[0];
    } else if (simulationType === 'blue-ocean') {
      selectedPrompt = brainPrompts.subPrompts[1];
    } else if (simulationType === 'pestel') {
      selectedPrompt = brainPrompts.subPrompts[2];
    }
    
    // Build context from company data + market intelligence
    const context = await buildSimulationContext(companyData);
    
    // Generate simulation using AI
    const simulation = await generateSimulation({
      companyData,
      context,
      prompt: selectedPrompt,
      framework: framework || 'Porter\'s Five Forces',
      simulationType: simulationType || 'strategic-analysis',
      scenario: scenario || 'baseline'
    });
    
    // Save to Firestore
    const simulationDoc = await db.collection('simulations').add({
      companyId,
      name: simulation.title || `${simulationType} Simulation - ${new Date().toLocaleDateString()}`,
      type: simulationType || 'strategic-analysis',
      framework: framework || 'Porter\'s Five Forces',
      status: 'completed',
      results: simulation,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });
    
    return reply.code(201).send({ 
      simulationId: simulationDoc.id,
      simulation: simulation 
    });
    
  } catch (error) {
    console.error('Error creating simulation:', error);
    return reply.code(500).send({ 
      error: 'Failed to create simulation',
      details: error.message 
    });
  }
};

const runScenarioSensitivity = async (req, reply) => {
  const { companyId } = req.params;
  const { sweeps, horizonYears } = req.body || {};

  const companyDoc = await db.collection('companies').doc(companyId).get();
  if (!companyDoc.exists) return reply.code(404).send({ error: 'Company not found' });

  const sims = await db.collection('simulations')
    .where('companyId', '==', companyId)
    .where('status', '==', 'completed')
    .orderBy('updatedAt', 'desc')
    .limit(1)
    .get();

  if (sims.empty) return reply.code(404).send({ error: 'No completed simulations found for company' });

  const sim = sims.docs[0].data();
  const rp = sim?.results?.roiProjections || {};

  const results = runSensitivityAnalysis({
    baseProjections: {
      baseline: rp.baseline,
      optimistic: rp.optimistic,
      realistic: rp.realistic,
      pessimistic: rp.pessimistic,
      discountRate: Number(rp.discountRate)
    },
    horizonYears: Number(horizonYears) || 5,
    sweeps: sweeps || {}
  });

  return reply.code(200).send({ data: results });
}

const generateDeliverablesPDF = async (req, reply) => {
  const { companyId } = req.params;
  const deliverables = req.body?.deliverables || [
    'Harvard-Style Case Reports',
    'Market Heat Maps',
    'ROI & Sensitivity Analysis Tables',
    'Strategic Roadmaps (3-5 Years)',
    'Board-Ready Scenario Playbooks'
  ];

  const companyDoc = await db.collection('companies').doc(companyId).get();
  if (!companyDoc.exists) return reply.code(404).send({ error: 'Company not found' });
  const companyData = companyDoc.data();

  const context = await buildSimulationContext(companyData);
  const content = await generateDeliverablesContent({ companyData, context, deliverables });
  const pdf = await renderPDFBuffer({
    title: 'Strategic Deliverables Report',
    companyName: companyData.CompanyName,
    sections: content.sections || []
  });

  reply.header('Content-Type', 'application/pdf');
  reply.header('Content-Disposition', `attachment: filename="${companyData.CompanyName} - Strategic Deliverables Report.pdf"`);
  return reply.code(200).send({ pdf });
}

export {
  getMarketShare,
  getRevenueGrowth,
  getCompetitiveIndexScore,
  getScenarioROI,
  getSimulationByStatus,
  filterSimulationsByTimeframe,
  searchSimulations,
  createSimulation,
  runScenarioSensitivity,
  generateDeliverablesPDF
};