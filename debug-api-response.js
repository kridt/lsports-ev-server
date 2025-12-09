// Debug the actual API response to see what Unibet data looks like
import 'dotenv/config';

// Fetch from the local server
async function checkApiResponse() {
  console.log('🔍 Checking API response for Unibet data...\n');

  try {
    const response = await fetch('http://localhost:3000/api/ev');
    const data = await response.json();

    console.log('Available bookmakers:', data.bookmakers);
    console.log('Total matches:', data.matches?.length);

    // Check if Unibet is in bookmakers list
    const hasUnibet = data.bookmakers?.includes('Unibet');
    console.log(`\nUnibet in bookmakers: ${hasUnibet ? '✅ YES' : '❌ NO'}`);

    // Check Unibet in value bets
    let unibetTotal = 0;
    let unibetPositiveEV = 0;

    const samples = [];

    for (const match of (data.matches || [])) {
      for (const bet of (match.valueBets || [])) {
        const unibetBm = bet.allBookmakers?.find(bm => bm.bookmaker === 'Unibet');
        if (unibetBm) {
          unibetTotal++;
          if (unibetBm.ev > 0) {
            unibetPositiveEV++;
            if (samples.length < 5) {
              samples.push({
                match: `${match.homeTeam} vs ${match.awayTeam}`,
                market: bet.marketName,
                selection: bet.selection,
                unibetOdds: unibetBm.odds,
                unibetEV: unibetBm.ev,
                fairOdds: bet.fairOdds,
                bestBookmaker: bet.bestBookmaker,
                bestEV: bet.bestEV
              });
            }
          }
        }
      }
    }

    console.log(`\n📊 UNIBET IN API RESPONSE:`);
    console.log(`Total Unibet entries: ${unibetTotal}`);
    console.log(`Unibet +EV: ${unibetPositiveEV}`);

    if (samples.length > 0) {
      console.log('\nSample Unibet +EV bets:');
      samples.forEach((s, i) => {
        console.log(`\n${i + 1}. ${s.match} - ${s.market}`);
        console.log(`   Selection: ${s.selection}`);
        console.log(`   Unibet: ${s.unibetOdds} @ ${s.unibetEV}% EV`);
        console.log(`   Fair: ${s.fairOdds} | Best: ${s.bestBookmaker} ${s.bestEV}%`);
      });
    }

    // Also check raw structure of first match
    if (data.matches?.[0]?.valueBets?.[0]) {
      console.log('\n\n📦 Sample bet structure:');
      const bet = data.matches[0].valueBets[0];
      console.log('allBookmakers count:', bet.allBookmakers?.length);
      console.log('Sample allBookmakers:', JSON.stringify(bet.allBookmakers?.slice(0, 3), null, 2));
    }

  } catch (error) {
    console.error('Error:', error.message);
    console.log('\n⚠️ Make sure the server is running on localhost:3000');
  }
}

checkApiResponse();
