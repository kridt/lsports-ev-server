// Test script to see all available providers/bookmakers in your LSports package
import 'dotenv/config';

const LSPORTS_CREDS = {
  PackageId: parseInt(process.env.LSPORTS_PACKAGE_ID) || 3454,
  UserName: process.env.LSPORTS_USERNAME,
  Password: process.env.LSPORTS_PASSWORD
};

async function getAllProviders() {
  console.log('🔍 Fetching all providers from LSports...\n');
  console.log('Credentials:', {
    PackageId: LSPORTS_CREDS.PackageId,
    UserName: LSPORTS_CREDS.UserName,
    Password: '***hidden***'
  });

  try {
    // Metadata endpoint for providers
    console.log('\n📡 Calling: POST https://stm-api.lsports.eu/PreMatch/GetProviders');

    const response = await fetch('https://stm-api.lsports.eu/PreMatch/GetProviders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(LSPORTS_CREDS)
    });

    const text = await response.text();

    console.log('\n📦 Response Status:', response.status);
    console.log('📦 Response Length:', text.length, 'chars');

    if (text.length < 100) {
      console.log('📦 Full Response:', text);
    }

    // Check if XML or JSON
    if (text.trim().startsWith('<')) {
      console.log('\n📄 XML Response detected');
      console.log('First 3000 chars:\n', text.substring(0, 3000));

      // Extract provider info using regex
      const providerRegex = /<Provider[^>]*Id="(\d+)"[^>]*>[\s\S]*?<Name>([^<]+)<\/Name>/g;
      const providers = [];
      let match;
      while ((match = providerRegex.exec(text)) !== null) {
        providers.push({ id: match[1], name: match[2] });
      }

      // Also try simpler pattern
      if (providers.length === 0) {
        const nameMatches = [...text.matchAll(/<Name>([^<]+)<\/Name>/g)];
        const idMatches = [...text.matchAll(/Id="(\d+)"/g)];
        for (let i = 0; i < nameMatches.length; i++) {
          providers.push({
            id: idMatches[i] ? idMatches[i][1] : '?',
            name: nameMatches[i][1]
          });
        }
      }

      console.log(`\n✅ Found ${providers.length} providers`);
      console.log('\n📋 ALL PROVIDERS IN YOUR PACKAGE:');
      console.log('================================');
      providers.forEach((p, i) => {
        console.log(`  ${String(i + 1).padStart(2)}. [ID: ${p.id}] ${p.name}`);
      });
      console.log('================================');
      console.log(`Total: ${providers.length} providers\n`);
    } else if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
      // JSON response
      console.log('\n📄 JSON Response detected');
      const data = JSON.parse(text);
      console.log(JSON.stringify(data, null, 2).substring(0, 3000));

      // Try to extract providers from various structures
      const providers = data.Body?.Providers || data.Providers || data;
      if (Array.isArray(providers)) {
        console.log(`\n✅ Found ${providers.length} providers`);
        providers.forEach((p, i) => {
          console.log(`  ${i + 1}. [ID: ${p.Id}] ${p.Name}`);
        });
      }
    } else {
      console.log('Unknown response format:', text.substring(0, 500));
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Also check providers in actual odds data
async function getProvidersFromOdds() {
  console.log('\n\n🎰 Checking providers from actual odds data...\n');

  try {
    // Get a sample fixture with markets
    const marketsRes = await fetch('https://stm-snapshot.lsports.eu/PreMatch/GetFixtureMarkets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...LSPORTS_CREDS,
        Sports: [6046], // Football
        Leagues: [67],  // Premier League
        Markets: [1, 2, 3] // 1X2, Over/Under, Handicap
      })
    });

    const text = await marketsRes.text();
    console.log('Response length:', text.length, 'chars');

    // Extract all unique provider names from ProviderMarkets
    const providerNames = new Set();

    // Pattern 1: JSON format "Name": "BookmakerName"
    const jsonNameMatches = [...text.matchAll(/"Name"\s*:\s*"([^"]+)"/g)];

    // Pattern 2: XML format <Name>BookmakerName</Name>
    const xmlNameMatches = [...text.matchAll(/<Name>([^<]+)<\/Name>/g)];

    // Combine and filter for bookmaker-like names (exclude market names)
    const allNames = [...jsonNameMatches.map(m => m[1]), ...xmlNameMatches.map(m => m[1])];

    // Known bookmaker patterns to identify actual bookmakers
    const likelyBookmakers = allNames.filter(name => {
      // Exclude common non-bookmaker names
      const excludePatterns = /over|under|home|away|draw|yes|no|goal|corner|card|total|handicap|1x2|btts|both|teams|to score|winner|half|first|second|match|market|asian/i;
      if (excludePatterns.test(name)) return false;

      // Include known bookmaker patterns
      const bookmakerPatterns = /bet|book|sport|casino|gaming|wager|odds|play|win|vegas|poker/i;
      if (bookmakerPatterns.test(name)) return true;

      // Include names that look like company names (capitalized, short)
      if (name.length > 3 && name.length < 30 && /^[A-Z]/.test(name)) return true;

      return false;
    });

    likelyBookmakers.forEach(name => providerNames.add(name));

    console.log('\n📋 BOOKMAKERS FOUND IN ACTUAL ODDS:');
    console.log('================================');
    [...providerNames].sort().forEach((name, i) => {
      console.log(`  ${String(i + 1).padStart(2)}. ${name}`);
    });
    console.log('================================');
    console.log(`Total unique: ${providerNames.size} bookmakers\n`);

    // Show raw sample of ProviderMarkets structure
    const pmIndex = text.indexOf('ProviderMarkets');
    if (pmIndex > -1) {
      console.log('\n📦 Sample ProviderMarkets structure:');
      console.log(text.substring(pmIndex, pmIndex + 1500));
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Run
getAllProviders().then(() => getProvidersFromOdds());
