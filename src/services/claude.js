import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const JSON_INSTRUCTION = `

IMPORTANT: After your Telegram reply, you MUST include a JSON block on its own line, fenced like this:

For a NEW meal:
\`\`\`json
{"is_food": true, "action": "log", "meal_name": "Chicken Breast + Rice", "calories": 450, "protein_g": 42, "carbs_g": 50, "fat_g": 8, "food_quality": "clean"}
\`\`\`

To CORRECT a specific meal (use the [#N] index from the meal list in context):
\`\`\`json
{"is_food": true, "action": "correct", "correct_index": 2, "meal_name": "Arla Skyr Vanilla (450g)", "calories": 320, "protein_g": 39, "carbs_g": 34, "fat_g": 1, "food_quality": "clean"}
\`\`\`

To DELETE a specific meal:
\`\`\`json
{"is_food": true, "action": "delete", "correct_index": 3}
\`\`\`

If the message is NOT about food (question, chat, greeting, etc.):
\`\`\`json
{"is_food": false}
\`\`\`

Rules:
- food_quality must be one of: "clean", "decent", "processed", "junk"
- "action" must be "log", "correct", or "delete"
- For "correct" and "delete", you MUST include "correct_index" matching the [#N] number from the meal list
- Always include the JSON block. No exceptions.`;

// Prepend the running totals context to the current user content
function prependContext(contextHeader, userContent) {
  if (typeof userContent === 'string') {
    return `${contextHeader}\n\nUser message:\n${userContent}`;
  }
  // Array content (photo + text blocks) — prepend context to the text block
  return userContent.map((block) => {
    if (block.type === 'text') {
      return { ...block, text: `${contextHeader}\n\nUser message:\n${block.text}` };
    }
    return block;
  });
}

export async function analyzeFoodWithHistory(
  systemPrompt,
  contextHeader,
  history,
  currentUserContent
) {
  const messages = [];

  // Include prior conversation turns from today
  if (history.length > 0) {
    messages.push(...history);
  }

  // Add the current user message with running totals prepended
  const userContent = prependContext(contextHeader, currentUserContent);
  messages.push({ role: 'user', content: userContent });

  const response = await client.messages.create({
    model: config.claudeModel,
    max_tokens: 1024,
    system: systemPrompt + JSON_INSTRUCTION,
    messages,
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
