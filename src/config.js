const required = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'NOTION_API_KEY',
  'NOTION_DATABASE_ID',
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

export const config = Object.freeze({
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY,
  notionApiKey: process.env.NOTION_API_KEY,
  notionDatabaseId: process.env.NOTION_DATABASE_ID,
  port: parseInt(process.env.PORT || '3000', 10),
  calorieGoal: 1900,
  proteinTarget: 170,
  claudeModel: 'claude-haiku-4-5-20251001',
});

export function getTodayDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
}
