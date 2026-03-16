# Habit Tracker — Build Spec

## What This Is

A personal daily habit & calorie tracker that runs as a **single Node.js app** deployed on Railway/Render/fly.io. It replaces the broken n8n workflow approach with a simple, maintainable codebase.

**Owner:** Enrico Mellis | **Timezone:** Europe/Berlin (CET)

## Core Architecture

```
Telegram Bot (single entry point)
  ├── Food logging (text / photo / voice)
  │   └── Claude Haiku 4.5 → macro estimation → save to Supabase → reply
  ├── Commands (/help, /totals, /training, /recap)
  ├── Evening check-in reply parsing → Notion + Supabase
  └── Scheduled messages (cron-style, in-process)

iOS Shortcut → POST /webhook/steps → Supabase

Cron jobs (node-cron):
  ├── 9:00 PM CET daily → send check-in question
  └── 8:00 PM CET Sunday → weekly recap via Claude
```

## Tech Stack

- **Runtime:** Node.js (ES modules)
- **Telegram:** `grammy` (modern, well-maintained Telegram bot framework)
- **Database:** Supabase (PostgreSQL) via `@supabase/supabase-js`
- **AI:** Anthropic SDK (`@anthropic-ai/sdk`) — model: `claude-haiku-4-5-20251001`
- **Voice transcription:** OpenAI Whisper API via `openai` SDK
- **Notion:** `@notionhq/client`
- **Scheduling:** `node-cron`
- **HTTP server:** Express (for steps webhook + health check)
- **Config:** `.env` file via `dotenv`

## Database Schema (Supabase — already exists)

Tables: `food_logs`, `daily_summaries`, `weekly_recaps`, `supplement_plan`, `supplement_logs`, `conversation_state`
View: `today_food_summary`

Schema is in `supabase/schema.sql`. **Do not recreate** — Enrico's Supabase project already has these tables with data.

## Features to Build

### 1. Food Logging (text, photo, voice)

On any Telegram message (when state = `idle`):
- **Text:** Send to Claude with system prompt + today's meal history as context
- **Photo:** Use Claude vision (pass image as base64) with same system prompt
- **Voice:** Download voice file → transcribe with Whisper → treat as text
- Parse Claude's response to extract: meal_name, meal_type, calories, protein_g, carbs_g, fat_g, food_quality, ai_comment
- Save to `food_logs` table
- Reply on Telegram with formatted macro breakdown

Claude system prompt is in `prompts/food-coach-system-prompt.md`.

**Training day detection:** Mon/Wed/Fri = training days (affects calorie goal: 1900 rest / 2100 training).

### 2. Commands

- `/help` — show available commands
- `/totals` — show today's running macro totals
- `/training` — toggle today as training/rest day
- `/recap` — trigger an on-demand weekly recap

### 3. Evening Check-in (cron: 9:00 PM CET daily)

1. Fetch today's food summary + step count from Supabase
2. Send Telegram message with summary + "What did you do today?"
3. Set `conversation_state` to `awaiting_checkin`

### 4. Check-in Reply Parsing (when state = `awaiting_checkin`)

When user replies after check-in prompt:
1. Parse natural language for habits: workout, sleep 8h, read, supplements, positivity, calendar/reflection
2. Auto-derive: eat_healthy (from food quality), steps_10k (from step count)
3. Find or create today's Notion page → update habit checkboxes
4. Upsert `daily_summaries` in Supabase
5. Reset state to `idle`
6. Reply with daily habit score

### 5. Steps Webhook

Express endpoint `POST /webhook/steps` receives:
```json
{"steps": 12345, "date": "2026-03-16"}
```
Upserts into `daily_summaries.steps`.

### 6. Weekly Recap (cron: Sunday 8:00 PM CET)

1. Fetch last 7 days of `daily_summaries` + `food_logs`
2. Calculate averages (calories, macros, steps, habit completion rates)
3. Send to Claude for analysis + actionable suggestions
4. Save to `weekly_recaps`
5. Send recap to Telegram

## Env Variables

```
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=6023241557
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
NOTION_API_KEY=
NOTION_DATABASE_ID=
PORT=3000
```

## Project Structure

```
src/
  index.js          — entry point: init bot, cron, express
  bot.js            — grammy bot setup + message routing
  handlers/
    food.js         — food logging (text/photo/voice)
    checkin.js      — check-in send + reply parsing
    commands.js     — /help, /totals, /training, /recap
    steps.js        — Express webhook handler
  services/
    claude.js       — Anthropic SDK wrapper (food analysis, vision, weekly recap)
    whisper.js      — OpenAI Whisper transcription
    supabase.js     — all database operations
    notion.js       — Notion habit page updates
    state.js        — conversation state management
  cron.js           — node-cron job definitions
  config.js         — env vars + constants (training days, calorie goals)
  prompts.js        — load system prompts from /prompts/
```

## UX Preferences

- **No daily welcome messages** — only the 9pm check-in
- **Minimal friction** — the bot should just work with any input
- **Concise replies** — Telegram-friendly, not walls of text
- **Conservative calorie estimates** — always overestimate when unsure
- **Blunt coaching tone** — strict, no-BS fitness coach personality

## Deployment

Single `Dockerfile` or `package.json` start script. Should run on any Node.js host (Railway, Render, fly.io, or a VPS).

Health check endpoint: `GET /health` → 200 OK.

## What NOT to Build

- No web UI
- No auth system (single-user, chat ID hardcoded)
- No complex state machine beyond idle/awaiting_checkin
- No over-engineered error handling — log errors, keep running
