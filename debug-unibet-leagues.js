// Debug which leagues/events Unibet has odds for
import 'dotenv/config';

const LSPORTS_CREDS = {
  PackageId: parseInt(process.env.LSPORTS_PACKAGE_ID) || 3454,
  UserName: process.env.LSPORTS_USERNAME,
  Password: process.env.LSPORTS_PASSWORD
};

const LSPORTS_API_BASE = 'https://stm-snapshot.lsports.eu';

// Top 5 leagues IDs
const TOP_LEAGUES = {
  67: 'Premier League',
  65: 'Bundesliga',
  8363: 'La Liga',
  4: 'Serie A',
  61: 'Ligue 1'
};

async function debugUnibetLeagues() {
  console.log('🔍 Investigating Unibet odds coverage...\n');

  try {
    // 1. First get ALL events with odds (no league filter)
    console.log('1️⃣ Fetching ALL fixtures with markets (no league filter)...\n');
    const allMarketsRes = await fetch(`${LSPORTS_API_BASE}/PreMatch/GetFixtureMarkets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...LSPORTS_CREDS,
        Sports: [6046], // Football only
        Markets: [1] // 1X2 only for simplicity
      })
    });
    const allData = await allMarketsRes.json();
    const allEvents = allData?.Body || [];

    console.log(`Total events received: ${allEvents.length}\n`);

    // Track Unibet presence
    const unibetStats = {
      totalEventsWithUnibet: 0,
      leagueBreakdown: {},
      sampleEvents: []
    };

    const allLeagues = {};

    for (const event of allEvents) {
      const leagueId = event.Fixture?.League?.Id;
      const leagueName = event.Fixture?.League?.Name || 'Unknown';

      if (!allLeagues[leagueId]) {
        allLeagues[leagueId] = { name: leagueName, total: 0, withUnibet: 0 };
      }
      allLeagues[leagueId].total++;

      // Check if Unibet has odds for this event
      let hasUnibet = false;
      for (const market of (event.Markets || [])) {
        for (const pm of (market.ProviderMarkets || [])) {
          if (pm.Name?.toLowerCase().includes('unibet')) {
            hasUnibet = true;
            break;
          }
        }
        if (hasUnibet) break;
      }

      if (hasUnibet) {
        unibetStats.totalEventsWithUnibet++;
        allLeagues[leagueId].withUnibet++;

        if (unibetStats.sampleEvents.length < 5) {
          unibetStats.sampleEvents.push({
            fixtureId: event.FixtureId,
            league: leagueName,
            leagueId: leagueId,
            home: event.Fixture?.Participants?.find(p => p.Position === '1')?.Name,
            away: event.Fixture?.Participants?.find(p => p.Position === '2')?.Name
          });
        }
      }
    }

    // Summary
    console.log('📊 UNIBET COVERAGE SUMMARY');
    console.log('=' .repeat(60));
    console.log(`Events with Unibet odds: ${unibetStats.totalEventsWithUnibet} / ${allEvents.length}`);
    console.log(`Percentage: ${((unibetStats.totalEventsWithUnibet / allEvents.length) * 100).toFixed(1)}%\n`);

    // Check top 5 leagues specifically
    console.log('🏆 TOP 5 LEAGUES BREAKDOWN:');
    console.log('-'.repeat(50));
    for (const [leagueId, leagueName] of Object.entries(TOP_LEAGUES)) {
      const stats = allLeagues[leagueId] || { total: 0, withUnibet: 0 };
      const status = stats.withUnibet > 0 ? '✅' : '❌';
      console.log(`${status} ${leagueName.padEnd(20)}: ${stats.withUnibet}/${stats.total} events have Unibet`);
    }

    // All leagues with Unibet coverage
    console.log('\n📋 ALL LEAGUES WITH UNIBET ODDS:');
    console.log('-'.repeat(50));
    const leaguesWithUnibet = Object.entries(allLeagues)
      .filter(([_, stats]) => stats.withUnibet > 0)
      .sort((a, b) => b[1].withUnibet - a[1].withUnibet);

    leaguesWithUnibet.slice(0, 20).forEach(([id, stats]) => {
      const isTop5 = TOP_LEAGUES[id] ? '🌟' : '  ';
      console.log(`${isTop5} [${id}] ${stats.name.substring(0, 30).padEnd(30)}: ${stats.withUnibet}/${stats.total} events`);
    });

    if (leaguesWithUnibet.length > 20) {
      console.log(`   ... and ${leaguesWithUnibet.length - 20} more leagues`);
    }

    // Sample Unibet events
    if (unibetStats.sampleEvents.length > 0) {
      console.log('\n🎯 SAMPLE EVENTS WITH UNIBET ODDS:');
      console.log('-'.repeat(50));
      unibetStats.sampleEvents.forEach(e => {
        console.log(`  ${e.home} vs ${e.away}`);
        console.log(`    League: ${e.league} (ID: ${e.leagueId})`);
      });
    }

    // 2. Now specifically check Premier League
    console.log('\n\n2️⃣ Specifically checking Premier League fixtures...\n');

    const plRes = await fetch(`${LSPORTS_API_BASE}/PreMatch/GetFixtureMarkets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...LSPORTS_CREDS,
        Leagues: [67], // Premier League
        Markets: [1]
      })
    });
    const plData = await plRes.json();
    const plEvents = plData?.Body || [];

    console.log(`Premier League events: ${plEvents.length}`);

    // Check each PL event for Unibet
    const plBookmakers = {};
    for (const event of plEvents) {
      for (const market of (event.Markets || [])) {
        for (const pm of (market.ProviderMarkets || [])) {
          if (!plBookmakers[pm.Name]) {
            plBookmakers[pm.Name] = { events: new Set(), bets: 0 };
          }
          plBookmakers[pm.Name].events.add(event.FixtureId);
          plBookmakers[pm.Name].bets += (pm.Bets || []).filter(b => b.Price && parseFloat(b.Price) > 1).length;
        }
      }
    }

    console.log('\nBookmakers in Premier League:');
    Object.entries(plBookmakers)
      .sort((a, b) => b[1].bets - a[1].bets)
      .forEach(([name, stats]) => {
        const marker = name.toLowerCase().includes('unibet') ? '🎯 ' : '   ';
        console.log(`${marker}${name.padEnd(20)}: ${stats.events.size} events, ${stats.bets} bets`);
      });

  } catch (error) {
    console.error('Error:', error.message);
  }
}

debugUnibetLeagues();
