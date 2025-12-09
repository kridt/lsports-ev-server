// LSports EV Server - Real-time Football EV Calculation
// Refreshes every 1 minute and serves data to frontend
// Now with WebSocket support for real-time notifications!

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { createClient } from '@supabase/supabase-js';

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3001;

// Initialize Socket.IO with CORS
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// ============ WEBSOCKET CLIENT TRACKING ============

// Track connected clients and their preferences
const connectedClients = new Map();

io.on('connection', (socket) => {
  console.log(`[WebSocket] Client connected: ${socket.id}`);

  // Initialize client with default preferences
  connectedClients.set(socket.id, {
    selectedBookmakers: [],
    notifyNewEV: true,
    notifyEVIncrease: true,
    notifyEVDrop: true,
    minEVThreshold: 0,
    evChangeThreshold: 2 // Notify when EV changes by more than 2%
  });

  // Client sends their preferences (selected bookmakers, notification settings)
  socket.on('set-preferences', (prefs) => {
    const client = connectedClients.get(socket.id);
    if (client) {
      connectedClients.set(socket.id, { ...client, ...prefs });
      console.log(`[WebSocket] Client ${socket.id} updated preferences:`, prefs.selectedBookmakers?.length || 0, 'bookmakers');
    }
  });

  // Client requests current data
  socket.on('get-current-data', () => {
    socket.emit('full-update', {
      matches: cachedData.matches,
      bookmakers: [...(cachedData.bookmakers || [])],
      lastUpdated: cachedData.lastUpdated
    });
  });

  socket.on('disconnect', () => {
    connectedClients.delete(socket.id);
    console.log(`[WebSocket] Client disconnected: ${socket.id}`);
  });
});

// Store previous EV data for change detection
let previousEVData = new Map(); // key: fixtureId_selection_bookmaker, value: { ev, odds }

// ============ EV CHANGE DETECTION & NOTIFICATIONS ============

function detectEVChangesAndNotify(matches) {
  const currentEVData = new Map();
  const notifications = {
    newPositiveEV: [],    // New bets that just became +EV
    evIncreased: [],      // Existing bets where EV increased significantly
    evDropped: [],        // Existing bets where EV dropped significantly
    newBets: []           // Completely new bets we haven't seen before
  };

  // Build current EV data map and detect changes
  for (const match of matches) {
    for (const bet of (match.valueBets || [])) {
      for (const bm of (bet.allBookmakers || [])) {
        const key = `${match.fixtureId}_${bet.selection}_${bm.bookmaker}`;
        const currentData = {
          ev: bm.ev,
          odds: bm.odds,
          match: `${match.homeTeam} vs ${match.awayTeam}`,
          selection: bet.selection,
          bookmaker: bm.bookmaker,
          marketName: bet.marketName,
          kickoff: match.kickoff,
          fixtureId: match.fixtureId
        };

        currentEVData.set(key, currentData);

        const previousData = previousEVData.get(key);

        if (!previousData) {
          // New bet we haven't seen
          if (bm.ev > 0) {
            notifications.newPositiveEV.push(currentData);
          }
        } else {
          // Existing bet - check for changes
          const evChange = bm.ev - previousData.ev;

          if (evChange >= 2 && bm.ev > 0) {
            // EV increased significantly
            notifications.evIncreased.push({
              ...currentData,
              previousEV: previousData.ev,
              change: evChange
            });
          } else if (evChange <= -2 && previousData.ev > 0) {
            // EV dropped significantly
            notifications.evDropped.push({
              ...currentData,
              previousEV: previousData.ev,
              change: evChange
            });
          }
        }
      }
    }
  }

  // Update previous data for next comparison
  previousEVData = currentEVData;

  // Send notifications to connected clients
  sendNotificationsToClients(notifications);

  return notifications;
}

function sendNotificationsToClients(notifications) {
  const totalNotifications =
    notifications.newPositiveEV.length +
    notifications.evIncreased.length +
    notifications.evDropped.length;

  if (totalNotifications === 0) return;

  console.log(`[WebSocket] Sending notifications: ${notifications.newPositiveEV.length} new +EV, ${notifications.evIncreased.length} increased, ${notifications.evDropped.length} dropped`);

  // Send to each connected client based on their preferences
  for (const [socketId, prefs] of connectedClients) {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) continue;

    const clientNotifications = {
      newPositiveEV: [],
      evIncreased: [],
      evDropped: [],
      timestamp: new Date().toISOString()
    };

    // Filter by client's selected bookmakers
    const hasBookmakerFilter = prefs.selectedBookmakers && prefs.selectedBookmakers.length > 0;

    if (prefs.notifyNewEV) {
      clientNotifications.newPositiveEV = notifications.newPositiveEV.filter(n => {
        if (hasBookmakerFilter && !prefs.selectedBookmakers.includes(n.bookmaker)) return false;
        if (n.ev < prefs.minEVThreshold) return false;
        return true;
      });
    }

    if (prefs.notifyEVIncrease) {
      clientNotifications.evIncreased = notifications.evIncreased.filter(n => {
        if (hasBookmakerFilter && !prefs.selectedBookmakers.includes(n.bookmaker)) return false;
        if (Math.abs(n.change) < prefs.evChangeThreshold) return false;
        return true;
      });
    }

    if (prefs.notifyEVDrop) {
      clientNotifications.evDropped = notifications.evDropped.filter(n => {
        if (hasBookmakerFilter && !prefs.selectedBookmakers.includes(n.bookmaker)) return false;
        if (Math.abs(n.change) < prefs.evChangeThreshold) return false;
        return true;
      });
    }

    // Only send if there are relevant notifications for this client
    const clientTotal =
      clientNotifications.newPositiveEV.length +
      clientNotifications.evIncreased.length +
      clientNotifications.evDropped.length;

    if (clientTotal > 0) {
      socket.emit('ev-notifications', clientNotifications);
    }
  }

  // Also broadcast summary to all clients
  io.emit('ev-update-summary', {
    newPositiveEV: notifications.newPositiveEV.length,
    evIncreased: notifications.evIncreased.length,
    evDropped: notifications.evDropped.length,
    timestamp: new Date().toISOString()
  });
}

// ============ RATE LIMITING ============

// Simple in-memory rate limiter for LSports API
const rateLimiter = {
  requests: [],
  maxRequests: 10, // Max 10 requests per window
  windowMs: 60 * 1000, // 1 minute window

  canMakeRequest() {
    const now = Date.now();
    // Remove old requests outside the window
    this.requests = this.requests.filter(time => now - time < this.windowMs);
    return this.requests.length < this.maxRequests;
  },

  recordRequest() {
    this.requests.push(Date.now());
  },

  getWaitTime() {
    if (this.requests.length === 0) return 0;
    const oldest = Math.min(...this.requests);
    const waitTime = this.windowMs - (Date.now() - oldest);
    return Math.max(0, waitTime);
  }
};

// ============ HEALTH MONITORING ============

let healthStatus = {
  lsportsConnected: false,
  lastLsportsCheck: null,
  lastSuccessfulFetch: null,
  consecutiveFailures: 0,
  supabaseConnected: false,
  serverStartTime: new Date().toISOString()
};

// ============ SUPABASE ============

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Validate required environment variables
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing required environment variables: SUPABASE_URL or SUPABASE_KEY');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Snapshot settings
const SNAPSHOT_INTERVAL = 5 * 60 * 1000; // 5 minutes (for testing - change to 20 for production)
const MIN_EV_FOR_SNAPSHOT = 3; // Only snapshot bets with EV >= 3%
const HOURS_BEFORE_KICKOFF = 48; // Only track bets within 48h of kickoff

