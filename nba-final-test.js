// Final NBA test - using correct parameter names
const CREDS = {
  PackageId: 3454,
  UserName: 'chrnielsen2003@gmail.com',
  Password: 'Christian2025!'
};

// Basketball market IDs (common ones)
const BASKETBALL_MARKETS = [1, 2, 3, 64, 65, 77, 202, 342, 835, 836];

async function test() {
  console.log('=== Final NBA Test (correct params) ===\n');

  // Step 1: Get NBA fixtures
  console.log('1. Getting NBA fixtures...');
  const nbaRes = await fetch('https://stm-snapshot.lsports.eu/PreMatch/GetFixtures', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...CREDS, Leagues: [64] })
  });
  const nbaData = await nbaRes.json();
  console.log('NBA fixtures:', nbaData.Body?.length || 0);

  if (!nbaData.Body?.length) {
    console.log('No NBA fixtures!');
    return;
  }

  const nbaIds = nbaData.Body.slice(0, 3).map(f => f.FixtureId);
  console.log('Fixture IDs:', nbaIds);
  console.log('Sample:', nbaData.Body[0].Fixture?.Participants?.map(p => p.Name).join(' vs '));

  // Step 2: Get markets using CORRECT parameter name: "Fixtures" not "FixtureIds"
  console.log('\n2. Getting NBA markets (using Fixtures param)...');
  const start = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const marketsRes = await fetch('https://stm-snapshot.lsports.eu/PreMatch/GetFixtureMarkets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...CREDS,
        Fixtures: nbaIds,  // CORRECT: "Fixtures" not "FixtureIds"
        Markets: BASKETBALL_MARKETS
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    const marketsData = await marketsRes.json();
    console.log(`Response took ${Date.now() - start}ms`);
    console.log('Body length:', marketsData.Body?.length || 0);

    if (marketsData.Body?.length > 0) {
      const first = marketsData.Body[0];
      console.log('Markets in first event:', first.Markets?.length || 0);

      if (first.Markets?.length > 0) {
        console.log('\n=== NBA MARKETS FOUND! ===');
        first.Markets.forEach(m => {
          const bets = m.Bets || [];
          const providers = bets[0]?.Providers || [];
          console.log(`Market ${m.Id}: ${m.Name}`);
          console.log(`  - ${bets.length} selections, ${providers.length} bookmakers`);
          if (providers.length > 0) {
            console.log(`  - Bookmakers: ${providers.slice(0, 5).map(p => p.Name).join(', ')}`);
          }
        });
      } else {
        console.log('\n=== NO MARKETS IN RESPONSE ===');
        console.log('The API returned events but no markets.');
        console.log('This confirms: Package 3454 does NOT include NBA odds.');
      }
    } else {
      console.log('\n=== EMPTY RESPONSE ===');
      console.log('No events returned for NBA fixtures.');
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      console.log(`Request TIMED OUT after ${Date.now() - start}ms`);
    } else {
      console.log('Error:', e.message);
    }
  }

  // Step 3: Compare with Football
  console.log('\n3. Comparing with Football...');
  const footballRes = await fetch('https://stm-snapshot.lsports.eu/PreMatch/GetFixtures', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...CREDS, Leagues: [67] })
  });
  const footballData = await footballRes.json();

  if (footballData.Body?.length > 0) {
    const footballIds = footballData.Body.slice(0, 2).map(f => f.FixtureId);

    const controller2 = new AbortController();
    const timeout2 = setTimeout(() => controller2.abort(), 15000);

    try {
      const start2 = Date.now();
      const footballMarkets = await fetch('https://stm-snapshot.lsports.eu/PreMatch/GetFixtureMarkets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...CREDS,
          Fixtures: footballIds,
          Markets: [1, 2, 3, 77]
        }),
        signal: controller2.signal
      });
      clearTimeout(timeout2);
      const footballMarketsData = await footballMarkets.json();
      console.log(`Football took ${Date.now() - start2}ms`);
      console.log('Football events:', footballMarketsData.Body?.length || 0);
      console.log('Football markets:', footballMarketsData.Body?.[0]?.Markets?.length || 0);
    } catch (e) {
      console.log('Football also timed out:', e.name);
    }
  }

  console.log('\n=== CONCLUSION ===');
}

test().catch(console.error);
