import { Bot } from 'grammy';
import { config } from './config.js';
import { getState } from './services/state.js';
import { handleMessage } from './handlers/food.js';
import { handleSummaryReply, sendEveningCheckin } from './handlers/checkin.js';

export const bot = new Bot(config.telegramBotToken);

// Store reference for /recap command
let sendWeeklyRecapFn = null;
export function setWeeklyRecapFn(fn) {
  sendWeeklyRecapFn = fn;
}

bot.on('message', async (ctx) => {
  // Only respond to configured chat
  if (String(ctx.chat.id) !== String(config.telegramChatId)) return;

  try {
    const { state, context } = await getState(String(ctx.chat.id));
    const text = ctx.message.text || '';

    // Handle commands
    if (text === '/help') {
      return await ctx.reply(
        '🤖 **Coach Krupt**\n\n' +
        'Just send me what you ate — text, photo, or voice.\n' +
        'I track your macros throughout the day.\n\n' +
        '**Commands:**\n' +
        '/help — this message\n' +
        '/recap — trigger weekly recap\n' +
        '/summary — trigger end-of-day summary now\n\n' +
        'At 10pm I\'ll send your daily summary and ask about habits.'
      );
    }

    if (text === '/recap' && sendWeeklyRecapFn) {
      await ctx.reply('Generating weekly recap...');
      await sendWeeklyRecapFn(bot);
      return;
    }

    if (text === '/summary') {
      await ctx.reply('Generating daily summary...');
      await sendEveningCheckin(bot);
      return;
    }

    // If awaiting summary reply → handle it
    if (state === 'awaiting_summary') {
      return await handleSummaryReply(ctx, context);
    }

    // Everything else → conversation with coach
    if (ctx.message.photo || ctx.message.voice || ctx.message.text) {
      return await handleMessage(ctx);
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
