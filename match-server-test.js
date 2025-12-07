// Match exactly what the server does
const CREDS = {
  PackageId: 3454,
  UserName: 'chrnielsen2003@gmail.com',
  Password: 'Christian2025!'
};

// Same markets as server
const TARGET_MARKETS = [1, 2, 3, 5, 11, 30, 31, 64, 65, 77, 95, 129, 132, 158, 180, 181, 184, 214, 407, 409, 711, 712, 713, 714, 715, 824, 825, 835, 836, 1065, 1066, 1067, 1068, 1222, 1223, 1224, 1229, 1230, 1234, 1552, 1904, 1905, 1927, 1928, 1929, 2351];

// Football leagues
const FOOTBALL_LEAGUES = [67, 8363, 65, 4, 61, 58, 22263, 66, 8, 60, 2944, 6603, 63, 30058, 59, 32521, 68, 70, 32644, 30444, 45863];

async function test() {
  console.log('=== Match Server Approach ===\n');

  // Step 1: Get ALL fixtures (just like server)
  console.log('1. Getting ALL fixtures (no filter)...');
  const allRes = await fetch('https://stm-snapshot.lsports.eu/PreMatch/GetFixtures', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(CREDS)
  });
  const allData = await allRes.json();
  console.log('Total fixtures:', allData.Body?.length || 0);

  if (!allData.Body?.length) {
    console.log('No fixtures returned!');
    return;
  }

  // Step 2: Filter to football leagues locally
  const now = new Date();
  const footballFixtures = allData.Body
    .filter(f => {
      const leagueId = f.Fixture?.League?.Id;
      const startDate = new Date(f.Fixture?.StartDate);
      return FOOTBALL_LEAGUES.includes(leagueId) && startDate > now;
    })
    .slice(0, 5);

  console.log('Football fixtures after filter:', footballFixtures.length);

  if (footballFixtures.length > 0) {
    console.log('Sample:', footballFixtures[0].FixtureId, footballFixtures[0].Fixture?.Participants?.map(p => p.Name).join(' vs '));

    const footballIds = footballFixtures.map(f => f.FixtureId);
    console.log('IDs:', footballIds);

    // Step 3: Get markets exactly like server
    console.log('\n2. Getting markets (same as server)...');
    const marketsRes = await fetch('https://stm-snapshot.lsports.eu/PreMatch/GetFixtureMarkets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...CREDS,
        Fixtures: footballIds,
        Markets: TARGET_MARKETS
      })
    });
    const marketsData = await marketsRes.json();
    console.log('Body length:', marketsData.Body?.length || 0);

    if (marketsData.Body?.length > 0) {
      console.log('Markets per event:', marketsData.Body[0].Markets?.length || 0);
      console.log('FOOTBALL WORKS!');
    } else {
      console.log('No markets returned for football!');
    }
  }

  // Step 4: Now try NBA the same way
  console.log('\n3. Now trying NBA...');
  const nbaFixtures = allData.Body
    .filter(f => {
      const leagueId = f.Fixture?.League?.Id;
      return leagueId === 64; // NBA
    })
    .slice(0, 5);

  console.log('NBA fixtures found:', nbaFixtures.length);

  if (nbaFixtures.length > 0) {
    console.log('Sample:', nbaFixtures[0].FixtureId, nbaFixtures[0].Fixture?.Participants?.map(p => p.Name).join(' vs '));

    const nbaIds = nbaFixtures.map(f => f.FixtureId);
    console.log('IDs:', nbaIds);

    console.log('Getting NBA markets...');
    const nbaMarketsRes = await fetch('https://stm-snapshot.lsports.eu/PreMatch/GetFixtureMarkets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...CREDS,
        Fixtures: nbaIds,
        Markets: [1, 2, 3, 64, 65, 77, 835, 836] // Common basketball markets
      })
    });
    const nbaMarketsData = await nbaMarketsRes.json();
    console.log('NBA Body length:', nbaMarketsData.Body?.length || 0);

    if (nbaMarketsData.Body?.length > 0) {
      console.log('NBA Markets per event:', nbaMarketsData.Body[0].Markets?.length || 0);
      if (nbaMarketsData.Body[0].Markets?.length > 0) {
        console.log('=== NBA HAS MARKETS! ===');
        nbaMarketsData.Body[0].Markets.forEach(m => {
          console.log(`- ${m.Id}: ${m.Name} (${m.Bets?.length || 0} selections)`);
        });
      }
    } else {
      console.log('=== NO NBA MARKETS ===');
      console.log('Package 3454 does NOT include NBA odds.');
    }
  }
}

test().catch(console.error);
