import { getLatestTAM, getTAMSegmentSize } from "./statista/tam-segment";


// Utility to generate tokens
export function generateTokens(app, payload) {
  const accessToken = app.jwt.sign(payload, { expiresIn: '1d' });
  const refreshToken = app.jwt.sign(payload, { expiresIn: '7d' });
  return { accessToken, refreshToken };
}

// Helper function to calculate market share
const calculateMarketShare = async (companyData) => {
  try {
    const tamData = await getTAMSegmentSize(
      process.env.STATISTIA_API_KEY,
      companyData.industry,
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

// Placeholder for NPS API integration (e.g., Medallia, Delighted)
const getNPSScore = async (companyData) => {
  // TODO: Integrate with NPS API
  // This could be Medallia, Delighted, or custom survey data
  const npsScore = companyData.CustomerExperience?.NPS || 0;
  
  // Normalize NPS to 0-100 scale (NPS typically ranges from -100 to 100)
  return Math.max(0, (npsScore + 100) / 2);
}

// Placeholder for win/loss ratio from CRM or Competitor Intelligence API
const getWinLossRatio = async (companyData) => {
  // TODO: Integrate with CRM API (Salesforce, HubSpot) or Competitor Intelligence API (Crayon)
  const wins = companyData.Sales?.Wins || 0;
  const losses = companyData.Sales?.Losses || 1;
  
  const winLossRatio = (wins / (wins + losses)) * 100;
  return winLossRatio;
}

// Placeholder for competitor benchmark data from Competitor Intelligence API
const getCompetitorBenchmark = async (companyData) => {
  // TODO: Integrate with Competitor Intelligence API (Crayon, SimilarWeb)
  // This would fetch competitor data and calculate relative performance
  
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

export { calculateMarketShare, getNPSScore, getWinLossRatio, getCompetitorBenchmark, calculateWeightedScore };