// ============ CONFIGURATION ============

// Validate LSports credentials
if (!process.env.LSPORTS_PACKAGE_ID || !process.env.LSPORTS_USERNAME || !process.env.LSPORTS_PASSWORD) {
  console.error('❌ Missing required LSports credentials in environment variables!');
  console.error('   Required: LSPORTS_PACKAGE_ID, LSPORTS_USERNAME, LSPORTS_PASSWORD');
}

const LSPORTS_CREDS = {
  PackageId: parseInt(process.env.LSPORTS_PACKAGE_ID),
  UserName: process.env.LSPORTS_USERNAME,
  Password: process.env.LSPORTS_PASSWORD
};

const LSPORTS_API_BASE = 'https://stm-snapshot.lsports.eu';

// Target markets for EV calculation
const LSPORTS_TARGET_MARKETS = {
  // Match Winner
  1: { name: "Match Winner", category: "Main" },

  // Goal Kicks
  1927: { name: "U/O Goal Kicks", category: "Goal Kicks" },
  1928: { name: "U/O Goal Kicks - Home", category: "Goal Kicks" },
  1929: { name: "U/O Goal Kicks - Away", category: "Goal Kicks" },

  // Throw-ins
  180: { name: "U/O Throw-Ins", category: "Throw-ins" },
  1222: { name: "U/O Throw-Ins - Home", category: "Throw-ins" },
  1223: { name: "U/O Throw-Ins - Away", category: "Throw-ins" },
  1224: { name: "1X2 Throw-Ins", category: "Throw-ins" },

  // Tackles
  1904: { name: "U/O Tackles - Home", category: "Tackles" },
  1905: { name: "U/O Tackles - Away", category: "Tackles" },

  // Shots (Team level)
  132: { name: "U/O Shots on Target", category: "Shots" },
  1229: { name: "U/O Shots on Target - Home", category: "Shots" },
  1230: { name: "U/O Shots on Target - Away", category: "Shots" },
  1234: { name: "1X2 Shots on Target", category: "Shots" },

  // Player Shots
  2351: { name: "Player Shots On Target", category: "Player Shots", isPlayerProp: true },

  // Cards (Team level)
  158: { name: "U/O Yellow Cards", category: "Cards" },
  214: { name: "U/O Cards", category: "Cards" },
  181: { name: "U/O Yellow Cards - Home", category: "Cards" },
  184: { name: "U/O Yellow Cards - Away", category: "Cards" },
  19: { name: "First Card", category: "Cards" },
  407: { name: "Asian Handicap Cards", category: "Cards" },

  // Player Cards
  824: { name: "Player To Be Booked", category: "Player Cards", isPlayerProp: true },
  825: { name: "Player To Be Sent Off", category: "Player Cards", isPlayerProp: true },

  // Player Goals
  711: { name: "Anytime Goalscorer", category: "Player Goals", isPlayerProp: true },
  712: { name: "First Goalscorer", category: "Player Goals", isPlayerProp: true },
  713: { name: "Last Goalscorer", category: "Player Goals", isPlayerProp: true },
  714: { name: "Player 2+ Goals", category: "Player Goals", isPlayerProp: true },
  715: { name: "Player 3+ Goals (Hat-trick)", category: "Player Goals", isPlayerProp: true },
  1065: { name: "Home First Goalscorer", category: "Player Goals", isPlayerProp: true },
  1066: { name: "Home Last Goalscorer", category: "Player Goals", isPlayerProp: true },
  1067: { name: "Away First Goalscorer", category: "Player Goals", isPlayerProp: true },
  1068: { name: "Away Last Goalscorer", category: "Player Goals", isPlayerProp: true },

  // Asian Markets
  3: { name: "Asian Handicap", category: "Asian" },
  64: { name: "Asian Handicap 1st Period", category: "Asian" },
  65: { name: "Asian Handicap 2nd Period", category: "Asian" },
  835: { name: "Asian U/O", category: "Asian" },
  836: { name: "Asian U/O 1st Period", category: "Asian" },

  // Corners
  11: { name: "Total Corners", category: "Corners" },
  30: { name: "U/O Corners - Home", category: "Corners" },
  31: { name: "U/O Corners - Away", category: "Corners" },
  95: { name: "Corners Handicap", category: "Corners" },
  409: { name: "1X2 Corners", category: "Corners" },
  129: { name: "U/O Corners 1st Half", category: "Corners" },
  1552: { name: "Asian U/O Corners", category: "Corners" },

  // Goals
  2: { name: "U/O Goals", category: "Goals" },
  5: { name: "U/O Goals 1st Half", category: "Goals" },
  77: { name: "BTTS", category: "Goals" },
};

