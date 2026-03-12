# n8n Habit Tracker

Automated daily habit & food tracking via **Telegram bot**, powered by **n8n workflows**, **Claude AI**, **Supabase**, and **Notion**.

## What It Does

1. **Food Logging** - Send a photo, text, or voice note to your Telegram bot anytime. Claude AI estimates macros and replies with a running daily ledger.
2. **Evening Check-in** - At 9pm daily, the bot asks what habits you completed. Reply naturally (text or voice). It logs everything to Notion + Supabase.
3. **Step Tracking** - iOS Shortcut automatically pushes your Apple Health step count to n8n.
4. **Weekly Recap** - Every Sunday, Claude analyzes your week and sends specific, actionable improvement suggestions.

## Architecture

```
You (Telegram) ──> WF01 (Unified Handler) ──> Claude API (food analysis / vision)
                                            ├──> Supabase (food logs, daily summaries)
                                            ├──> Notion (habit checkboxes)
                                            └──> OpenAI Whisper (voice transcription)

iOS Shortcuts ──> WF03 (Webhook) ──> Supabase (step count)

Cron 9pm ──> WF02 ──> Telegram (check-in question)
                   └──> Supabase (set conversation state = awaiting_checkin)

User replies ──> WF01 detects awaiting_checkin state
              ├──> Parse habits ──> Update Notion
              └──> Save daily summary ──> Reset state ──> Reply

Cron Sunday ──> WF04 ──> Claude (weekly recap) ──> Telegram
```

## How Check-in Replies Work

n8n only allows **one active TelegramTrigger per bot token**. So WF01 is the single Telegram entry point for all messages. A `conversation_state` table in Supabase tracks whether the bot is expecting a check-in reply:

1. **WF02** (cron 9pm) sends the check-in question and sets `state = 'awaiting_checkin'`
2. **WF01** (Telegram trigger) checks the state on every incoming message:
   - If `awaiting_checkin` → routes to habit parsing, Notion update, daily summary
   - If `idle` → routes to food logging (text/photo/voice) or commands

## Workflows

| # | Workflow | Trigger | Purpose |
|---|---------|---------|---------|
| 01 | `telegram-food-logger` | Telegram message | **Unified handler**: food logging (text/photo/voice), check-in replies, commands |
| 02 | `evening-checkin` | Cron (9pm daily) | Send check-in question, set conversation state |
| 03 | `steps-webhook` | HTTP webhook | Receive step count from iOS Shortcut |
| 04 | `weekly-recap` | Cron (Sunday 8pm) | Generate and send weekly analysis |

## Setup Guide

### Prerequisites

