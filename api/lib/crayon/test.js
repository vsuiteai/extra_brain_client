import { createCrayonClient } from './index.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Test script for Crayon Competitor Intelligence API integration
 * Run with: node api/lib/crayon/test.js
 */
async function testCrayonIntegration() {
  console.log('🧪 Testing Crayon Competitor Intelligence Integration...\n');

  try {
    // Check if Crayon is configured
    if (!process.env.CRAYON_API_KEY && (!process.env.CRAYON_CLIENT_ID || !process.env.CRAYON_CLIENT_SECRET)) {
      console.log('❌ Crayon not configured. Please set one of the following:');
      console.log('   Option 1 - API Key:');
      console.log('     - CRAYON_API_KEY');
      console.log('   Option 2 - OAuth Credentials:');
      console.log('     - CRAYON_CLIENT_ID');
      console.log('     - CRAYON_CLIENT_SECRET');
      console.log('   Optional:');
      console.log('     - CRAYON_BASE_URL');
      console.log('\n📖 See CRAYON_CONFIG.md for setup instructions.');
      return;
    }

    console.log('✅ Crayon configuration found');
    console.log(`   Base URL: ${process.env.CRAYON_BASE_URL || 'https://api.crayon.com'}`);
    
    if (process.env.CRAYON_API_KEY) {
      console.log(`   API Key: ${process.env.CRAYON_API_KEY.substring(0, 8)}...`);
    } else {
      console.log(`   Client ID: ${process.env.CRAYON_CLIENT_ID.substring(0, 8)}...`);
    }

    // Create Crayon client
    const crayonClient = createCrayonClient();
    console.log('\n🔧 Crayon client created successfully');

    // Test health check
    console.log('\n🏥 Testing health check...');
    const isHealthy = await crayonClient.healthCheck();
    if (isHealthy) {
      console.log('✅ Crayon API is healthy');
    } else {
      console.log('❌ Crayon API health check failed');
      return;
    }

    // Test win/loss data retrieval
    console.log('\n📊 Testing win/loss data retrieval...');
    const testCompanyId = 'test-company-123';
    const winLossData = await crayonClient.getWinLossData({
      companyId: testCompanyId,
      timeframe: '90d'
    });

    console.log('✅ Win/loss data retrieved successfully:');
    console.log(`   Total Opportunities: ${winLossData.totalOpportunities}`);
    console.log(`   Wins: ${winLossData.wins}`);
    console.log(`   Losses: ${winLossData.losses}`);
    console.log(`   Win Rate: ${winLossData.winRate}%`);
    console.log(`   Loss Rate: ${winLossData.lossRate}%`);
    console.log(`   Average Deal Size: $${winLossData.averageDealSize}`);
    console.log(`   Top Competitors: ${winLossData.topCompetitors?.join(', ') || 'None'}`);

    // Test competitive intelligence
    console.log('\n📈 Testing competitive intelligence...');
    const competitiveData = await crayonClient.getCompetitiveIntelligence({
      companyId: testCompanyId,
      timeframe: '90d'
    });

    console.log('✅ Competitive intelligence data retrieved successfully:');
    console.log(`   Market Position: ${competitiveData.marketPosition}`);
    console.log(`   Competitor Count: ${competitiveData.competitorCount}`);
    console.log(`   Market Share: ${competitiveData.marketShare}%`);
    console.log(`   Competitive Threats: ${competitiveData.competitiveThreats?.length || 0} identified`);

    // Test competitor analysis
    console.log('\n🔍 Testing competitor analysis...');
    const competitorAnalysis = await crayonClient.getCompetitorAnalysis({
      companyId: testCompanyId,
      timeframe: '90d'
    });

    console.log('✅ Competitor analysis retrieved successfully:');
    console.log(`   Competitors Analyzed: ${competitorAnalysis.length}`);
    if (competitorAnalysis.length > 0) {
      console.log(`   Top Competitor: ${competitorAnalysis[0].name || 'Unknown'}`);
      console.log(`   Threat Level: ${competitorAnalysis[0].threatLevel || 'Unknown'}`);
    }

    // Test sales opportunities
    console.log('\n💼 Testing sales opportunities...');
    const opportunities = await crayonClient.getSalesOpportunities({
      companyId: testCompanyId,
      timeframe: '90d'
    });

    console.log('✅ Sales opportunities retrieved successfully:');
    console.log(`   Total Opportunities: ${opportunities.length}`);
    
    if (opportunities.length > 0) {
      const winLossRatio = crayonClient.calculateWinLossRatio(opportunities);
      console.log(`   Calculated Win Rate: ${winLossRatio.winRate}%`);
      console.log(`   Calculated Loss Rate: ${winLossRatio.lossRate}%`);
    }

    console.log('\n🎉 All tests passed! Crayon integration is working correctly.');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    
    if (error.message.includes('authentication')) {
      console.log('\n💡 Authentication failed. Please check:');
      console.log('   - CRAYON_API_KEY is correct (if using API key)');
      console.log('   - CRAYON_CLIENT_ID and CRAYON_CLIENT_SECRET are correct (if using OAuth)');
      console.log('   - Your Crayon account has API access enabled');
    } else if (error.message.includes('network') || error.message.includes('timeout')) {
      console.log('\n💡 Network error. Please check:');
      console.log('   - CRAYON_BASE_URL is correct');
      console.log('   - Your network connection');
      console.log('   - Crayon service status');
    } else if (error.message.includes('permission') || error.message.includes('scope')) {
      console.log('\n💡 Permission error. Please check:');
      console.log('   - Your API key has the required permissions');
      console.log('   - Required scopes: read:competitive-intelligence, read:win-loss, read:analytics');
    } else {
      console.log('\n💡 Please check the error details and refer to CRAYON_CONFIG.md for troubleshooting.');
    }
  }
}

// Run the test
testCrayonIntegration();
