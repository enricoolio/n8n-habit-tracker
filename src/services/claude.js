import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

// Simple conversation — no JSON parsing, no structured output
export async function chat(systemPrompt, history, currentUserContent) {
  const messages = [...history, { role: 'user', content: currentUserContent }];

  const response = await client.messages.create({
    model: config.claudeModel,
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  return response.content[0].text;
}

// End-of-day extraction — reads full conversation, returns structured JSON
export async function extractDailySummary(conversationHistory) {
  const prompt = `Read the following conversation between a user and their fitness coach from today. Extract ALL the data into a JSON object.

CONVERSATION:
${conversationHistory.map((m) => `${m.role.toUpperCase()}: ${typeof m.content === 'string' ? m.content : '[media message]'}`).join('\n\n')}

Extract and return ONLY valid JSON (no markdown fences, no explanation):
{
  "meals": [
    {"meal_name": "...", "calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0, "food_quality": "clean|decent|processed|junk"}
  ],
  "totals": {"calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0},
  "habits_confirmed": {
    "workout_done": false,
    "sleep_8h": false,
    "read_30min": false,
    "supplements": false,
    "positivity": false,
    "calendar_reflection": false
  },
  "habits_unknown": ["sleep_8h", "read_30min"]
}

Rules:
- Include ONLY meals that were actually eaten (not corrections that were removed)
- If a meal was corrected (e.g. "actually 450g not 100g"), use the CORRECTED values
- If a meal was deleted/removed ("forget the beer"), do NOT include it
- For habits: mark true ONLY if the user explicitly confirmed doing it. If not mentioned, list in habits_unknown.
- food_quality: "clean" for whole/minimally processed, "decent" for normal, "processed" for packaged, "junk" for fast food/candy
- Use the FINAL corrected totals from the conversation`;

  const response = await client.messages.create({
    model: config.claudeModel,
    max_tokens: 1024,
    system: 'You extract structured data from conversations. Return ONLY valid JSON.',
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();
  // Strip markdown fences if Claude adds them despite instructions
  const cleaned = text.replace(/^```json\s*\n?/, '').replace(/\n?```\s*$/, '');
  return JSON.parse(cleaned);
}

// Smart nudge — asks Claude whether to nudge based on conversation context
export async function shouldNudge(conversationHistory, topic) {
  if (conversationHistory.length === 0 && topic === 'breakfast') {
    return true; // No conversation at all by 10am → always nudge
  }
  if (conversationHistory.length === 0) {
    return true; // No conversation at all → nudge
  }

  const convoText = conversationHistory
    .map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : '[media]'}`)
    .join('\n');

  const response = await client.messages.create({
    model: config.claudeModel,
    max_tokens: 50,
    system: 'Answer YES or NO only. No explanation.',
    messages: [{
      role: 'user',
      content: `Based on this conversation today, should I send a reminder about "${topic}"?

Say NO if:
- The user already mentioned ${topic} (e.g. logged a meal, said they worked out)
- The user said they're eating late, skipping, or otherwise indicated they don't want a reminder

Say YES if ${topic} hasn't been mentioned at all.

Conversation:
${convoText}`,
    }],
  });

  return response.content[0].text.trim().toUpperCase().startsWith('YES');
}

// Weekly recap — unchanged
export async function generateWeeklyRecap(systemPrompt, statsPrompt) {
  const response = await client.messages.create({
    model: config.claudeModel,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: statsPrompt }],
  });
  return response.content[0].text;
}