- A Telegram account
- An Anthropic API key ([console.anthropic.com](https://console.anthropic.com))
- An OpenAI API key ([platform.openai.com](https://platform.openai.com)) — for voice message transcription via Whisper
- A Supabase account (free tier works)
- Your existing Notion workspace with the Habit Tracker database
- An iPhone (for Apple Health step tracking)

### Step 1: Set Up n8n

**Recommended: n8n Cloud** (easiest, $20/mo)

1. Sign up at [n8n.io](https://n8n.io)
2. Create a new instance

**Alternative: Self-hosted (free)**

```bash
docker run -d --name n8n -p 5678:5678 \
  -v n8n_data:/home/node/.n8n \
  n8nio/n8n
```

### Step 2: Create Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot`
3. Choose a name (e.g., "My Life Coach")
4. Choose a username (e.g., `my_life_coach_bot`)
5. Copy the **bot token** - you'll need it for n8n
6. Message your new bot to start a chat
7. Get your **chat ID** by visiting: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` after sending a message to the bot. Look for `"chat":{"id":YOUR_CHAT_ID}`

### Step 3: Set Up Supabase

1. Create a free project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor**
3. Paste the contents of `supabase/schema.sql` and run it
4. Go to **Settings > API** and copy your:
   - Project URL
   - `anon` public key
   - `service_role` secret key

### Step 4: Set Up Notion Integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Create a new integration (name: "Habit Tracker Bot")
3. Copy the **Internal Integration Secret**
4. In your Notion Habit Tracker database, click **...** > **Connect to** > select your integration
5. Copy the database ID from the URL (the 32-char hex string after the workspace name and before `?v=`)

### Step 5: Configure n8n Environment Variables

In n8n, go to **Settings > Environment Variables** and add:

| Variable | Value |
|----------|-------|
| `TELEGRAM_CHAT_ID` | Your personal Telegram chat ID |

This is used by WF02 and WF04 to send messages to you.

### Step 6: Import n8n Workflows

1. In n8n, go to **Workflows** > **Import from File**
2. Import each JSON file from the `workflows/` folder
3. In each workflow, update the credentials:
   - **Telegram**: Add your bot token
   - **Supabase**: Add your URL + service key
   - **HTTP Header Auth** (for Claude API): Header name = `x-api-key`, value = your Anthropic API key
   - **HTTP Header Auth** (for OpenAI, WF01 only): Header name = `Authorization`, value = `Bearer YOUR_OPENAI_API_KEY`
   - **HTTP Header Auth** (for Notion): Header name = `Authorization`, value = `Bearer YOUR_NOTION_API_KEY`
4. In WF01, update the Notion database ID in the "Find Today's Notion Page" node
5. **Important**: Only activate WF01's Telegram trigger. WF02 and WF04 use cron triggers (no conflict). Do NOT add a separate TelegramTrigger in any other workflow.

### Step 7: iOS Shortcut for Steps

1. Open **Shortcuts** app on iPhone
2. Create a new shortcut:
   - **Find Health Samples** - Type: Steps, Start Date: Start of Today
   - **Calculate Statistics** - Sum
   - **Get Contents of URL**:
     - URL: `https://your-n8n-instance.com/webhook/steps`
     - Method: POST
     - Body: JSON - `{"steps": [Calculated Value], "date": [Current Date formatted as yyyy-MM-dd]}`
3. Set up **Automation**:
   - Time of Day: 8:30 PM
   - Run Immediately (no confirmation)
   - Select your shortcut

### Step 8: Add Your Supplement Plan

Once Supabase is running, add your supplements to the `supplement_plan` table:

```sql
INSERT INTO supplement_plan (name, dosage, timing, purpose, is_active) VALUES
('Magnesium Glycinate', '400mg', 'before_bed', 'Sleep quality, muscle recovery', false),
('Omega-3 Fish Oil', '2000mg', 'with_meal', 'Inflammation, heart health', false),
('Vitamin D3', '4000 IU', 'morning', 'Immune function, mood', false),
('Creatine', '5g', 'with_meal', 'Strength, recovery', false);
-- Set is_active = true when you restock
```

## Tracked Habits

| Habit | Source | Storage |
|-------|--------|---------|
| Eat healthy | AI food analysis | Supabase + Notion |
| 8 hours sleep | Evening check-in | Notion + Supabase |
| Workout | Evening check-in | Notion + Supabase |
| 10,000 steps | iOS Shortcut auto-sync | Supabase + Notion |
| Read 30 min | Evening check-in | Notion + Supabase |
| Supplements | Evening check-in | Notion + Supabase |
| Positivity/Gratefulness | Evening check-in | Notion + Supabase |
| Calendar & Reflection | Evening check-in | Notion + Supabase |

## Supported Input Types

| Type | How | What Happens |
|------|-----|-------------|
| **Text** | Type what you ate | Claude estimates macros from description |
| **Photo** | Send a food photo | Claude vision analyzes the image and estimates macros |
| **Voice** | Send a voice note | Whisper transcribes it, then Claude analyzes as text |
| **Commands** | `/help`, `/totals`, `/training`, `/recap` | Quick info and status |

## Daily Flow

```
Throughout the day:
  Send food photos/text/voice to Telegram bot --> instant macro feedback

8:30 PM: iOS Shortcut auto-sends step count

9:00 PM: Bot asks "what did you do today?"
  You reply: "worked out, read for an hour, took supplements"
  Bot: parses habits, updates Notion checkboxes, saves daily summary, gives score

Sunday 8:00 PM: Weekly recap with actionable suggestions
```

## Customization

- **Training days**: Edit `Build Meal Context` code node in workflow 01. Default: Mon/Wed/Fri
- **Check-in time**: Change cron in workflow 02 (default: 9pm)
- **Weekly recap day**: Change cron in workflow 04 (default: Sunday 8pm)
- **Calorie goals**: Edit the system prompt in `prompts/food-coach-system-prompt.md`
- **Coaching style**: Modify the system prompt to be gentler or harsher
- **Notion column names**: If your Notion database has different column names, update them in the "Update Notion Habits" node in WF01
