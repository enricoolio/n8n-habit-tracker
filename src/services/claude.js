import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const JSON_INSTRUCTION = `

IMPORTANT: After your Telegram reply, you MUST include a JSON block on its own line, fenced like this:

For a NEW meal:
\`\`\`json
{"is_food": true, "action": "log", "meal_name": "Chicken Breast + Rice", "calories": 450, "protein_g": 42, "carbs_g": 50, "fat_g": 8, "food_quality": "clean"}
\`\`\`

If the user is CORRECTING the most recently logged meal (e.g. "that's not correct", "actually it was 300g", "fix the skyr"):
\`\`\`json
{"is_food": true, "action": "correct_last", "meal_name": "Corrected Meal Name", "calories": 320, "protein_g": 39, "carbs_g": 30, "fat_g": 1, "food_quality": "clean"}
\`\`\`

If the message is NOT about food (question, chat, greeting, etc.):
\`\`\`json
{"is_food": false}
\`\`\`

Rules:
- food_quality must be one of: "clean", "decent", "processed", "junk"
- "action" must be "log" (new meal) or "correct_last" (fix the last logged meal)
- Always include the JSON block. No exceptions.`;

export async function analyzeFood(systemPrompt, context, userMessage) {
  const response = await client.messages.create({
    model: config.claudeModel,
    max_tokens: 1024,
    system: systemPrompt + JSON_INSTRUCTION,
    messages: [
      {
        role: 'user',
        content: `${context}\n\nUser message:\n${userMessage}`,
      },
    ],
  });
  return response.content[0].text;
}

export async function analyzeFoodPhoto(systemPrompt, context, base64, mediaType, caption) {
  const response = await client.messages.create({
    model: config.claudeModel,
    max_tokens: 1024,
    system: systemPrompt + JSON_INSTRUCTION,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          },
          {
            type: 'text',
            text: `${context}\n\nUser message:\n${caption || 'See attached photo'}`,
          },
        ],
      },
    ],
  });
  return response.content[0].text;
}

export async function generateWeeklyRecap(systemPrompt, statsPrompt) {
  const response = await client.messages.create({
    model: config.claudeModel,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: statsPrompt }],
  });
  return response.content[0].text;
}
