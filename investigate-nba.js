// Deep NBA Investigation Script
const CREDS = {
  PackageId: 3454,
  UserName: 'chrnielsen2003@gmail.com',
  Password: 'Christian2025!'
};

const API_BASE = 'https://stm-snapshot.lsports.eu';

async function makeRequest(endpoint, body) {
  try {
    const res = await fetch(API_BASE + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    if (!text) return { error: 'Empty response', status: res.status };
    return JSON.parse(text);
  } catch (e) {
    return { error: e.message };
  }
}

async function investigate() {
  console.log('=== DEEP NBA INVESTIGATION ===\n');

  // 1. First verify football works
  console.log('1. Verifying Football API works...');
  const footballFixtures = await makeRequest('/Snapshot/GetFixtures', {
    ...CREDS,
    Sports: [6046],
    Leagues: [67] // Premier League
  });

  if (footballFixtures.error) {
    console.log('ERROR:', footballFixtures.error);
    return;
  }
  console.log('Football fixtures found:', footballFixtures.Body?.length || 0);
  console.log('Header:', JSON.stringify(footballFixtures.Header));

  // 2. Now try basketball (sport ID 48242)
  console.log('\n2. Getting Basketball fixtures (Sport 48242)...');
  const basketballFixtures = await makeRequest('/Snapshot/GetFixtures', {
    ...CREDS,
    Sports: [48242]
  });

  console.log('Basketball fixtures found:', basketballFixtures.Body?.length || 0);
  console.log('Header:', JSON.stringify(basketballFixtures.Header));

  if (basketballFixtures.Body && basketballFixtures.Body.length > 0) {
    // Find unique leagues
    const leagues = {};
    basketballFixtures.Body.forEach(f => {
      if (f.League) {
        leagues[f.League.Id] = f.League.Name;
      }
    });
    console.log('\nBasketball leagues in fixtures:');
    Object.entries(leagues).forEach(([id, name]) => console.log(`  ${id}: ${name}`));

    // Show sample fixture
    const sample = basketballFixtures.Body[0];
    console.log('\nSample basketball fixture:');
    console.log(JSON.stringify(sample, null, 2));

    // 3. Try to get markets for basketball fixtures
    console.log('\n3. Getting markets for basketball fixtures...');
    const fixtureIds = basketballFixtures.Body.slice(0, 10).map(f => f.FixtureId);
    console.log('Fixture IDs:', fixtureIds);

    // Try WITHOUT market filter first
    const markets1 = await makeRequest('/Snapshot/GetFixtureMarkets', {
      ...CREDS,
      FixtureIds: fixtureIds
    });

    console.log('\nGetFixtureMarkets (no filter):');
    console.log('Header:', JSON.stringify(markets1.Header));
    console.log('Body length:', markets1.Body?.length || 0);

    if (markets1.Body && markets1.Body.length > 0) {
      const firstEvent = markets1.Body[0];
      console.log('First event FixtureId:', firstEvent.FixtureId);
      console.log('Markets count:', firstEvent.Markets?.length || 0);

      if (firstEvent.Markets && firstEvent.Markets.length > 0) {
        console.log('\nMarkets found:');
        firstEvent.Markets.slice(0, 10).forEach(m => {
          console.log(`  Market ${m.Id}: ${m.Name} - ${m.Bets?.length || 0} bets`);
          if (m.Bets && m.Bets.length > 0) {
            m.Bets.slice(0, 3).forEach(b => {
              console.log(`    Bet: ${b.Name} - ${b.Providers?.length || 0} providers`);
            });
          }
        });
      }
    } else {
      console.log('No markets returned for basketball!');

      // 4. Try with specific market IDs
      console.log('\n4. Trying with common market IDs (1,2,3,77,202,835)...');
      const markets2 = await makeRequest('/Snapshot/GetFixtureMarkets', {
        ...CREDS,
        FixtureIds: fixtureIds,
        Markets: [1, 2, 3, 77, 202, 835, 342, 64, 65]
      });

      console.log('Header:', JSON.stringify(markets2.Header));
      console.log('Body length:', markets2.Body?.length || 0);

      if (markets2.Body && markets2.Body.length > 0) {
        const firstEvent = markets2.Body[0];
        console.log('Markets count:', firstEvent.Markets?.length || 0);
        if (firstEvent.Markets) {
          firstEvent.Markets.forEach(m => {
            console.log(`  Market ${m.Id}: ${m.Name} - ${m.Bets?.length || 0} bets`);
          });
        }
      }
    }

    // 5. Check what happens with NBA specifically (League 64)
    console.log('\n5. Getting NBA-specific fixtures (League 64)...');
    const nbaFixtures = await makeRequest('/Snapshot/GetFixtures', {
      ...CREDS,
      Sports: [48242],
      Leagues: [64]
    });

    console.log('NBA fixtures found:', nbaFixtures.Body?.length || 0);

    if (nbaFixtures.Body && nbaFixtures.Body.length > 0) {
      const nbaIds = nbaFixtures.Body.slice(0, 5).map(f => f.FixtureId);
      console.log('NBA fixture IDs:', nbaIds);

      const nbaMarkets = await makeRequest('/Snapshot/GetFixtureMarkets', {
        ...CREDS,
        FixtureIds: nbaIds
      });

      console.log('NBA markets response:');
      console.log('Header:', JSON.stringify(nbaMarkets.Header));
      console.log('Body length:', nbaMarkets.Body?.length || 0);

      if (nbaMarkets.Body && nbaMarkets.Body.length > 0 && nbaMarkets.Body[0].Markets) {
        console.log('Markets per event:', nbaMarkets.Body[0].Markets.length);
      }
    }
  } else {
    console.log('No basketball fixtures found at all!');
  }

  console.log('\n=== INVESTIGATION COMPLETE ===');
}

investigate().catch(console.error);