// Available leagues
const LSPORTS_LEAGUES = {
  // England
  67: { name: 'Premier League', country: 'England', emoji: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', tier: 1 },
  58: { name: 'Championship', country: 'England', emoji: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', tier: 2 },
  68: { name: 'League One', country: 'England', emoji: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', tier: 3 },
  70: { name: 'League Two', country: 'England', emoji: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', tier: 4 },
  // Spain
  8363: { name: 'LaLiga', country: 'Spain', emoji: '🇪🇸', tier: 1 },
  22263: { name: 'LaLiga2', country: 'Spain', emoji: '🇪🇸', tier: 2 },
  // Germany
  65: { name: 'Bundesliga', country: 'Germany', emoji: '🇩🇪', tier: 1 },
  66: { name: '2.Bundesliga', country: 'Germany', emoji: '🇩🇪', tier: 2 },
  // Italy
  4: { name: 'Serie A', country: 'Italy', emoji: '🇮🇹', tier: 1 },
  8: { name: 'Serie B', country: 'Italy', emoji: '🇮🇹', tier: 2 },
  // France
  61: { name: 'Ligue 1', country: 'France', emoji: '🇫🇷', tier: 1 },
  60: { name: 'Ligue 2', country: 'France', emoji: '🇫🇷', tier: 2 },
  // Other top leagues
  2944: { name: 'Eredivisie', country: 'Netherlands', emoji: '🇳🇱', tier: 1 },
  6603: { name: 'Primeira Liga', country: 'Portugal', emoji: '🇵🇹', tier: 1 },
  63: { name: 'Super Lig', country: 'Turkey', emoji: '🇹🇷', tier: 1 },
  30058: { name: 'Premiership', country: 'Scotland', emoji: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', tier: 1 },
  59: { name: 'Jupiler League', country: 'Belgium', emoji: '🇧🇪', tier: 1 },
  32521: { name: 'Ekstraklasa', country: 'Poland', emoji: '🇵🇱', tier: 1 },
  // European competitions
  32644: { name: 'Champions League', country: 'Europe', emoji: '🏆', tier: 1 },
  30444: { name: 'Europa League', country: 'Europe', emoji: '🌟', tier: 2 },
  45863: { name: 'Conference League', country: 'Europe', emoji: '🏅', tier: 3 },
};

// ============ HELPER FUNCTIONS ============

function calculateEV(fairProb, odds) {
  if (!fairProb || !odds || odds <= 1) return null;
  return ((fairProb * odds) - 1) * 100;
}

function calculateMedian(numbers) {
  if (!numbers || numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Normalize bookmaker names to consolidate regional variants
function normalizeBookmaker(name) {
  if (!name) return name;
  // Consolidate Unibet regional variants (Unibet.fr, Unibet.de, etc.)
  if (name.toLowerCase().startsWith('unibet')) return 'Unibet';
  // Consolidate Bet365 variants
  if (name.toLowerCase().startsWith('bet365')) return 'Bet365';
  // Consolidate 1xBet variants
  if (name.toLowerCase().includes('1xbet')) return '1XBet';
  // Consolidate Betway variants
  if (name.toLowerCase().startsWith('betway')) return 'BetWay';
  return name;
}

async function fetchLSports(endpoint, body, retries = 3) {
  // Check rate limit
  if (!rateLimiter.canMakeRequest()) {
    const waitTime = rateLimiter.getWaitTime();
    console.log(`[Rate Limit] Waiting ${waitTime}ms before next LSports request...`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  rateLimiter.recordRequest();
  healthStatus.lastLsportsCheck = new Date().toISOString();

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${LSPORTS_API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // Update health status on success
      healthStatus.lsportsConnected = true;
      healthStatus.lastSuccessfulFetch = new Date().toISOString();
      healthStatus.consecutiveFailures = 0;

      return data;
    } catch (error) {
      console.error(`[LSports] Attempt ${attempt}/${retries} failed:`, error.message);
      healthStatus.consecutiveFailures++;

      if (attempt === retries) {
        healthStatus.lsportsConnected = false;
        throw error;
      }

      // Exponential backoff: 1s, 2s, 4s...
      const backoffMs = Math.pow(2, attempt - 1) * 1000;
      console.log(`[LSports] Retrying in ${backoffMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }
}

// ============ DATA STORAGE ============

let cachedData = {
  matches: [],
  bookmakers: [],
  leaguesInResults: {},
  lastUpdated: null,
  isLoading: false,
  error: null,
  stats: {
    totalBets: 0,
    positiveBets: 0,
    avgEV: 0,
    refreshCount: 0
  }
};

// Separate fixture cache (fixtures change less frequently)
let fixtureCache = {
  fixtures: [],
  lastUpdated: null,
  serverTimestamp: null, // Track for potential delta updates
  ttlMs: 5 * 60 * 1000   // Cache fixtures for 5 minutes
};

// Track API response metadata for debugging
let apiMetadata = {
  lastFixturesResponse: null,
  lastMarketsResponse: null,
  lastServerTimestamp: null,
  totalApiCalls: 0,
  avgResponseTime: 0
};

// ============ MAIN EV CALCULATION ============

async function fetchAndCalculateEV(leagueIds = null) {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] Starting EV calculation...`);
  cachedData.isLoading = true;
  cachedData.error = null;

  try {
    const now = new Date();
    const targetLeagues = leagueIds || Object.keys(LSPORTS_LEAGUES).map(id => parseInt(id));

    // Step 1: Get fixtures (use cache if fresh)
    let allFixtures;
    const fixtureCacheAge = fixtureCache.lastUpdated ? Date.now() - new Date(fixtureCache.lastUpdated).getTime() : Infinity;

    if (fixtureCache.fixtures.length > 0 && fixtureCacheAge < fixtureCache.ttlMs) {
      console.log(`[LSports] Using cached fixtures (age: ${Math.round(fixtureCacheAge / 1000)}s)`);
      allFixtures = fixtureCache.fixtures;
    } else {
      console.log(`[LSports] Fetching fresh fixtures...`);
      const fixturesRes = await fetchLSports('/PreMatch/GetFixtures', LSPORTS_CREDS);
      allFixtures = fixturesRes?.Body || [];

      // Update fixture cache
      fixtureCache.fixtures = allFixtures;
      fixtureCache.lastUpdated = new Date().toISOString();
      fixtureCache.serverTimestamp = fixturesRes?.Header?.ServerTimestamp || null;

      // Track metadata
      apiMetadata.lastFixturesResponse = {
        timestamp: new Date().toISOString(),
        fixtureCount: allFixtures.length,
        serverTimestamp: fixturesRes?.Header?.ServerTimestamp
      };
      apiMetadata.totalApiCalls++;
    }

    // Filter to target leagues and upcoming games
    const fixtures = allFixtures
      .map(e => {
        const fixture = e.Fixture || e;
        const participants = fixture.Participants || [];
        const partList = Array.isArray(participants) ? participants : [participants];
        const leagueId = fixture.League?.Id;
        const leagueConfig = LSPORTS_LEAGUES[leagueId];
        return {
          fixtureId: e.FixtureId,
          league: fixture.League?.Name,
          leagueId: leagueId,
          leagueEmoji: leagueConfig?.emoji || '⚽',
          country: leagueConfig?.country || 'Unknown',
          startDate: fixture.StartDate,
          home: partList.find(p => p.Position === "1" || p.Position === 1)?.Name,
          away: partList.find(p => p.Position === "2" || p.Position === 2)?.Name,
        };
      })
      .filter(f => f.fixtureId && targetLeagues.includes(f.leagueId) && new Date(f.startDate) > now)
      .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
      .slice(0, 50);

    console.log(`[LSports] Found ${fixtures.length} upcoming fixtures`);

    if (fixtures.length === 0) {
      cachedData.matches = [];
      cachedData.lastUpdated = new Date().toISOString();
      cachedData.isLoading = false;
      return;
    }

    // Step 2: Get markets for all fixtures
    const fixtureIds = fixtures.map(f => f.fixtureId);
    const marketsStartTime = Date.now();
    const marketsRes = await fetchLSports('/PreMatch/GetFixtureMarkets', {
      ...LSPORTS_CREDS,
      Fixtures: fixtureIds,
      Markets: Object.keys(LSPORTS_TARGET_MARKETS).map(id => parseInt(id))
    });
    const marketsEvents = marketsRes?.Body || [];
    const marketsResponseTime = Date.now() - marketsStartTime;

    // Track markets API metadata
    apiMetadata.lastMarketsResponse = {
      timestamp: new Date().toISOString(),
      eventCount: marketsEvents.length,
      fixtureCount: fixtureIds.length,
      responseTimeMs: marketsResponseTime,
      serverTimestamp: marketsRes?.Header?.ServerTimestamp
    };
    apiMetadata.lastServerTimestamp = marketsRes?.Header?.ServerTimestamp;
    apiMetadata.totalApiCalls++;

    // Update average response time
    apiMetadata.avgResponseTime = apiMetadata.avgResponseTime
      ? (apiMetadata.avgResponseTime + marketsResponseTime) / 2
      : marketsResponseTime;

    console.log(`[LSports] Received markets for ${marketsEvents.length} events (${marketsResponseTime}ms)`);

    // Step 3: Process each fixture and calculate EV
    const matches = [];
    const allBookmakers = new Set();

    for (const event of marketsEvents) {
      const fixture = fixtures.find(f => f.fixtureId === event.FixtureId);
      if (!fixture) continue;

      const valueBets = [];

      for (const market of (event.Markets || [])) {
        const marketConfig = LSPORTS_TARGET_MARKETS[market.Id];
        if (!marketConfig) continue;

        // Group bets by selection
        const selectionGroups = {};
        const isPlayerProp = marketConfig.isPlayerProp;
        const isPlayerShotsMarket = market.Id === 2351;

        for (const pm of (market.ProviderMarkets || [])) {
          const bookmaker = normalizeBookmaker(pm.Name);
          allBookmakers.add(bookmaker);

          for (const bet of (pm.Bets || [])) {
            if (!bet.Price || parseFloat(bet.Price) <= 1) continue;

            // Handle player prop naming
            let selectionName = bet.Name;
            let playerName = bet.PlayerName || null;

            if (isPlayerProp && isPlayerShotsMarket && bet.PlayerName) {
              selectionName = `${bet.PlayerName} ${bet.Name}`;
            }

            const key = `${selectionName}${bet.Line ? `_${bet.Line}` : ''}`;
            if (!selectionGroups[key]) {
              selectionGroups[key] = {
                name: selectionName,
                line: bet.Line,
                playerName: playerName || (isPlayerProp ? bet.Name : null),
                odds: []
              };
            }
            selectionGroups[key].odds.push({
              bookmaker,
              price: parseFloat(bet.Price)
            });
          }
        }

        // Calculate EV for each selection
        for (const selection of Object.values(selectionGroups)) {
          // Require at least 4 bookmakers for reliable median calculation
          if (selection.odds.length < 4) continue;

          // Calculate fair odds using MEDIAN of all bookmaker odds
          const allPrices = selection.odds.map(o => o.price);
          const medianOdds = calculateMedian(allPrices);
          const fairOdds = medianOdds;
          const fairProb = 1 / fairOdds;

          // Calculate EV for each bookmaker
          const oddsWithEV = selection.odds.map(o => ({
            ...o,
            ev: calculateEV(fairProb, o.price),
            isPositiveEV: calculateEV(fairProb, o.price) > 0
          }));

          // Sort by EV
          oddsWithEV.sort((a, b) => (b.ev || 0) - (a.ev || 0));

          const bestOdds = oddsWithEV[0];
          if (!bestOdds) continue;

          valueBets.push({
            marketId: market.Id,
            marketName: marketConfig.name,
            category: marketConfig.category,
            isPlayerProp: isPlayerProp || false,
            playerName: selection.playerName || null,
            selection: selection.name,
            line: selection.line,
            fairOdds: parseFloat(fairOdds.toFixed(3)),
            fairProb: parseFloat((fairProb * 100).toFixed(1)),
            bestBookmaker: bestOdds.bookmaker,
            bestOdds: bestOdds.price,
            bestEV: parseFloat((bestOdds.ev || 0).toFixed(2)),
            allBookmakers: oddsWithEV.map(o => ({
              bookmaker: o.bookmaker,
              odds: o.price,
              ev: parseFloat((o.ev || 0).toFixed(2)),
              isPositiveEV: o.isPositiveEV
            })),
            bookmakerCount: selection.odds.length
          });
        }
      }

      if (valueBets.length > 0) {
        valueBets.sort((a, b) => b.bestEV - a.bestEV);

        matches.push({
          fixtureId: fixture.fixtureId,
          homeTeam: fixture.home,
          awayTeam: fixture.away,
          kickoff: fixture.startDate,
          league: fixture.league,
          leagueId: fixture.leagueId,
          leagueEmoji: fixture.leagueEmoji,
          country: fixture.country,
          valueBets,
          totalEV: valueBets.reduce((sum, vb) => sum + vb.bestEV, 0),
          bestEV: valueBets[0]?.bestEV || 0,
          betCount: valueBets.length
        });
      }
    }

    // Sort matches by best EV
    matches.sort((a, b) => b.bestEV - a.bestEV);

    // Get unique leagues from results
    const leaguesInResults = {};
    matches.forEach(m => {
      if (!leaguesInResults[m.leagueId]) {
        leaguesInResults[m.leagueId] = {
          id: m.leagueId,
          name: m.league,
          emoji: m.leagueEmoji,
          country: m.country,
          matchCount: 0
        };
      }
      leaguesInResults[m.leagueId].matchCount++;
    });

    // Calculate stats
    const allBets = matches.flatMap(m => m.valueBets);
    const positiveBets = allBets.filter(b => b.bestEV > 0);

    // Update cache
    cachedData = {
      matches,
      bookmakers: [...allBookmakers].sort(),
      leaguesInResults,
      lastUpdated: new Date().toISOString(),
      isLoading: false,
      error: null,
      stats: {
        totalBets: allBets.length,
        positiveBets: positiveBets.length,
        avgEV: positiveBets.length > 0
          ? (positiveBets.reduce((sum, b) => sum + b.bestEV, 0) / positiveBets.length).toFixed(2)
          : 0,
        refreshCount: (cachedData.stats?.refreshCount || 0) + 1,
        fixtureCount: matches.length
      }
    };

    console.log(`[LSports] EV calculation complete: ${matches.length} matches, ${allBets.length} bets, ${positiveBets.length} positive EV`);

    // Detect EV changes and send WebSocket notifications
    detectEVChangesAndNotify(matches);

    // Broadcast full update to all connected clients
    io.emit('full-update', {
      matches: cachedData.matches,
      bookmakers: cachedData.bookmakers,
      lastUpdated: cachedData.lastUpdated,
      stats: cachedData.stats
    });

  } catch (error) {
    console.error('[LSports] Error:', error);
    cachedData.error = error.message;
    cachedData.isLoading = false;
  }
}

// ============ API ROUTES ============

// Get all EV bets
app.get('/api/ev-bets', (req, res) => {
  const minEV = parseFloat(req.query.minEV || '0');
  const maxOdds = parseFloat(req.query.maxOdds || '10');
  const categories = req.query.categories?.split(',') || null;
  const leagues = req.query.leagues?.split(',').map(id => parseInt(id)) || null;

  let matches = cachedData.matches;

  // Filter by league
  if (leagues && leagues.length > 0) {
    matches = matches.filter(m => leagues.includes(m.leagueId));
  }

  // Filter bets within matches
  matches = matches.map(match => {
    let filteredBets = match.valueBets;

    // Filter by category
    if (categories && categories.length > 0) {
      filteredBets = filteredBets.filter(b => categories.includes(b.category));
    }

    // Filter by minEV and maxOdds
    filteredBets = filteredBets.filter(b => b.bestEV >= minEV && b.bestOdds <= maxOdds);

    return {
      ...match,
      valueBets: filteredBets,
      betCount: filteredBets.length,
      bestEV: filteredBets[0]?.bestEV || 0
    };
  }).filter(m => m.valueBets.length > 0);

  res.json({
    success: true,
    matches,
    availableBookmakers: cachedData.bookmakers,
    leaguesInResults: cachedData.leaguesInResults,
    generatedAt: cachedData.lastUpdated,
    totalBets: cachedData.stats?.totalPositiveEV || 0,
    stats: cachedData.stats
  });
});

// Get server status
app.get('/api/status', (req, res) => {
  res.json({
    status: 'running',
    lastUpdated: cachedData.lastUpdated,
    isLoading: cachedData.isLoading,
    error: cachedData.error,
    stats: cachedData.stats,
    uptime: process.uptime()
  });
});

// Health monitoring endpoint
app.get('/api/health', async (req, res) => {
  const now = new Date();

  // Check if data is stale (>10 minutes old)
  const dataAge = cachedData.lastUpdated
    ? (now - new Date(cachedData.lastUpdated)) / 1000 / 60
    : null;
  const isDataStale = dataAge === null || dataAge > 10;

  // Check Supabase connectivity
  try {
    const { error } = await supabase.from('tracked_bets').select('id').limit(1);
    healthStatus.supabaseConnected = !error;
  } catch {
    healthStatus.supabaseConnected = false;
  }

  // Determine overall health
  const isHealthy = healthStatus.lsportsConnected &&
                    healthStatus.supabaseConnected &&
                    !isDataStale &&
                    healthStatus.consecutiveFailures < 3;

  const warnings = [];
  if (isDataStale) warnings.push(`Data is stale (${dataAge?.toFixed(1) || 'N/A'} minutes old)`);
  if (!healthStatus.lsportsConnected) warnings.push('LSports API disconnected');
  if (!healthStatus.supabaseConnected) warnings.push('Supabase disconnected');
  if (healthStatus.consecutiveFailures > 0) warnings.push(`${healthStatus.consecutiveFailures} consecutive failures`);

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'unhealthy',
    timestamp: now.toISOString(),
    uptime: process.uptime(),
    services: {
      lsports: {
        connected: healthStatus.lsportsConnected,
        lastCheck: healthStatus.lastLsportsCheck,
        lastSuccess: healthStatus.lastSuccessfulFetch,
        consecutiveFailures: healthStatus.consecutiveFailures
      },
      supabase: {
        connected: healthStatus.supabaseConnected
      }
    },
    data: {
      lastUpdated: cachedData.lastUpdated,
      ageMinutes: dataAge?.toFixed(1) || null,
      isStale: isDataStale,
      matchCount: cachedData.matches?.length || 0,
      betCount: cachedData.stats?.totalBets || 0
    },
    rateLimit: {
      requestsInWindow: rateLimiter.requests.length,
      maxRequests: rateLimiter.maxRequests,
      windowMs: rateLimiter.windowMs
    },
    warnings,
    serverStartTime: healthStatus.serverStartTime
  });
});

// Force refresh
app.post('/api/refresh', async (req, res) => {
  const leagues = req.body.leagues || null;
  await fetchAndCalculateEV(leagues);
  res.json({
    success: true,
    message: 'Refresh complete',
    lastUpdated: cachedData.lastUpdated,
    stats: cachedData.stats
  });
});

// Get available leagues
app.get('/api/leagues', (req, res) => {
  res.json({
    success: true,
    leagues: Object.entries(LSPORTS_LEAGUES).map(([id, config]) => ({
      id: parseInt(id),
      ...config
    }))
  });
});

// Get available markets
app.get('/api/markets', (req, res) => {
  res.json({
    success: true,
    markets: Object.entries(LSPORTS_TARGET_MARKETS).map(([id, config]) => ({
      id: parseInt(id),
      ...config
    }))
  });
});

// Debug endpoint - API metadata and performance stats
app.get('/api/debug', (req, res) => {
  res.json({
    success: true,
    apiMetadata: {
      ...apiMetadata,
      fixtureCacheAge: fixtureCache.lastUpdated
        ? Math.round((Date.now() - new Date(fixtureCache.lastUpdated).getTime()) / 1000) + 's'
        : null,
      fixtureCacheTTL: fixtureCache.ttlMs / 1000 + 's',
      cachedFixtureCount: fixtureCache.fixtures.length
    },
    healthStatus,
    rateLimit: {
      requestsInWindow: rateLimiter.requests.length,
      maxRequests: rateLimiter.maxRequests,
      canMakeRequest: rateLimiter.canMakeRequest()
    },
    cache: {
      matchCount: cachedData.matches?.length || 0,
      bookmakerCount: cachedData.bookmakers?.length || 0,
      lastUpdated: cachedData.lastUpdated
    }
  });
});

// Get scores for settlement (based on guide's GetScores pattern)
app.get('/api/scores', async (req, res) => {
  const { fixtureIds, fromDate, toDate } = req.query;

  try {
    // Build request body
    const body = { ...LSPORTS_CREDS };

    if (fixtureIds) {
      body.Fixtures = fixtureIds.split(',').map(id => parseInt(id.trim()));
    }
    if (fromDate) {
      body.FromDate = fromDate;
    }
    if (toDate) {
      body.ToDate = toDate;
    }

    // The STM API doesn't have a dedicated GetScores endpoint,
    // but we can get scores from GetFixtures with finished status
    const response = await fetchLSports('/PreMatch/GetFixtures', body);
    const events = response?.Body || [];

    // Extract score information
    const scores = events
      .filter(e => e.Fixture?.Status === 3 || e.Livescore) // Status 3 = finished
      .map(e => {
        const fixture = e.Fixture || e;
        const livescore = e.Livescore || {};
        const scoreboard = livescore.Scoreboard || {};
        const periods = livescore.Periods || [];

        return {
          fixtureId: e.FixtureId,
          status: fixture.Status,
          startDate: fixture.StartDate,
          league: fixture.League?.Name,
          home: fixture.Participants?.find(p => p.Position === "1" || p.Position === 1)?.Name,
          away: fixture.Participants?.find(p => p.Position === "2" || p.Position === 2)?.Name,
          score: {
            home: scoreboard.HomeScore || null,
            away: scoreboard.AwayScore || null,
            status: scoreboard.Status,
            currentPeriod: scoreboard.CurrentPeriod
          },
          periods: periods.map(p => ({
            type: p.Type,
            homeScore: p.HomeScore,
            awayScore: p.AwayScore
          }))
        };
      });

    res.json({
      success: true,
      count: scores.length,
      scores
    });

  } catch (error) {
    console.error('[Scores] Error:', error.message);
    res.json({ success: false, error: error.message });
  }
});

// Clear fixture cache (force fresh fetch)
app.post('/api/clear-cache', (req, res) => {
  fixtureCache.fixtures = [];
  fixtureCache.lastUpdated = null;
  fixtureCache.serverTimestamp = null;

  res.json({
    success: true,
    message: 'Fixture cache cleared. Next request will fetch fresh data.'
  });
});

// Get line movement for a specific bet
app.get('/api/line-movement', async (req, res) => {
  const { fixtureId, marketId, selection } = req.query;

  if (!fixtureId || !marketId || !selection) {
    return res.json({ success: false, error: 'Missing parameters: fixtureId, marketId, selection' });
  }

  try {
    // Get all snapshots for this bet in the last 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const { data: snapshots, error } = await supabase
      .from('odds_snapshots')
      .select('best_odds, ev, created_at')
      .eq('fixture_id', parseInt(fixtureId))
      .eq('market_id', parseInt(marketId))
      .eq('selection', selection)
      .gte('created_at', twentyFourHoursAgo.toISOString())
      .order('created_at', { ascending: true });

    if (error) {
      return res.json({ success: false, error: error.message });
    }

    // Calculate movement
    let movement = null;
    if (snapshots && snapshots.length >= 2) {
      const oldest = snapshots[0];
      const newest = snapshots[snapshots.length - 1];

      movement = {
        oddsChange: parseFloat((newest.best_odds - oldest.best_odds).toFixed(3)),
        evChange: parseFloat((newest.ev - oldest.ev).toFixed(2)),
        direction: newest.ev > oldest.ev ? 'up' : newest.ev < oldest.ev ? 'down' : 'stable',
        snapshotCount: snapshots.length,
        firstSnapshot: oldest.created_at,
        lastSnapshot: newest.created_at
      };
    }

    res.json({
      success: true,
      fixtureId: parseInt(fixtureId),
      marketId: parseInt(marketId),
      selection,
      snapshots: snapshots || [],
      movement
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Get all bets with significant line movement
app.get('/api/movers', async (req, res) => {
  try {
    const minChange = parseFloat(req.query.minChange || '0.5');  // Lower threshold
    const hoursBack = parseInt(req.query.hours || '24');  // Look back 24 hours by default
    const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

    // Get ALL snapshots from the time window (paginate to get all)
    let allSnapshots = [];
    let from = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data: batch, error: batchError } = await supabase
        .from('odds_snapshots')
        .select('*')
        .gte('created_at', cutoff.toISOString())
        .order('created_at', { ascending: true })
        .range(from, from + batchSize - 1);

      if (batchError) {
        return res.json({ success: false, error: batchError.message });
      }

      if (batch && batch.length > 0) {
        allSnapshots = allSnapshots.concat(batch);
        from += batchSize;
        hasMore = batch.length === batchSize;

        // Safety limit: don't fetch more than 50k rows
        if (allSnapshots.length >= 50000) {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    }

    const error = null; // For consistency with rest of code

    if (error) {
      return res.json({ success: false, error: error.message });
    }

    if (!allSnapshots || allSnapshots.length === 0) {
      return res.json({ success: true, movers: [], totalFound: 0, message: 'No snapshots found' });
    }

    // Group snapshots by bet (fixture_id + market_id + selection + line)
    const betGroups = {};
    for (const snap of allSnapshots) {
      const key = `${snap.fixture_id}_${snap.market_id}_${snap.selection}_${snap.line || 'null'}`;
      if (!betGroups[key]) {
        betGroups[key] = [];
      }
      betGroups[key].push(snap);
    }

    // Find bets with multiple snapshots and significant movement
    const movers = [];

    for (const [key, snapshots] of Object.entries(betGroups)) {
      // Need at least 2 snapshots to compare
      if (snapshots.length < 2) continue;

      const oldest = snapshots[0];  // First snapshot (oldest due to sort)
      const newest = snapshots[snapshots.length - 1];  // Last snapshot (newest)

      // Skip if same timestamp (no time difference)
      if (oldest.created_at === newest.created_at) continue;

      const evChange = newest.ev - oldest.ev;
      const oddsChange = newest.best_odds - oldest.best_odds;

      // Only include if EV changed significantly
      if (Math.abs(evChange) >= minChange) {
        // Build history for charting
        const history = snapshots.map(s => ({
          time: s.created_at,
          ev: s.ev,
          odds: s.best_odds,
          bookmaker: s.best_bookmaker
        }));

        movers.push({
          fixtureId: newest.fixture_id,
          homeTeam: newest.home_team,
          awayTeam: newest.away_team,
          league: newest.league,
          kickoff: newest.kickoff,
          marketId: newest.market_id,
          marketName: newest.market_name,
          selection: newest.selection,
          line: newest.line,
          currentOdds: newest.best_odds,
          currentEV: newest.ev,
          previousOdds: oldest.best_odds,
          previousEV: oldest.ev,
          oddsChange: parseFloat(oddsChange.toFixed(3)),
          evChange: parseFloat(evChange.toFixed(2)),
          direction: evChange > 0 ? 'up' : 'down',
          bookmaker: newest.best_bookmaker,
          snapshotCount: snapshots.length,
          firstSeen: oldest.created_at,
          lastSeen: newest.created_at,
          history: history  // Full history for charting
        });
      }
    }

    // Sort by absolute EV change (biggest movers first)
    movers.sort((a, b) => Math.abs(b.evChange) - Math.abs(a.evChange));

    res.json({
      success: true,
      movers: movers.slice(0, 100),  // Top 100 movers
      totalFound: movers.length,
      totalSnapshots: allSnapshots.length,
      uniqueBets: Object.keys(betGroups).length
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ============ MANUAL SNAPSHOT TRIGGER ============

app.post('/api/snapshot', async (req, res) => {
  try {
    console.log('[Manual] Triggering snapshot...');
    await saveSnapshot();
    res.json({ success: true, message: 'Snapshot triggered' });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ============ DEBUG SNAPSHOTS ============

app.get('/api/debug-snapshots', async (req, res) => {
  try {
    // Get total count
    const { count: totalCount } = await supabase
      .from('odds_snapshots')
      .select('*', { count: 'exact', head: true });

    // Get distinct timestamps to see how many snapshots we have
    const { data: times, error: timeError } = await supabase
      .from('odds_snapshots')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(5000);

    const uniqueTimes = [...new Set((times || []).map(t => t.created_at))];

    const { data: snapshots, error } = await supabase
      .from('odds_snapshots')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(3000); // Increased limit

    if (error) {
      return res.json({ success: false, error: error.message });
    }

    // Group by bet key and count
    const betGroups = {};
    for (const snap of snapshots || []) {
      const key = `${snap.fixture_id}_${snap.market_id}_${snap.selection}_${snap.line || 'null'}`;
      if (!betGroups[key]) {
        betGroups[key] = [];
      }
      betGroups[key].push({
        ev: snap.ev,
        odds: snap.best_odds,
        created_at: snap.created_at
      });
    }

    // Find bets with multiple snapshots
    const multipleSnaps = Object.entries(betGroups)
      .filter(([_, snaps]) => snaps.length > 1)
      .map(([key, snaps]) => ({
        key,
        count: snaps.length,
        snapshots: snaps,
        evChange: snaps[snaps.length - 1].ev - snaps[0].ev
      }))
      .slice(0, 20);

    // Count distribution
    const distribution = {};
    for (const [_, snaps] of Object.entries(betGroups)) {
      const count = snaps.length;
      distribution[count] = (distribution[count] || 0) + 1;
    }

    res.json({
      success: true,
      totalInDb: totalCount,
      totalFetched: snapshots?.length || 0,
      uniqueBets: Object.keys(betGroups).length,
      distribution,
      betsWithMultiple: multipleSnaps.length,
      samples: multipleSnaps,
      snapshotTimes: uniqueTimes.slice(0, 10),
      uniqueSnapshotCount: uniqueTimes.length
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ============ NBA INVESTIGATION ============

app.get('/api/investigate-nba', async (req, res) => {
  try {
    const results = { steps: [] };

    // Step 1: Get NBA fixtures directly (League 64)
    results.steps.push({ step: 1, name: 'Getting NBA fixtures (League 64)' });

    const nbaFixturesBody = {
      ...LSPORTS_CREDS,
      Leagues: [64] // NBA
    };

    const nbaFixturesRes = await fetch(LSPORTS_API_BASE + '/PreMatch/GetFixtures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nbaFixturesBody)
    });
    const nbaFixturesText = await nbaFixturesRes.text();
    const nbaFixturesData = nbaFixturesText ? JSON.parse(nbaFixturesText) : { error: 'Empty response' };

    const basketballFixtures = nbaFixturesData.Body || [];
    results.nbaFixtures = basketballFixtures.length;

    if (basketballFixtures.length > 0) {
      results.sampleFixture = {
        FixtureId: basketballFixtures[0].FixtureId,
        Teams: basketballFixtures[0].Fixture?.Participants?.map(p => p.Name),
        StartDate: basketballFixtures[0].Fixture?.StartDate,
        League: basketballFixtures[0].Fixture?.League
      };
      results.basketballFixtures = basketballFixtures.length;

      // Find unique leagues in basketball fixtures
      if (basketballFixtures.length > 0) {
        const leagues = {};
        basketballFixtures.forEach(f => {
          const league = f.Fixture?.League || f.League;
          if (league) {
            leagues[league.Id] = league.Name;
          }
        });
        results.basketballLeagues = leagues;
        results.sampleBasketballFixture = basketballFixtures[0];

        // Step 2: Get markets for basketball fixtures
        results.steps.push({ step: 2, name: 'Getting markets for basketball fixtures' });

        const fixtureIds = basketballFixtures.slice(0, 5).map(f => f.FixtureId);
        results.fixtureIds = fixtureIds;

        // Try 1: No market filter
        const marketsBody1 = {
          ...LSPORTS_CREDS,
          FixtureIds: fixtureIds
        };

        const marketsRes1 = await fetch(LSPORTS_API_BASE + '/PreMatch/GetFixtureMarkets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(marketsBody1)
        });
        const marketsText1 = await marketsRes1.text();
        const marketsData1 = marketsText1 ? JSON.parse(marketsText1) : { error: 'Empty response' };

        results.attempt1_noFilter = {
          bodyLength: marketsData1.Body?.length || 0,
          marketsPerEvent: marketsData1.Body?.[0]?.Markets?.length || 0,
          header: marketsData1.Header
        };

        // Try 2: With common basketball market IDs (Moneyline=1, Spread=3, Total=2, etc)
        const basketballMarketIds = [1, 2, 3, 64, 65, 77, 202, 342, 835, 836];
        const marketsBody2 = {
          ...LSPORTS_CREDS,
          FixtureIds: fixtureIds,
          Markets: basketballMarketIds
        };

        const marketsRes2 = await fetch(LSPORTS_API_BASE + '/PreMatch/GetFixtureMarkets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(marketsBody2)
        });
        const marketsText2 = await marketsRes2.text();
        const marketsData2 = marketsText2 ? JSON.parse(marketsText2) : { error: 'Empty response' };

        results.attempt2_withMarketIds = {
          requestedMarkets: basketballMarketIds,
          bodyLength: marketsData2.Body?.length || 0,
          marketsPerEvent: marketsData2.Body?.[0]?.Markets?.length || 0,
          header: marketsData2.Header
        };

        // Try 3: Check if markets are embedded in fixture itself
        results.attempt3_checkFixtureData = {
          hasMarketsInFixture: !!basketballFixtures[0]?.Markets,
          marketsLength: basketballFixtures[0]?.Markets?.length || 0
        };

        // Try 4: Check different endpoint - GetEvents
        const eventsBody = {
          ...LSPORTS_CREDS,
          Events: fixtureIds
        };

        const eventsRes = await fetch(LSPORTS_API_BASE + '/PreMatch/GetEvents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(eventsBody)
        });
        const eventsText = await eventsRes.text();
        let eventsData = null;
        try {
          eventsData = eventsText ? JSON.parse(eventsText) : null;
        } catch (e) {
          eventsData = { parseError: e.message, rawLength: eventsText?.length };
        }

        results.attempt4_getEvents = {
          bodyLength: eventsData?.Body?.length || 0,
          hasMarkets: !!eventsData?.Body?.[0]?.Markets,
          marketsLength: eventsData?.Body?.[0]?.Markets?.length || 0,
          header: eventsData?.Header,
          sampleMarkets: eventsData?.Body?.[0]?.Markets?.slice(0, 5)?.map(m => ({
            id: m.Id,
            name: m.Name,
            betsCount: m.Bets?.length || 0
          }))
        };

        // Try 5: Check raw fixture data for any odds info
        const rawFixture = basketballFixtures[0];
        results.rawFixtureKeys = Object.keys(rawFixture || {});
        if (rawFixture?.Fixture) {
          results.rawFixtureInnerKeys = Object.keys(rawFixture.Fixture);
        }

        // If any attempt has markets, show them
        if (marketsData2.Body?.[0]?.Markets?.length > 0) {
          results.sampleMarkets = marketsData2.Body[0].Markets.slice(0, 10).map(m => ({
            id: m.Id,
            name: m.Name,
            betsCount: m.Bets?.length || 0,
            sampleBets: m.Bets?.slice(0, 3)?.map(b => ({
              name: b.Name,
              line: b.Line,
              providersCount: b.Providers?.length || 0,
              sampleOdds: b.Providers?.slice(0, 3)?.map(p => ({
                bookmaker: p.Name,
                odds: p.Bets?.[0]?.Price
              }))
            }))
          }));
        }
      }
    }

    res.json({ success: true, ...results });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ============ BET TRACKING ============

// Track a new bet
app.post('/api/bets', async (req, res) => {
  try {
    const {
      fixtureId, homeTeam, awayTeam, league, kickoff,
      marketId, marketName, selection, line,
      odds, fairOdds, ev, stakeUnits, stakeAmount, bookmaker
    } = req.body;

    if (!fixtureId || !marketId || !selection || !odds) {
      return res.json({ success: false, error: 'Missing required fields' });
    }

    const { data, error } = await supabase
      .from('tracked_bets')
      .insert({
        fixture_id: fixtureId,
        home_team: homeTeam,
        away_team: awayTeam,
        league: league,
        kickoff: kickoff,
        market_id: marketId,
        market_name: marketName,
        selection: selection,
        line: line || null,
        odds: odds,
        fair_odds: fairOdds,
        ev_at_placement: ev,
        stake_units: stakeUnits,
        stake_amount: stakeAmount,
        bookmaker: bookmaker,
        result: 'pending',
        placed_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('[Bets] Insert error:', error);
      return res.json({ success: false, error: error.message });
    }

    console.log(`[Bets] Tracked new bet: ${selection} @ ${odds} (${bookmaker})`);
    res.json({ success: true, bet: data });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Get all tracked bets
app.get('/api/bets', async (req, res) => {
  try {
    const status = req.query.status; // pending, won, lost, void, all

    let query = supabase
      .from('tracked_bets')
      .select('*')
      .order('placed_at', { ascending: false });

    if (status && status !== 'all') {
      query = query.eq('result', status);
    }

    const { data, error } = await query;

    if (error) {
      return res.json({ success: false, error: error.message });
    }

    // Calculate stats
    const bets = data || [];
    const settled = bets.filter(b => b.result !== 'pending');
    const won = bets.filter(b => b.result === 'won');
    const lost = bets.filter(b => b.result === 'lost');

    const totalStaked = settled.reduce((sum, b) => sum + (b.stake_amount || 0), 0);
    const totalProfit = settled.reduce((sum, b) => sum + (b.profit || 0), 0);
    const totalUnitsStaked = settled.reduce((sum, b) => sum + (b.stake_units || 0), 0);
    const totalUnitsProfit = won.reduce((sum, b) => sum + (b.stake_units * (b.odds - 1)), 0) -
                             lost.reduce((sum, b) => sum + b.stake_units, 0);

    const stats = {
      total: bets.length,
      pending: bets.filter(b => b.result === 'pending').length,
      won: won.length,
      lost: lost.length,
      voided: bets.filter(b => b.result === 'void').length,
      winRate: settled.length > 0 ? ((won.length / settled.length) * 100).toFixed(1) : 0,
      totalStaked: totalStaked.toFixed(2),
      totalProfit: totalProfit.toFixed(2),
      roi: totalStaked > 0 ? ((totalProfit / totalStaked) * 100).toFixed(1) : 0,
      totalUnitsStaked: totalUnitsStaked.toFixed(2),
      totalUnitsProfit: totalUnitsProfit.toFixed(2),
      avgEV: bets.length > 0 ? (bets.reduce((sum, b) => sum + (b.ev_at_placement || 0), 0) / bets.length).toFixed(1) : 0
    };

    res.json({ success: true, bets, stats });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Update bet result
app.patch('/api/bets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { result } = req.body; // won, lost, void, push

    if (!['won', 'lost', 'void', 'push', 'pending'].includes(result)) {
      return res.json({ success: false, error: 'Invalid result. Use: won, lost, void, push, pending' });
    }

    // First get the bet to calculate profit
    const { data: bet, error: fetchError } = await supabase
      .from('tracked_bets')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !bet) {
      return res.json({ success: false, error: 'Bet not found' });
    }

    // Calculate profit based on result
    let profit = 0;
    if (result === 'won') {
      profit = bet.stake_amount * (bet.odds - 1);
    } else if (result === 'lost') {
      profit = -bet.stake_amount;
    } else if (result === 'void' || result === 'push') {
      profit = 0; // Stake returned
    }

    const { data, error } = await supabase
      .from('tracked_bets')
      .update({
        result: result,
        profit: profit,
        settled_at: result === 'pending' ? null : new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.json({ success: false, error: error.message });
    }

    console.log(`[Bets] Updated bet ${id}: ${result} (profit: ${profit.toFixed(2)})`);
    res.json({ success: true, bet: data });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Delete a bet
app.delete('/api/bets/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('tracked_bets')
      .delete()
      .eq('id', id);

    if (error) {
      return res.json({ success: false, error: error.message });
    }

    console.log(`[Bets] Deleted bet ${id}`);
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ============ SNAPSHOT FUNCTIONS ============

async function saveSnapshot() {
  console.log(`[Snapshot] Starting snapshot...`);

  const now = new Date();
  const cutoffTime = new Date(now.getTime() + HOURS_BEFORE_KICKOFF * 60 * 60 * 1000);

  // Get bets with EV >= MIN_EV_FOR_SNAPSHOT and kickoff within 48h
  const betsToSnapshot = [];

  for (const match of cachedData.matches) {
    const kickoff = new Date(match.kickoff);

    // Only snapshot if kickoff is within 48 hours
    if (kickoff > now && kickoff <= cutoffTime) {
      for (const bet of match.valueBets) {
        if (bet.bestEV >= MIN_EV_FOR_SNAPSHOT) {
          betsToSnapshot.push({
            fixture_id: match.fixtureId,
            kickoff: match.kickoff,
            home_team: match.homeTeam,
            away_team: match.awayTeam,
            league: match.league,
            market_id: bet.marketId,
            market_name: bet.marketName,
            selection: bet.selection,
            line: bet.line || null,
            best_odds: Math.min(bet.bestOdds, 999.99),  // Cap to prevent overflow
            best_bookmaker: bet.bestBookmaker,
            fair_odds: Math.min(bet.fairOdds, 999.99),  // Cap to prevent overflow
            ev: Math.min(bet.bestEV, 999.99),           // Cap to prevent overflow
            bookmaker_count: bet.allBookmakers?.length || 0
          });
        }
      }
    }
  }

  if (betsToSnapshot.length === 0) {
    console.log(`[Snapshot] No bets with EV >= ${MIN_EV_FOR_SNAPSHOT}% within ${HOURS_BEFORE_KICKOFF}h of kickoff`);
    return;
  }

  console.log(`[Snapshot] Saving ${betsToSnapshot.length} bets to Supabase...`);

  // Insert in batches of 500
  const batchSize = 500;
  let inserted = 0;

  for (let i = 0; i < betsToSnapshot.length; i += batchSize) {
    const batch = betsToSnapshot.slice(i, i + batchSize);
    const { error } = await supabase
      .from('odds_snapshots')
      .insert(batch);

    if (error) {
      console.error(`[Snapshot] Error inserting batch:`, error.message);
    } else {
      inserted += batch.length;
    }
  }

  console.log(`[Snapshot] Saved ${inserted} bets to Supabase`);
}

async function getLineMovement(fixtureId, marketId, selection) {
  const now = new Date();
  const twentyMinAgo = new Date(now.getTime() - 20 * 60 * 1000);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  // Get most recent snapshot for this bet
  const { data: recent } = await supabase
    .from('odds_snapshots')
    .select('best_odds, ev, created_at')
    .eq('fixture_id', fixtureId)
    .eq('market_id', marketId)
    .eq('selection', selection)
    .gte('created_at', twentyMinAgo.toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  // Get snapshot from ~1 hour ago
  const { data: hourAgo } = await supabase
    .from('odds_snapshots')
    .select('best_odds, ev, created_at')
    .eq('fixture_id', fixtureId)
    .eq('market_id', marketId)
    .eq('selection', selection)
    .lte('created_at', oneHourAgo.toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  return {
    recent: recent?.[0] || null,
    hourAgo: hourAgo?.[0] || null
  };
}

async function cleanupOldSnapshots() {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

  const { error, count } = await supabase
    .from('odds_snapshots')
    .delete()
    .lt('kickoff', threeDaysAgo.toISOString());

  if (error) {
    console.error(`[Cleanup] Error:`, error.message);
  } else {
    console.log(`[Cleanup] Removed old snapshots`);
  }
}

// ============ SCHEDULER ============

const REFRESH_INTERVAL = 60 * 1000; // 1 minute
let lastSnapshotTime = 0;

function startScheduler() {
  console.log(`[Scheduler] Starting with ${REFRESH_INTERVAL / 1000}s interval`);
  console.log(`[Scheduler] Snapshots every ${SNAPSHOT_INTERVAL / 60000} minutes for bets with EV >= ${MIN_EV_FOR_SNAPSHOT}%`);

  // Initial fetch
  fetchAndCalculateEV();

  // Schedule recurring fetches
  setInterval(async () => {
    await fetchAndCalculateEV();

    // Check if it's time for a snapshot (every 20 min)
    const now = Date.now();
    if (now - lastSnapshotTime >= SNAPSHOT_INTERVAL) {
      lastSnapshotTime = now;
      await saveSnapshot();

      // Cleanup old data once per hour
      if (Math.random() < 0.05) { // ~5% chance = roughly once per hour
        await cleanupOldSnapshots();
      }
    }
  }, REFRESH_INTERVAL);

  // Take first snapshot after 2 minutes (let data load first)
  setTimeout(() => {
    lastSnapshotTime = Date.now();
    saveSnapshot();
  }, 2 * 60 * 1000);
}

// ============ START SERVER ============

httpServer.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   LSports EV Server + WebSocket                           ║
║   Running on http://localhost:${PORT}                        ║
║                                                           ║
║   REST Endpoints:                                         ║
║   • GET  /api/ev-bets       - Get EV opportunities        ║
║   • GET  /api/status        - Server status               ║
║   • POST /api/refresh       - Force refresh               ║
║   • GET  /api/leagues       - Available leagues           ║
║   • GET  /api/markets       - Available markets           ║
║   • GET  /api/line-movement - Historical odds data        ║
║   • GET  /api/movers        - Bets with EV changes        ║
║                                                           ║
║   WebSocket Events (Socket.IO):                           ║
║   • 'full-update'       - Complete data refresh           ║
║   • 'ev-notifications'  - New/changed +EV bets            ║
║   • 'ev-update-summary' - Summary of changes              ║
║   • 'set-preferences'   - Set notification prefs          ║
║                                                           ║
║   Snapshots: Every ${SNAPSHOT_INTERVAL / 60000} min (EV >= ${MIN_EV_FOR_SNAPSHOT}%)                  ║
║   Refresh: ${REFRESH_INTERVAL / 1000}s | Storage: Supabase                    ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);

  startScheduler();
});
