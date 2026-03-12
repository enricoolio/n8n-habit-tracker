-- Supabase schema for n8n-habit-tracker
-- Run this in the Supabase SQL Editor to set up your tables

-- Daily food log entries (one row per meal)
CREATE TABLE food_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  logged_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  date DATE DEFAULT CURRENT_DATE NOT NULL,

  -- Meal info
  meal_name TEXT NOT NULL,
  meal_type TEXT CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')) DEFAULT 'snack',
  description TEXT, -- what the user said/sent

  -- Macros
  calories INTEGER NOT NULL DEFAULT 0,
  protein_g NUMERIC(6,1) NOT NULL DEFAULT 0,
  carbs_g NUMERIC(6,1) NOT NULL DEFAULT 0,
  fat_g NUMERIC(6,1) NOT NULL DEFAULT 0,

  -- Micros (optional, filled when available)
  fiber_g NUMERIC(6,1),
  sodium_mg NUMERIC(7,1),
  sugar_g NUMERIC(6,1),
  saturated_fat_g NUMERIC(6,1),

  -- Quality
  food_quality TEXT CHECK (food_quality IN ('clean', 'decent', 'processed', 'junk')),
  ai_comment TEXT, -- the blunt feedback from Claude

  -- Source
  input_type TEXT CHECK (input_type IN ('text', 'photo', 'voice', 'label')) DEFAULT 'text',
  photo_url TEXT, -- Telegram file URL if photo was sent

  -- Training context
  is_training_day BOOLEAN DEFAULT false
);

-- Daily summaries (one row per day, updated throughout the day)
CREATE TABLE daily_summaries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE UNIQUE NOT NULL DEFAULT CURRENT_DATE,

  -- Food totals (computed from food_logs)
  total_calories INTEGER DEFAULT 0,
  total_protein_g NUMERIC(6,1) DEFAULT 0,
  total_carbs_g NUMERIC(6,1) DEFAULT 0,
  total_fat_g NUMERIC(6,1) DEFAULT 0,
  total_fiber_g NUMERIC(6,1) DEFAULT 0,
  meal_count INTEGER DEFAULT 0,

  -- Activity
  steps INTEGER,
  workout_done BOOLEAN DEFAULT false,
  workout_type TEXT, -- e.g. 'weights', 'cardio', 'rest'

  -- Goals
  calorie_goal INTEGER DEFAULT 1900,
  is_training_day BOOLEAN DEFAULT false,
  calorie_balance INTEGER, -- positive = surplus, negative = deficit

  -- Habits (mirroring Notion but also stored here for analytics)
  sleep_8h BOOLEAN DEFAULT false,
  eat_healthy BOOLEAN DEFAULT false,
  supplements BOOLEAN DEFAULT false,
  read_30min BOOLEAN DEFAULT false,
  positivity BOOLEAN DEFAULT false,
  calendar_reflection BOOLEAN DEFAULT false,
  steps_10k BOOLEAN DEFAULT false,

  -- Notes
  what_went_wrong TEXT,
  evening_notes TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Weekly recaps (generated every Sunday evening)
CREATE TABLE weekly_recaps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  week_start DATE NOT NULL, -- Monday
  week_end DATE NOT NULL,   -- Sunday

  -- Food averages
  avg_daily_calories NUMERIC(7,1),
  avg_daily_protein_g NUMERIC(6,1),
  avg_daily_carbs_g NUMERIC(6,1),
  avg_daily_fat_g NUMERIC(6,1),
  total_week_calories INTEGER,

  -- Activity
  total_steps INTEGER,
  avg_daily_steps INTEGER,
  workouts_completed INTEGER,
  days_with_10k_steps INTEGER,

  -- Habit completion rates (out of 7)
  sleep_completion INTEGER DEFAULT 0,
  eat_healthy_completion INTEGER DEFAULT 0,
  supplement_completion INTEGER DEFAULT 0,
  read_completion INTEGER DEFAULT 0,
  positivity_completion INTEGER DEFAULT 0,
  workout_completion INTEGER DEFAULT 0,
  steps_completion INTEGER DEFAULT 0,

  -- Overall
  avg_habit_percentage NUMERIC(5,2), -- average daily habit %
  best_day DATE,
  worst_day DATE,
  ai_weekly_summary TEXT, -- Claude's weekly analysis

  created_at TIMESTAMPTZ DEFAULT now()
);

-- Supplement plan (what you SHOULD be taking)
CREATE TABLE supplement_plan (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL, -- e.g. 'Magnesium Glycinate'
  dosage TEXT, -- e.g. '400mg'
  timing TEXT CHECK (timing IN ('morning', 'afternoon', 'evening', 'with_meal', 'before_bed')),
  purpose TEXT, -- e.g. 'sleep quality, muscle recovery'
  is_active BOOLEAN DEFAULT true, -- false = currently out of stock / paused
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Daily supplement log (what you actually took)
CREATE TABLE supplement_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE DEFAULT CURRENT_DATE NOT NULL,
  supplement_id UUID REFERENCES supplement_plan(id),
  taken BOOLEAN DEFAULT false,
  logged_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_supplement_logs_date ON supplement_logs(date);

-- Conversation state for tracking check-in reply flow
-- Used by the unified Telegram handler to know if user is replying to evening check-in
CREATE TABLE conversation_state (
  chat_id TEXT PRIMARY KEY,
  state TEXT DEFAULT 'idle' CHECK (state IN ('idle', 'awaiting_checkin')),
  context JSONB, -- stores food summary context when awaiting check-in reply
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX idx_food_logs_date ON food_logs(date);
CREATE INDEX idx_daily_summaries_date ON daily_summaries(date);
CREATE INDEX idx_weekly_recaps_week ON weekly_recaps(week_start);

-- Auto-update updated_at on daily_summaries
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER daily_summaries_updated_at
  BEFORE UPDATE ON daily_summaries
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Useful view: today's food log with running totals
CREATE OR REPLACE VIEW today_food_summary AS
SELECT
  date,
  COUNT(*) as meal_count,
  SUM(calories) as total_calories,
  SUM(protein_g) as total_protein,
  SUM(carbs_g) as total_carbs,
  SUM(fat_g) as total_fat,
  SUM(fiber_g) as total_fiber,
  BOOL_OR(is_training_day) as is_training_day,
  CASE WHEN BOOL_OR(is_training_day) THEN 2100 ELSE 1900 END as calorie_goal,
  CASE WHEN BOOL_OR(is_training_day) THEN 2100 ELSE 1900 END - SUM(calories) as calories_remaining,
  170 - SUM(protein_g) as protein_remaining
FROM food_logs
WHERE date = CURRENT_DATE
GROUP BY date;
