import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const JSON_INSTRUCTION = `

IMPORTANT: After your Telegram reply, you MUST include a JSON block on its own line, fenced like this:
\`\`\`json
{"is_food": true, "meal_name": "Chicken Breast + Rice", "calories": 450, "protein_g": 42, "carbs_g": 50, "fat_g": 8, "food_quality": "clean"}
\`\`\`
- If the message is NOT about food (it's a question, correction, chat, greeting, etc.), return: \`\`\`json\n{"is_food": false}\n\`\`\`
- food_quality must be one of: "clean", "decent", "processed", "junk"
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
