// Debug script to investigate Unibet odds
import 'dotenv/config';

const LSPORTS_CREDS = {
  PackageId: parseInt(process.env.LSPORTS_PACKAGE_ID) || 3454,
  UserName: process.env.LSPORTS_USERNAME,
  Password: process.env.LSPORTS_PASSWORD
};

const LSPORTS_API_BASE = 'https://stm-snapshot.lsports.eu';

// Target leagues
const TARGET_LEAGUES = [67, 65, 8363, 4, 61]; // PL, Bundesliga, La Liga, Serie A, Ligue 1

async function debugUnibet() {
  console.log('🔍 Debugging Unibet odds...\n');

  try {
    // Get all markets directly with league filter
    console.log('Fetching markets with Leagues filter...');
    const marketsRes = await fetch(`${LSPORTS_API_BASE}/PreMatch/GetFixtureMarkets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...LSPORTS_CREDS,
        Leagues: TARGET_LEAGUES,
        Markets: [1, 2, 3] // 1X2, O/U, BTTS
      })
    });
    const marketsData = await marketsRes.json();
    const events = marketsData?.Body || [];

    console.log(`Received ${events.length} events\n`);

    if (events.length === 0) {
      console.log('No events returned. Trying without league filter...');

      // Try without league filter
      const allMarketsRes = await fetch(`${LSPORTS_API_BASE}/PreMatch/GetFixtureMarkets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...LSPORTS_CREDS,
          Markets: [1]
        })
      });
      const allMarketsData = await allMarketsRes.json();
      const allEvents = allMarketsData?.Body || [];
      console.log(`Without filter: ${allEvents.length} events`);

      if (allEvents.length > 0) {
        analyzeEvents(allEvents.slice(0, 10));
      }
      return;
    }

    analyzeEvents(events.slice(0, 10));

  } catch (error) {
    console.error('Error:', error.message);
  }
}

function analyzeEvents(events) {
  // Analyze bookmaker coverage
  const bookmakerStats = {};
  const bookmakerBets = {}; // Track actual bet details

  for (const event of events) {
    for (const market of (event.Markets || [])) {
      for (const pm of (market.ProviderMarkets || [])) {
        const bookmaker = pm.Name;
        if (!bookmakerStats[bookmaker]) {
          bookmakerStats[bookmaker] = { total: 0, markets: 0, fixtures: new Set() };
          bookmakerBets[bookmaker] = [];
        }
        bookmakerStats[bookmaker].markets++;
        bookmakerStats[bookmaker].fixtures.add(event.FixtureId);

        const bets = pm.Bets || [];
        for (const bet of bets) {
          if (bet.Price && parseFloat(bet.Price) > 1) {
            bookmakerStats[bookmaker].total++;

            // Store sample bets for Unibet
            if (bookmaker.toLowerCase().includes('unibet') && bookmakerBets[bookmaker].length < 5) {
              bookmakerBets[bookmaker].push({
                fixture: event.FixtureId,
                market: market.Name,
                bet: bet.Name,
                price: bet.Price,
                status: bet.Status
              });
            }
          }
        }
      }
    }
  }

  // Summary
  console.log('\n📋 BOOKMAKER SUMMARY (from sample)');
  console.log('=' .repeat(60));

  const sortedBookmakers = Object.entries(bookmakerStats)
    .sort((a, b) => b[1].total - a[1].total);

  for (const [name, stats] of sortedBookmakers) {
    const isUnibet = name.toLowerCase().includes('unibet');
    const marker = isUnibet ? '🎯 ' : '   ';
    console.log(`${marker}${name.padEnd(20)}: ${String(stats.total).padStart(4)} bets, ${String(stats.markets).padStart(3)} markets, ${stats.fixtures.size} fixtures`);
  }

  // Check Unibet specifically
  const unibetEntry = sortedBookmakers.find(([name]) => name.toLowerCase().includes('unibet'));

  console.log('\n');
  if (unibetEntry) {
    console.log('✅ UNIBET FOUND!');
    console.log(`   Name: ${unibetEntry[0]}`);
    console.log(`   Total bets: ${unibetEntry[1].total}`);
    console.log(`   Markets: ${unibetEntry[1].markets}`);
    console.log(`   Fixtures: ${unibetEntry[1].fixtures.size}`);

    if (bookmakerBets[unibetEntry[0]]?.length > 0) {
      console.log('\n   Sample bets:');
      bookmakerBets[unibetEntry[0]].forEach(b => {
        console.log(`     - Fixture ${b.fixture}: ${b.market} - ${b.bet} @ ${b.price} (status: ${b.status})`);
      });
    }
  } else {
    console.log('❌ UNIBET NOT FOUND!');
    console.log('\n   All bookmaker names in data:');
    sortedBookmakers.forEach(([name]) => {
      console.log(`     - ${name}`);
    });
  }

  // Calculate EV for Unibet vs median
  console.log('\n\n📊 EV ANALYSIS FOR UNIBET');
  console.log('=' .repeat(60));

  let unibetPositiveEV = 0;
  let unibetTotalBets = 0;

  for (const event of events) {
    for (const market of (event.Markets || [])) {
      // Group by selection
      const selections = {};

      for (const pm of (market.ProviderMarkets || [])) {
        for (const bet of (pm.Bets || [])) {
          if (!bet.Price || parseFloat(bet.Price) <= 1) continue;

          const key = `${bet.Name}_${bet.Line || ''}`;
          if (!selections[key]) {
            selections[key] = { odds: [], unibetOdds: null };
          }

          const price = parseFloat(bet.Price);
          selections[key].odds.push({ bookmaker: pm.Name, price });

          if (pm.Name.toLowerCase().includes('unibet')) {
            selections[key].unibetOdds = price;
          }
        }
      }

      // Calculate EV for Unibet
      for (const [selName, sel] of Object.entries(selections)) {
        if (!sel.unibetOdds || sel.odds.length < 4) continue;

        // Calculate median
        const prices = sel.odds.map(o => o.price).sort((a, b) => a - b);
        const mid = Math.floor(prices.length / 2);
        const median = prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;

        const fairProb = 1 / median;
        const ev = (fairProb * sel.unibetOdds - 1) * 100;

        unibetTotalBets++;
        if (ev > 0) {
          unibetPositiveEV++;
        }
      }
    }
  }

  console.log(`Unibet bets analyzed: ${unibetTotalBets}`);
  console.log(`Unibet +EV bets: ${unibetPositiveEV}`);
  console.log(`Percentage: ${unibetTotalBets > 0 ? ((unibetPositiveEV / unibetTotalBets) * 100).toFixed(1) : 0}%`);

  if (unibetPositiveEV === 0 && unibetTotalBets > 0) {
    console.log('\n⚠️  Unibet has odds but NONE are +EV vs median!');
    console.log('   This means Unibet odds are always at or below market median.');
  }
}

debugUnibet();
