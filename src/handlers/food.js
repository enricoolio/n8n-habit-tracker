import { config } from '../config.js';
import { foodCoachSystemPrompt } from '../prompts.js';
import { chat } from '../services/claude.js';
import { transcribeVoice } from '../services/whisper.js';
import { getConversationHistory, appendToHistory } from '../services/state.js';

/*
  Conversation handler — replaces the old per-message parsing architecture.

  Flow:
    user message (text / photo / voice)
          │
          ▼
    fetch conversation history (from JSONB)
          │
          ▼
    send to Claude: system prompt + full history + current message
          │
          ▼
    Claude responds naturally (macros, totals, coaching)
          │
          ▼
    append user + assistant to history
          │
          ▼
    reply on Telegram

  NO JSON PARSING. NO DB WRITES. Just conversation.
  Data extraction happens once at end of day (see checkin.js).
*/

export async function handleMessage(ctx) {
  const chatId = String(ctx.chat.id);

  // Fetch today's conversation history
  const history = await getConversationHistory(chatId);

  // Build current user content based on message type
  let currentUserContent;

  if (ctx.message.photo) {
    const photos = ctx.message.photo;
    const largestPhoto = photos[photos.length - 1];
    const file = await ctx.api.getFile(largestPhoto.file_id);
    const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;

    const res = await fetch(url);
    const buffer = Buffer.from(await res.arrayBuffer());
    const base64 = buffer.toString('base64');

    let mediaType = 'image/jpeg';
    if (file.file_path.endsWith('.png')) mediaType = 'image/png';
    else if (file.file_path.endsWith('.webp')) mediaType = 'image/webp';

    const caption = ctx.message.caption || 'See attached photo';
    currentUserContent = [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
      { type: 'text', text: caption },
    ];
  } else if (ctx.message.voice) {
    const file = await ctx.api.getFile(ctx.message.voice.file_id);
    const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;

    const res = await fetch(url);
    const buffer = Buffer.from(await res.arrayBuffer());
    const transcription = await transcribeVoice(buffer, file.file_path.split('/').pop());
    currentUserContent = transcription;
  } else {
    currentUserContent = ctx.message.text;
  }

  // Call Claude with full conversation history
  const response = await chat(foodCoachSystemPrompt, history, currentUserContent);

  // Save to conversation history (photos replaced with text summaries)
  await appendToHistory(chatId, currentUserContent, response);

  await ctx.reply(response);
}
