import { createMedalliaClient } from './index.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Test script for Medallia integration
 * Run with: node api/lib/medallia/test.js
 */
async function testMedalliaIntegration() {
  console.log('🧪 Testing Medallia Integration...\n');

  try {
    // Check if Medallia is configured
    if (!process.env.MEDALLIA_CLIENT_ID || !process.env.MEDALLIA_CLIENT_SECRET) {
      console.log('❌ Medallia not configured. Please set the following environment variables:');
      console.log('   - MEDALLIA_CLIENT_ID');
      console.log('   - MEDALLIA_CLIENT_SECRET');
      console.log('   - MEDALLIA_BASE_URL (optional)');
      console.log('\n📖 See MEDALLIA_CONFIG.md for setup instructions.');
      return;
    }

    console.log('✅ Medallia configuration found');
    console.log(`   Base URL: ${process.env.MEDALLIA_BASE_URL || 'https://api.medallia.com'}`);
    console.log(`   Client ID: ${process.env.MEDALLIA_CLIENT_ID.substring(0, 8)}...`);

    // Create Medallia client
    const medalliaClient = createMedalliaClient();
    console.log('\n🔧 Medallia client created successfully');

    // Test health check
    console.log('\n🏥 Testing health check...');
    const isHealthy = await medalliaClient.healthCheck();
    if (isHealthy) {
      console.log('✅ Medallia API is healthy');
    } else {
      console.log('❌ Medallia API health check failed');
      return;
    }

    // Test NPS score retrieval
    console.log('\n📊 Testing NPS score retrieval...');
    const testCompanyId = 'test-company-123';
    const npsData = await medalliaClient.getNPSScore({
      companyId: testCompanyId,
      timeframe: '30d'
    });

    console.log('✅ NPS data retrieved successfully:');
    console.log(`   NPS Score: ${npsData.npsScore}`);
    console.log(`   Total Responses: ${npsData.totalResponses}`);
    console.log(`   Promoters: ${npsData.promoters}`);
    console.log(`   Passives: ${npsData.passives}`);
    console.log(`   Detractors: ${npsData.detractors}`);
    console.log(`   Last Updated: ${npsData.lastUpdated}`);

    // Test customer experience metrics
    console.log('\n📈 Testing customer experience metrics...');
    const cxData = await medalliaClient.getCustomerExperienceMetrics({
      companyId: testCompanyId,
      timeframe: '30d'
    });

    console.log('✅ Customer experience data retrieved successfully:');
    console.log(`   NPS: ${cxData.nps}`);
    console.log(`   CSAT: ${cxData.csat}`);
    console.log(`   CES: ${cxData.ces}`);
    console.log(`   Response Rate: ${cxData.responseRate}%`);

    console.log('\n🎉 All tests passed! Medallia integration is working correctly.');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    
    if (error.message.includes('authentication')) {
      console.log('\n💡 Authentication failed. Please check:');
      console.log('   - MEDALLIA_CLIENT_ID is correct');
      console.log('   - MEDALLIA_CLIENT_SECRET is correct');
      console.log('   - Your Medallia account has API access enabled');
    } else if (error.message.includes('network') || error.message.includes('timeout')) {
      console.log('\n💡 Network error. Please check:');
      console.log('   - MEDALLIA_BASE_URL is correct');
      console.log('   - Your network connection');
      console.log('   - Medallia service status');
    } else {
      console.log('\n💡 Please check the error details and refer to MEDALLIA_CONFIG.md for troubleshooting.');
    }
  }
}

// Run the test
testMedalliaIntegration();
