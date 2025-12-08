// Test the OddService API endpoint from the guide
// Compare with current STM Snapshot API
import 'dotenv/config';

const STM_CREDS = {
  PackageId: parseInt(process.env.LSPORTS_PACKAGE_ID) || 3454,
  UserName: process.env.LSPORTS_USERNAME,
  Password: process.env.LSPORTS_PASSWORD
};

// For OddService, we need Guid instead of PackageId
// The Guid might be different - let's try with PackageId as Guid
const ODDSERVICE_BASE = 'https://prematch.lsports.eu/OddService';
const STM_BASE = 'https://stm-snapshot.lsports.eu/PreMatch';

async function testOddServiceAPI() {
  console.log('🧪 Testing OddService API (from guide)...\n');

  // Try GetFixtures from OddService
  const params = new URLSearchParams({
    Username: STM_CREDS.UserName,
    Password: STM_CREDS.Password,
    Guid: String(STM_CREDS.PackageId), // Try PackageId as Guid
    Sports: '6046', // Football
    FromDate: String(Math.floor(Date.now() / 1000)),
    ToDate: String(Math.floor(Date.now() / 1000) + 86400 * 3) // Next 3 days
  });

  const url = `${ODDSERVICE_BASE}/GetFixtures?${params}`;
  console.log('📡 URL:', url.replace(STM_CREDS.Password, '***'));

  try {
    const response = await fetch(url);
    const text = await response.text();

    console.log('\n📦 Status:', response.status);
    console.log('📦 Length:', text.length, 'chars');

    if (response.status === 200 && text.length > 100) {
      console.log('\n✅ OddService API WORKS!');
      console.log('First 2000 chars:\n', text.substring(0, 2000));

      // Count fixtures
      const fixtureMatches = text.match(/FixtureId/g) || [];
      console.log(`\n📊 Found ${fixtureMatches.length} fixtures`);

      // Now test GetFixtureMarkets
      await testOddServiceMarkets();
    } else {
      console.log('\n❌ OddService API failed or returned empty');
      console.log('Response:', text.substring(0, 500));
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function testOddServiceMarkets() {
  console.log('\n\n🎰 Testing OddService GetFixtureMarkets...\n');

  const params = new URLSearchParams({
    Username: STM_CREDS.UserName,
    Password: STM_CREDS.Password,
    Guid: String(STM_CREDS.PackageId),
    Sports: '6046',
    Leagues: '67', // Premier League
    Markets: '1,2,3', // 1X2, O/U, etc
    FromDate: String(Math.floor(Date.now() / 1000)),
    ToDate: String(Math.floor(Date.now() / 1000) + 86400 * 7)
  });

  const url = `${ODDSERVICE_BASE}/GetFixtureMarkets?${params}`;
  console.log('📡 URL:', url.replace(STM_CREDS.Password, '***'));

  try {
    const response = await fetch(url);
    const text = await response.text();

    console.log('\n📦 Status:', response.status);
    console.log('📦 Length:', text.length, 'chars');

    if (response.status === 200 && text.length > 100) {
      console.log('\n✅ GetFixtureMarkets WORKS!');

      // Extract provider/bookmaker names
      const providerNames = new Set();

      // Look for Provider elements with Name
      const providerMatches = [...text.matchAll(/<Provider[^>]*>[\s\S]*?<Name>([^<]+)<\/Name>/g)];
      providerMatches.forEach(m => providerNames.add(m[1]));

      // Also try JSON format
      const jsonMatches = [...text.matchAll(/"Name"\s*:\s*"([^"]+)"/g)];
      jsonMatches.forEach(m => {
        // Filter to likely bookmaker names
        if (!/over|under|home|away|draw|goal|corner|1x2|handicap/i.test(m[1])) {
          if (/bet|book|sport|win|odds|pinnacle|unibet|betsson|888|william|paddy|bwin|draft|fanduel|marathon/i.test(m[1])) {
            providerNames.add(m[1]);
          }
        }
      });

      console.log('\n📋 BOOKMAKERS in OddService API:');
      console.log('================================');
      [...providerNames].sort().forEach((name, i) => {
        console.log(`  ${String(i + 1).padStart(2)}. ${name}`);
      });
      console.log('================================');
      console.log(`Total: ${providerNames.size} bookmakers\n`);

      // Show sample structure
      const pmIndex = text.indexOf('Provider');
      if (pmIndex > -1) {
        console.log('\n📦 Sample Provider structure:');
        console.log(text.substring(pmIndex, pmIndex + 1000));
      }
    } else {
      console.log('\n❌ GetFixtureMarkets failed');
      console.log('Response:', text.substring(0, 500));
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function compareWithSTMAPI() {
  console.log('\n\n📊 Comparing with current STM Snapshot API...\n');

  try {
    const response = await fetch(`${STM_BASE}/GetFixtureMarkets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...STM_CREDS,
        Sports: [6046],
        Leagues: [67],
        Markets: [1, 2, 3]
      })
    });

    const text = await response.text();
    console.log('📦 STM Status:', response.status);
    console.log('📦 STM Length:', text.length, 'chars');

    // Extract bookmakers
    const providerNames = new Set();
    const matches = [...text.matchAll(/"Name"\s*:\s*"([^"]+)"/g)];
    matches.forEach(m => {
      if (/bet|sport|win|pinnacle|unibet|betsson|888|william|paddy|bwin|draft|fanduel|marathon|1xbet|fonbet/i.test(m[1])) {
        providerNames.add(m[1]);
      }
    });

    console.log('\n📋 BOOKMAKERS in STM API:');
    console.log('================================');
    [...providerNames].sort().forEach((name, i) => {
      console.log(`  ${String(i + 1).padStart(2)}. ${name}`);
    });
    console.log('================================');
    console.log(`Total: ${providerNames.size} bookmakers\n`);

  } catch (error) {
    console.error('❌ STM API Error:', error.message);
  }
}

// Run all tests
testOddServiceAPI()
  .then(() => compareWithSTMAPI())
  .then(() => console.log('\n✅ Tests complete!'));
