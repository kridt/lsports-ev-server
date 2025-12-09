// Debug why Unibet specifically has no +EV bets
import 'dotenv/config';

const LSPORTS_CREDS = {
  PackageId: parseInt(process.env.LSPORTS_PACKAGE_ID) || 3454,
  UserName: process.env.LSPORTS_USERNAME,
  Password: process.env.LSPORTS_PASSWORD
};

const LSPORTS_API_BASE = 'https://stm-snapshot.lsports.eu';

function calculateMedian(numbers) {
  if (!numbers || numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function debugUnibetEV() {
  console.log('🔍 Analyzing Unibet odds vs median...\n');

  try {
    // Get Premier League markets
    const marketsRes = await fetch(`${LSPORTS_API_BASE}/PreMatch/GetFixtureMarkets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...LSPORTS_CREDS,
        Leagues: [67], // Premier League
        Markets: [1]   // 1X2
      })
    });
    const data = await marketsRes.json();
    const events = data?.Body || [];

    console.log(`Events: ${events.length}\n`);

    let unibetTotal = 0;
    let unibetBelowMedian = 0;
    let unibetAtMedian = 0;
    let unibetAboveMedian = 0;
    const samples = [];

    for (const event of events) {
      const home = event.Fixture?.Participants?.find(p => p.Position === '1')?.Name || 'Home';
      const away = event.Fixture?.Participants?.find(p => p.Position === '2')?.Name || 'Away';

      for (const market of (event.Markets || [])) {
        // Group by selection
        const selections = {};

        for (const pm of (market.ProviderMarkets || [])) {
          for (const bet of (pm.Bets || [])) {
            if (!bet.Price || parseFloat(bet.Price) <= 1) continue;
            const key = `${bet.Name}`;
            if (!selections[key]) {
              selections[key] = { name: bet.Name, odds: [] };
            }
            selections[key].odds.push({
              bookmaker: pm.Name,
              price: parseFloat(bet.Price)
            });
          }
        }

        // Analyze each selection
        for (const [selName, sel] of Object.entries(selections)) {
          if (sel.odds.length < 4) continue;

          const unibetOdd = sel.odds.find(o => o.bookmaker.toLowerCase().includes('unibet'));
          if (!unibetOdd) continue;

          unibetTotal++;

          const allPrices = sel.odds.map(o => o.price);
          const median = calculateMedian(allPrices);
          const maxOdds = Math.max(...allPrices);
          const diff = unibetOdd.price - median;
          const ev = ((1 / median) * unibetOdd.price - 1) * 100;

          if (unibetOdd.price < median) {
            unibetBelowMedian++;
          } else if (unibetOdd.price === median) {
            unibetAtMedian++;
          } else {
            unibetAboveMedian++;
          }

          // Store samples
          if (samples.length < 10) {
            samples.push({
              match: `${home} vs ${away}`,
              selection: selName,
              unibetOdds: unibetOdd.price,
              median: median.toFixed(2),
              max: maxOdds.toFixed(2),
              diff: diff.toFixed(2),
              ev: ev.toFixed(2),
              allOdds: sel.odds.map(o => `${o.bookmaker}: ${o.price}`).join(', '),
              rank: sel.odds.sort((a, b) => b.price - a.price)
                        .findIndex(o => o.bookmaker.toLowerCase().includes('unibet')) + 1
            });
          }
        }
      }
    }

    // Summary
    console.log('📊 UNIBET ODDS VS MEDIAN');
    console.log('=' .repeat(60));
    console.log(`Total Unibet bets analyzed: ${unibetTotal}`);
    console.log(`Below median (negative EV): ${unibetBelowMedian} (${((unibetBelowMedian/unibetTotal)*100).toFixed(1)}%)`);
    console.log(`At median (0 EV):           ${unibetAtMedian} (${((unibetAtMedian/unibetTotal)*100).toFixed(1)}%)`);
    console.log(`Above median (+EV):         ${unibetAboveMedian} (${((unibetAboveMedian/unibetTotal)*100).toFixed(1)}%)`);

    console.log('\n📋 SAMPLE BETS (showing odds comparison):');
    console.log('-'.repeat(80));

    samples.forEach((s, i) => {
      console.log(`\n${i + 1}. ${s.match} - ${s.selection}`);
      console.log(`   Unibet: ${s.unibetOdds} | Median: ${s.median} | Max: ${s.max}`);
      console.log(`   Diff from median: ${s.diff} | EV: ${s.ev}%`);
      console.log(`   Rank: #${s.rank} out of ${s.allOdds.split(',').length} bookmakers`);
      console.log(`   All odds: ${s.allOdds}`);
    });

    // Conclusion
    console.log('\n\n🎯 CONCLUSION:');
    console.log('=' .repeat(60));
    if (unibetAboveMedian === 0) {
      console.log('❌ Unibet NEVER beats the median odds!');
      console.log('   This is why there are no +EV bets for Unibet.');
      console.log('\n   Possible reasons:');
      console.log('   1. Unibet has conservative pricing (lower margins for bettors)');
      console.log('   2. Unibet odds are always market-lagging');
      console.log('   3. This is expected behavior - not all bookmakers offer +EV');
    } else {
      console.log(`✅ Unibet has ${unibetAboveMedian} bets above median`);
      console.log('   There should be some +EV opportunities.');
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

debugUnibetEV();
