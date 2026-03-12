# Calorie & Habit Tracker

Telegram-based daily food and habit tracker powered by **n8n**, **Claude AI** (Sonnet 4.5), and **n8n Data Tables**.

One single workflow. No external database. No extra setup.

## What It Does

1. **Food Logging** — Send text, photos, or voice notes to your Telegram bot anytime. Claude AI ("Coach Krupt") estimates macros and replies with a running daily total.
2. **Habit Check-in** — At 9 PM daily, the bot asks about your habits (workout, steps, reading, supplements, mindfulness, sleep). Reply naturally and it logs everything.
3. **Daily Welcome** — At 00:01, the bot sends a fresh-start message with your goals.
4. **Commands** — "restart the day" resets tracking to zero. "weekly summary" shows your week's progress.

## Architecture

```
You (Telegram)
  │
  ├─ Text/Photo/Voice ──> Detect Habit Response (regex)
  │                         ├─ YES: Parse & save habits to n8n Data Table
  │                         └─ NO:  Fetch today's log → AI Agent (Claude) → Extract macros → Save → Reply
  │
  ├─ Cron 00:01 ──> Send daily welcome message
  │
  └─ Cron 21:00 ──> Fetch today's data → Send evening check-in with calorie summary
```

**Storage:** n8n's built-in Data Tables (no Supabase, no Notion, no external DB).

**AI Model:** Claude Sonnet 4.5 via Anthropic API, with daily buffer memory (100-message window per session).

## Setup

### Prerequisites

- n8n instance (Cloud or self-hosted)
- Telegram bot token (via [@BotFather](https://t.me/BotFather))
- Anthropic API key

### Installation

1. Import `workflow/calorie-habit-tracker.json` into n8n
2. Set up your Telegram API credential in n8n
3. Set up your Anthropic API credential in n8n
4. Update the hardcoded `chat_id` in:
   - "Initialize Daily Session" node
   - "Prepare Evening Check-in" node
   - "Fetch Today Habits" node
5. The workflow auto-creates its Data Table on first run
6. Activate the workflow

### Getting Your Chat ID

1. Message your bot on Telegram
2. Visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
3. Find `"chat":{"id": YOUR_CHAT_ID}`

## Personalisation

Edit the system prompt in the **Food Tracking Agent** node to change:

- Weight goals (currently 84 kg → 80 kg)
- Calorie targets (currently 1900/2100 kcal)
- Protein target (currently 170 g)
- Coach personality ("Coach Krupt" — direct and blunt)

Edit the **Prepare Evening Check-in** node to change which habits are tracked.

## File Structure

```
workflow/
  calorie-habit-tracker.json   ← the full n8n workflow (import this)
README.md                      ← you are here
```
