import axios from 'axios';

/**
 * Get TAM (Total Addressable Market) segment size from Statista API
 * @param {string} apiKey - Your Statista API key
 * @param {string} marketId - Market identifier (e.g., 'ecommerce', 'digital-health')
 * @param {string} region - Region code (e.g., 'US', 'WORLD', 'EU')
 * @param {number} fromYear - Start year for data
 * @param {number} toYear - End year for data
 * @param {string} currency - Currency code (e.g., 'USD', 'EUR')
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} TAM data response
 */
const getTAMSegmentSize = async ({
  apiKey,
  marketId,
  region, 
  fromYear, 
  toYear, 
  currency = 'USD',
  options = {}
}) => {
  try {
    const baseURL = 'https://api.statista.ai/v1';
    const endpoint = 'marketInsights';

    const params = {
      marketId,
      region,
      from: fromYear,
      to: toYear,
      currency,
      ...options
    };

    const response = await axios.get(`${baseURL}${endpoint}`, {
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      params
    });

    return response.data;
  } catch (error) {
    console.error('Error fetching TAM data:', error.response?.data || error.message);
    throw new Error(`Failed to fetch TAM data: ${error.response?.data?.message  || error.message}`)
  }
}

const extractTAMForYear = ({
  statistaResponse,
  year,
  preferActual = true
}) => {
  const series = statistaResponse?.data?.[0]?.series || [];
  const candidates = series.filter(point => point.year === year);

  if (!candidates.length) return null;

  if (preferActual) {
    const actual = candidates.find(point => !point.isForecast);
    if (actual) return { year: actual.year, value: actual.value, isForecast: false };
  }

  return {
    year: candidates[0].year,
    value: candidates[0].value,
    isForecast: candidates[0].isForecast
  }
}

const getLatestTAM = (statistaResponse) => {
  const series = statistaResponse?.data?.[0]?.series || [];
  if (!series.length) return null;

  // Try latest actual data first
  const actuals = series
    .filter(point => !point.isForecast)
    .sort((a, b) => b.year - a.year);

  if (actuals.length) return { year: actuals[0].year, value: actuals[0].value, isForecast: false };

  // Fallback to latest forecast
  const latest = [...series].sort((a, b) => b.year - a.year)[0];
  return { 
    year: latest.year, 
    value: latest.value, 
    isForecast: latest.isForecast 
  };
}

export { getTAMSegmentSize, extractTAMForYear, getLatestTAM };