-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/wxtfyhmytbrzoegvwztd/sql

-- Create tracked_bets table
CREATE TABLE IF NOT EXISTS tracked_bets (
  id SERIAL PRIMARY KEY,
  fixture_id INTEGER NOT NULL,
  home_team VARCHAR(255),
  away_team VARCHAR(255),
  league VARCHAR(255),
  kickoff TIMESTAMPTZ,
  market_id INTEGER,
  market_name VARCHAR(255),
  selection VARCHAR(255) NOT NULL,
  line DECIMAL(6,2),
  odds DECIMAL(6,3) NOT NULL,
  fair_odds DECIMAL(6,3),
  ev_at_placement DECIMAL(6,2),
  stake_units DECIMAL(6,2),
  stake_amount DECIMAL(10,2),
  bookmaker VARCHAR(100),
  result VARCHAR(20) DEFAULT 'pending',
  profit DECIMAL(10,2) DEFAULT 0,
  placed_at TIMESTAMPTZ DEFAULT NOW(),
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_tracked_bets_result ON tracked_bets(result);
CREATE INDEX IF NOT EXISTS idx_tracked_bets_placed_at ON tracked_bets(placed_at);

-- Enable Row Level Security (optional but recommended)
ALTER TABLE tracked_bets ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all operations (for development)
CREATE POLICY "Allow all operations" ON tracked_bets FOR ALL USING (true);
