import { Bot } from 'grammy';
import { config } from './config.js';
import { getState } from './services/state.js';
import { handleFoodMessage } from './handlers/food.js';
import { handleCheckinReply } from './handlers/checkin.js';
import { handleCommand } from './handlers/commands.js';

export const bot = new Bot(config.telegramBotToken);

// Lazy-loaded to avoid circular dependency
let sendWeeklyRecapFn = null;
export function setWeeklyRecapFn(fn) {
  sendWeeklyRecapFn = fn;
}

bot.on('message', async (ctx) => {
  // Only respond to configured chat
  if (String(ctx.chat.id) !== String(config.telegramChatId)) return;

  try {
    // Check conversation state
    const { state, context } = await getState(String(ctx.chat.id));

    if (state === 'awaiting_checkin') {
      return await handleCheckinReply(ctx, context);
    }

    // Commands
    if (ctx.message.text?.startsWith('/')) {
      const result = await handleCommand(ctx);
      if (result === 'recap' && sendWeeklyRecapFn) {
        await sendWeeklyRecapFn(bot);
      }
      return;
    }

    // Food logging: photo, voice, or text
    if (ctx.message.photo || ctx.message.voice || ctx.message.text) {
      return await handleFoodMessage(ctx);
    }
  } catch (err) {
    console.error('Bot error:', err);
    try {
      await ctx.reply('Something went wrong. Try again.');
    } catch (_) {
      // ignore reply failure
    }
  }
});
