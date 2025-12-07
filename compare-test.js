// Compare Football vs NBA markets
const CREDS = {
  PackageId: 3454,
  UserName: 'chrnielsen2003@gmail.com',
  Password: 'Christian2025!'
};

async function test() {
  console.log('=== Football vs NBA Comparison ===\n');

  // Football (Premier League = 67)
  console.log('1. Getting Football fixtures (League 67 - PL)...');
  const footballRes = await fetch('https://stm-snapshot.lsports.eu/PreMatch/GetFixtures', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...CREDS, Leagues: [67] })
  });
  const footballData = await footballRes.json();
  console.log('Football fixtures:', footballData.Body?.length || 0);

  if (footballData.Body?.length > 0) {
    const footballIds = footballData.Body.slice(0, 2).map(f => f.FixtureId);
    console.log('Football IDs:', footballIds);

    console.log('Getting football markets...');
    const start = Date.now();
    const footballMarkets = await fetch('https://stm-snapshot.lsports.eu/PreMatch/GetFixtureMarkets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...CREDS, FixtureIds: footballIds })
    });
    const footballMarketsData = await footballMarkets.json();
    console.log(`Football markets took ${Date.now() - start}ms`);
    console.log('Football markets per event:', footballMarketsData.Body?.[0]?.Markets?.length || 0);
  }

  // NBA (League 64)
  console.log('\n2. Getting NBA fixtures (League 64)...');
  const nbaRes = await fetch('https://stm-snapshot.lsports.eu/PreMatch/GetFixtures', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...CREDS, Leagues: [64] })
  });
  const nbaData = await nbaRes.json();
  console.log('NBA fixtures:', nbaData.Body?.length || 0);

  if (nbaData.Body?.length > 0) {
    const nbaIds = nbaData.Body.slice(0, 2).map(f => f.FixtureId);
    console.log('NBA IDs:', nbaIds);

    console.log('Getting NBA markets (with 10s timeout)...');
    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const nbaMarkets = await fetch('https://stm-snapshot.lsports.eu/PreMatch/GetFixtureMarkets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...CREDS, FixtureIds: nbaIds }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      const nbaMarketsData = await nbaMarkets.json();
      console.log(`NBA markets took ${Date.now() - start}ms`);
      console.log('NBA Body length:', nbaMarketsData.Body?.length || 0);
      console.log('NBA markets per event:', nbaMarketsData.Body?.[0]?.Markets?.length || 0);
    } catch (e) {
      console.log(`NBA markets TIMED OUT after ${Date.now() - start}ms`);
      console.log('Error:', e.name);
    }
  }

  console.log('\n=== Conclusion ===');
  console.log('If football works and NBA times out, the API doesnt support NBA markets in this package.');
}

test().catch(console.error);
