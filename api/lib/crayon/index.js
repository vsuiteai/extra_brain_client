import axios from 'axios';

/**
 * Crayon Competitor Intelligence API Client
 * 
 * This client handles authentication and data retrieval from Crayon's API.
 * Crayon provides competitive intelligence data including win/loss analysis,
 * competitor tracking, and market insights.
 */
class CrayonClient {
  constructor(config) {
    this.baseURL = config.baseURL || 'https://api.crayon.com';
    this.apiKey = config.apiKey;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.accessToken = null;
    this.tokenExpiry = null;
    
    // Create axios instance with default config
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    // Add request interceptor for authentication
    this.client.interceptors.request.use(
      async (config) => {
        await this.ensureAuthenticated();
        config.headers.Authorization = `Bearer ${this.accessToken}`;
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 401) {
          // Token expired, try to refresh
          this.accessToken = null;
          this.tokenExpiry = null;
          await this.ensureAuthenticated();
          
          // Retry the original request
          const originalRequest = error.config;
          originalRequest.headers.Authorization = `Bearer ${this.accessToken}`;
          return this.client(originalRequest);
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Authenticate with Crayon API
   * Crayon typically uses OAuth 2.0 client credentials flow or API key authentication
   */
  async authenticate() {
    try {
      // Try OAuth 2.0 first
      if (this.clientId && this.clientSecret) {
        const response = await axios.post(`${this.baseURL}/oauth/token`, {
          grant_type: 'client_credentials',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          scope: 'read:competitive-intelligence read:win-loss read:analytics'
        }, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });

        this.accessToken = response.data.access_token;
        this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);
        
        return this.accessToken;
      }
      
      // Fallback to API key authentication
      if (this.apiKey) {
        this.accessToken = this.apiKey;
        return this.accessToken;
      }
      
      throw new Error('No authentication method available');
      
    } catch (error) {
      console.error('Crayon authentication failed:', error.response?.data || error.message);
      throw new Error(`Crayon authentication failed: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * Ensure we have a valid access token
   */
  async ensureAuthenticated() {
    if (!this.accessToken || (this.tokenExpiry && Date.now() >= this.tokenExpiry)) {
      await this.authenticate();
    }
  }

  /**
   * Get win/loss data for competitive analysis
   * @param {Object} params - Query parameters
   * @param {string} params.companyId - Company identifier
   * @param {string} params.timeframe - Time period (e.g., '30d', '90d', '1y')
   * @param {string} params.competitor - Specific competitor to analyze (optional)
   * @returns {Promise<Object>} Win/loss data
   */
  async getWinLossData(params = {}) {
    try {
      const queryParams = new URLSearchParams({
        ...params,
        format: 'json'
      });

      const response = await this.client.get(`/api/v1/competitive-intelligence/win-loss?${queryParams}`);
      
      return {
        totalOpportunities: response.data.total_opportunities,
        wins: response.data.wins,
        losses: response.data.losses,
        winRate: response.data.win_rate,
        lossRate: response.data.loss_rate,
        averageDealSize: response.data.average_deal_size,
        topCompetitors: response.data.top_competitors,
        winReasons: response.data.win_reasons,
        lossReasons: response.data.loss_reasons,
        timeframe: params.timeframe || '90d',
        lastUpdated: response.data.last_updated
      };
    } catch (error) {
      console.error('Error fetching win/loss data from Crayon:', error.response?.data || error.message);
      throw new Error(`Failed to fetch win/loss data: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get competitive intelligence summary
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} Competitive intelligence data
   */
  async getCompetitiveIntelligence(params = {}) {
    try {
      const queryParams = new URLSearchParams({
        ...params,
        format: 'json'
      });

      const response = await this.client.get(`/api/v1/competitive-intelligence/summary?${queryParams}`);
      
      return {
        marketPosition: response.data.market_position,
        competitorCount: response.data.competitor_count,
        competitiveThreats: response.data.competitive_threats,
        marketShare: response.data.market_share,
        pricingIntelligence: response.data.pricing_intelligence,
        productIntelligence: response.data.product_intelligence,
        lastUpdated: response.data.last_updated
      };
    } catch (error) {
      console.error('Error fetching competitive intelligence from Crayon:', error.response?.data || error.message);
      throw new Error(`Failed to fetch competitive intelligence: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get competitor analysis data
   * @param {Object} params - Query parameters
   * @returns {Promise<Array>} Competitor analysis data
   */
  async getCompetitorAnalysis(params = {}) {
    try {
      const queryParams = new URLSearchParams({
        ...params,
        format: 'json'
      });

      const response = await this.client.get(`/api/v1/competitors/analysis?${queryParams}`);
      
      return response.data.competitors || [];
    } catch (error) {
      console.error('Error fetching competitor analysis from Crayon:', error.response?.data || error.message);
      throw new Error(`Failed to fetch competitor analysis: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get sales opportunities data
   * @param {Object} params - Query parameters
   * @returns {Promise<Array>} Sales opportunities data
   */
  async getSalesOpportunities(params = {}) {
    try {
      const queryParams = new URLSearchParams({
        ...params,
        format: 'json'
      });

      const response = await this.client.get(`/api/v1/sales/opportunities?${queryParams}`);
      
      return response.data.opportunities || [];
    } catch (error) {
      console.error('Error fetching sales opportunities from Crayon:', error.response?.data || error.message);
      throw new Error(`Failed to fetch sales opportunities: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Calculate win/loss ratio from opportunities data
   * @param {Array} opportunities - Array of opportunity objects
   * @returns {Object} Calculated win/loss metrics
   */
  calculateWinLossRatio(opportunities) {
    if (!opportunities || opportunities.length === 0) {
      return {
        totalOpportunities: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        lossRate: 0,
        winLossRatio: 0
      };
    }

    const wins = opportunities.filter(opp => opp.status === 'won' || opp.outcome === 'won').length;
    const losses = opportunities.filter(opp => opp.status === 'lost' || opp.outcome === 'lost').length;
    const totalOpportunities = wins + losses;

    const winRate = totalOpportunities > 0 ? (wins / totalOpportunities) * 100 : 0;
    const lossRate = totalOpportunities > 0 ? (losses / totalOpportunities) * 100 : 0;
    const winLossRatio = totalOpportunities > 0 ? (wins / totalOpportunities) * 100 : 0;

    return {
      totalOpportunities,
      wins,
      losses,
      winRate,
      lossRate,
      winLossRatio
    };
  }

  /**
   * Health check for the API connection
   * @returns {Promise<boolean>} Connection status
   */
  async healthCheck() {
    try {
      await this.ensureAuthenticated();
      const response = await this.client.get('/api/v1/health');
      return response.status === 200;
    } catch (error) {
      console.error('Crayon health check failed:', error.message);
      return false;
    }
  }
}

/**
 * Create and configure Crayon client instance
 * @param {Object} config - Configuration object
 * @returns {CrayonClient} Configured client instance
 */
export function createCrayonClient(config = {}) {
  const crayonConfig = {
    baseURL: config.baseURL || process.env.CRAYON_BASE_URL,
    apiKey: config.apiKey || process.env.CRAYON_API_KEY,
    clientId: config.clientId || process.env.CRAYON_CLIENT_ID,
    clientSecret: config.clientSecret || process.env.CRAYON_CLIENT_SECRET
  };

  // Validate required configuration
  if (!crayonConfig.apiKey && (!crayonConfig.clientId || !crayonConfig.clientSecret)) {
    throw new Error('Crayon client requires either apiKey or clientId/clientSecret');
  }

  return new CrayonClient(crayonConfig);
}

export default CrayonClient;
