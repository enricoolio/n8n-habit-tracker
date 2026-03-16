import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

export async function analyzeFood(systemPrompt, context, userMessage) {
  const response = await client.messages.create({
    model: config.claudeModel,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `${context}\n\nNew meal to log:\n${userMessage}`,
      },
    ],
  });
  return response.content[0].text;
}

export async function analyzeFoodPhoto(systemPrompt, context, base64, mediaType, caption) {
  const response = await client.messages.create({
    model: config.claudeModel,
    max_tokens: 1024,
    system: systemPrompt,
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
            text: `${context}\n\nNew meal to log:\n${caption || 'See attached photo'}`,
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
