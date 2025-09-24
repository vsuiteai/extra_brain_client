import axios from 'axios';

/**
 * Medallia API Client for NPS and Customer Experience Data
 * 
 * This client handles authentication and data retrieval from Medallia's API.
 * Medallia typically uses OAuth 2.0 or API key authentication.
 */
class MedalliaClient {
  constructor(config) {
    this.baseURL = config.baseURL || 'https://api.medallia.com';
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
   * Authenticate with Medallia API
   * Medallia typically uses OAuth 2.0 client credentials flow
   */
  async authenticate() {
    try {
      const response = await axios.post(`${this.baseURL}/oauth/token`, {
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope: 'read:nps read:surveys read:analytics'
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      this.accessToken = response.data.access_token;
      this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);
      
      return this.accessToken;
    } catch (error) {
      console.error('Medallia authentication failed:', error.response?.data || error.message);
      throw new Error(`Medallia authentication failed: ${error.response?.data?.error || error.message}`);
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
   * Get NPS score for a specific company or time period
   * @param {Object} params - Query parameters
   * @param {string} params.companyId - Company identifier
   * @param {string} params.timeframe - Time period (e.g., '30d', '90d', '1y')
   * @param {string} params.segment - Customer segment (optional)
   * @returns {Promise<Object>} NPS data
   */
  async getNPSScore(params = {}) {
    try {
      const queryParams = new URLSearchParams({
        ...params,
        format: 'json'
      });

      const response = await this.client.get(`/api/v1/nps?${queryParams}`);
      
      return {
        npsScore: response.data.nps_score,
        totalResponses: response.data.total_responses,
        promoters: response.data.promoters,
        passives: response.data.passives,
        detractors: response.data.detractors,
        lastUpdated: response.data.last_updated,
        timeframe: params.timeframe || '30d'
      };
    } catch (error) {
      console.error('Error fetching NPS score from Medallia:', error.response?.data || error.message);
      throw new Error(`Failed to fetch NPS score: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get customer experience metrics
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} Customer experience data
   */
  async getCustomerExperienceMetrics(params = {}) {
    try {
      const queryParams = new URLSearchParams({
        ...params,
        format: 'json'
      });

      const response = await this.client.get(`/api/v1/customer-experience?${queryParams}`);
      
      return {
        nps: response.data.nps,
        csat: response.data.csat,
        ces: response.data.ces,
        responseRate: response.data.response_rate,
        lastUpdated: response.data.last_updated
      };
    } catch (error) {
      console.error('Error fetching customer experience metrics from Medallia:', error.response?.data || error.message);
      throw new Error(`Failed to fetch customer experience metrics: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get survey responses for analysis
   * @param {Object} params - Query parameters
   * @returns {Promise<Array>} Survey responses
   */
  async getSurveyResponses(params = {}) {
    try {
      const queryParams = new URLSearchParams({
        ...params,
        format: 'json'
      });

      const response = await this.client.get(`/api/v1/surveys/responses?${queryParams}`);
      
      return response.data.responses || [];
    } catch (error) {
      console.error('Error fetching survey responses from Medallia:', error.response?.data || error.message);
      throw new Error(`Failed to fetch survey responses: ${error.response?.data?.message || error.message}`);
    }
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
      console.error('Medallia health check failed:', error.message);
      return false;
    }
  }
}

/**
 * Create and configure Medallia client instance
 * @param {Object} config - Configuration object
 * @returns {MedalliaClient} Configured client instance
 */
export function createMedalliaClient(config = {}) {
  const medalliaConfig = {
    baseURL: config.baseURL || process.env.MEDALLIA_BASE_URL,
    apiKey: config.apiKey || process.env.MEDALLIA_API_KEY,
    clientId: config.clientId || process.env.MEDALLIA_CLIENT_ID,
    clientSecret: config.clientSecret || process.env.MEDALLIA_CLIENT_SECRET
  };

  // Validate required configuration
  if (!medalliaConfig.clientId || !medalliaConfig.clientSecret) {
    throw new Error('Medallia client requires clientId and clientSecret');
  }

  return new MedalliaClient(medalliaConfig);
}

export default MedalliaClient;
