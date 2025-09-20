import { Timestamp } from '@google-cloud/firestore';

import { db } from '../firestore.js';
import { getLatestTAM, getTAMSegmentSize } from '../lib/statista/tam-segment/index.js';
import {
  calculateMarketShare, 
  calculateWeightedScore, 
  getCompetitorBenchmark, 
  getNPSScore,
  getWinLossRatio
} from '../lib/utils.js';

const getMarketShare = async (req, reply) => {
  const { companyId } = req.params;
  const companyDoc = await db.collection('companies').doc(companyId).get();
  if (!companyDoc.exists) {
    return reply.code(404).send({ error: 'Company not found' });
  }

  const companyData = companyDoc.data();
  
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

  return reply.code(200).send({ marketShare });
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

  const scenarioROI = companyData.PeerBenchmarking.ScenarioROI;

  return reply.code(200).send({ scenarioROI });
}

const getSimulationByStatus = async (req, reply) => {
  const { companyId, status } = req.params;
  const companyDoc = await db.collection('companies').doc(companyId).get();
  if (!companyDoc.exists) {
    return reply.code(404).send({ error: 'Company not found' });
  }

  const simulations = await db.collection('simulations').where('companyId', '==', companyId).where('status', '==', status).get();
  const simulationsData = simulations.docs.map(doc => doc.data());
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

export {
  getMarketShare,
  getRevenueGrowth,
  getCompetitiveIndexScore,
  getScenarioROI,
  getSimulationByStatus,
  filterSimulationsByTimeframe,
};