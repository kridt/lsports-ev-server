// Quick NBA markets test
const CREDS = {
  PackageId: 3454,
  UserName: 'chrnielsen2003@gmail.com',
  Password: 'Christian2025!'
};

async function testNBA() {
  console.log('=== Quick NBA Test ===\n');

  // Step 1: Get NBA fixtures
  console.log('1. Getting NBA fixtures (League 64)...');
  const fixturesRes = await fetch('https://stm-snapshot.lsports.eu/PreMatch/GetFixtures', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...CREDS, Leagues: [64] })
  });
  const fixturesData = await fixturesRes.json();
  console.log('NBA fixtures:', fixturesData.Body?.length || 0);

  if (!fixturesData.Body?.length) {
    console.log('No NBA fixtures found!');
    return;
  }

  const sample = fixturesData.Body[0];
  console.log('Sample:', sample.FixtureId, sample.Fixture?.Participants?.map(p => p.Name).join(' vs '));

  // Step 2: Get markets for NBA fixtures
  console.log('\n2. Getting markets for NBA fixtures...');
  const fixtureIds = fixturesData.Body.slice(0, 3).map(f => f.FixtureId);
  console.log('Fixture IDs:', fixtureIds);

  const marketsRes = await fetch('https://stm-snapshot.lsports.eu/PreMatch/GetFixtureMarkets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...CREDS, FixtureIds: fixtureIds })
  });
  const marketsData = await marketsRes.json();

  console.log('Markets response body length:', marketsData.Body?.length || 0);

  if (marketsData.Body?.length > 0) {
    const first = marketsData.Body[0];
    console.log('First event markets:', first.Markets?.length || 0);

    if (first.Markets?.length > 0) {
      console.log('\n=== NBA MARKETS FOUND! ===');
      first.Markets.slice(0, 10).forEach(m => {
        const bets = m.Bets || [];
        const providers = bets[0]?.Providers || [];
        console.log(`Market ${m.Id}: ${m.Name} - ${bets.length} selections, ${providers.length} bookmakers`);
      });
    } else {
      console.log('\nNo markets in response');
    }
  } else {
    console.log('\nEmpty body - NO MARKETS AVAILABLE FOR NBA');
  }
}

testNBA().catch(console.error);
