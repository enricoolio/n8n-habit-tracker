# Calorie & Habit Tracker

Personal calorie and habit tracking bot powered by n8n, Telegram, and Claude AI.

## How it works

- **Text**: Send any food description to Telegram and the AI estimates calories and macros
- **Photos**: Send a food photo and the AI analyzes it
- **Habits**: Tap inline buttons at the 9 PM evening check-in to log 6 daily habits
- **Reset**: Say "restart the day" to zero out today's data

## Setup

1. Import `workflows/calorie-habit-tracker.json` into n8n
2. Connect your Telegram Bot API credential
3. Connect your Anthropic API credential
4. Create an n8n DataTable with columns: `date`, `chat_id`, `total_calories`, `total_protein`, `total_carbs`, `total_fat`, `meals_log`, `workout`, `steps_10k`, `reading`, `supplements`, `mindfulness`, `sleep_quality`
5. Update the DataTable ID in the workflow nodes
6. Update the chat_id in `Evening Config` node
7. Activate the workflow

## Architecture

- **Message flow**: Telegram Trigger → Route (message vs callback) → Get Date → Fetch today's log → Prepare AI context → Claude Agent → Extract structured data → Save → Reply
- **Callback flow**: Parse button tap → Fetch today → Update habit → Save → Confirm
- **Evening flow**: 9 PM schedule → Fetch today → Build summary with inline keyboard → Send

## Stack

- n8n (workflow automation)
- Telegram Bot API
- Claude Sonnet (AI calorie estimation)
- n8n DataTables (storage)
