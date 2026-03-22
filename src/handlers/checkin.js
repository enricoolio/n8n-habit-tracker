import Anthropic from '@anthropic-ai/sdk';
import { config, getTodayDate } from '../config.js';
import { insertFoodLog, upsertDailySummary, getDailySummary } from '../services/supabase.js';
import { upsertHabits } from '../services/notion.js';
import { extractDailySummary } from '../services/claude.js';
import { getConversationHistory, setState, resetState } from '../services/state.js';

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

/*
  End-of-day flow:

  10pm cron fires
        │
        ▼
  fetch full conversation history
        │
        ▼
  Claude extracts: meals, totals, habits confirmed, habits unknown
        │
        ▼
  send summary to Telegram:
    "📊 Daily Summary — 2026-03-22
     [meals + totals]
     ✅ Workout (confirmed)
     ❓ Sleep 8h? Read? Supplements?"
        │
        ▼
  set state → awaiting_summary
  store: { summary_date, extracted }
        │
        ▼
  user replies (possibly next morning)
        │
        ▼
  parse remaining habits via Claude
  merge with extracted
  write to Supabase + Notion
  send final score
  reset state
*/

export async function sendEveningCheckin(bot) {
  const date = getTodayDate();
  const chatId = String(config.telegramChatId);
  const history = await getConversationHistory(chatId);

  // If no conversation today, send a simple prompt
  if (history.length === 0) {
    await bot.api.sendMessage(config.telegramChatId,
      `Hey! You didn't log any food today (${date}). No worries — just tell me what you ate and I'll sort it out. Or reply with your habits for the day.`
    );
    await setState(chatId, 'awaiting_summary', { summary_date: date, extracted: null });
    return;
  }

  // Extract structured data from today's conversation
  let extracted;
  try {
    extracted = await extractDailySummary(history);
  } catch (e) {
    console.error('Failed to extract daily summary:', e.message);
    await bot.api.sendMessage(config.telegramChatId,
      `Had trouble reading today's conversation. Reply with a quick summary of what you ate and did today, and I'll log it.`
    );
    await setState(chatId, 'awaiting_summary', { summary_date: date, extracted: null });
    return;
  }

  // Build summary message
  const mealLines = (extracted.meals || []).map((m, i) =>
    `${i + 1}. ${m.meal_name}: ${m.calories} kcal | P:${m.protein_g}g`
  );

  const totals = extracted.totals || { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  const steps = (await getDailySummary(date))?.steps || 0;

  const habitLines = [];
  const confirmed = extracted.habits_confirmed || {};
  const unknown = extracted.habits_unknown || [];

  // Show confirmed habits
  if (confirmed.workout_done) habitLines.push('✅ Workout');
  if (confirmed.sleep_8h) habitLines.push('✅ Sleep 8h');
  if (confirmed.read_30min) habitLines.push('✅ Read 30 min');
  if (confirmed.supplements) habitLines.push('✅ Supplements');
  if (confirmed.positivity) habitLines.push('✅ Positivity');
  if (confirmed.calendar_reflection) habitLines.push('✅ Calendar & Reflection');

  // Auto-derive eat_healthy
  const eatHealthy = totals.calories > 0 && totals.calories <= 2000 && totals.protein_g >= 140;
  if (eatHealthy) habitLines.push('✅ Eat healthy (auto)');

  // Auto-derive steps
  const steps10k = steps >= 10000;
  if (steps10k) habitLines.push(`✅ 10k Steps (${steps.toLocaleString()})`);
  else if (steps > 0) habitLines.push(`🚶 Steps: ${steps.toLocaleString()}`);

  // Ask about unknown habits
  const habitQuestions = [];
  const HABIT_LABELS = {
    sleep_8h: '😴 Sleep 8h',
    workout_done: '💪 Workout',
    read_30min: '📖 Read 30 min',
    supplements: '💊 Supplements',
    positivity: '🙏 Positivity',
    calendar_reflection: '📅 Calendar & Reflection',
  };
  for (const habit of unknown) {
    if (!confirmed[habit] && HABIT_LABELS[habit]) {
      habitQuestions.push(HABIT_LABELS[habit]);
    }
  }

  const calStatus = totals.calories <= 2000 ? '✅' : '⚠️';
  const proteinStatus = totals.protein_g >= 140 ? '✅' : '⚠️';

  let message = `📊 **Daily Summary — ${date}**\n\n`;
  message += `**Meals:**\n${mealLines.length > 0 ? mealLines.join('\n') : 'No meals extracted'}\n\n`;
  message += `${calStatus} Calories: ${totals.calories} / 1900 kcal\n`;
  message += `${proteinStatus} Protein: ${totals.protein_g} / 170g\n`;
  message += `Carbs: ${totals.carbs_g}g | Fat: ${totals.fat_g}g\n`;

  if (habitLines.length > 0) {
    message += `\n**Confirmed:**\n${habitLines.join('\n')}\n`;
  }

  if (habitQuestions.length > 0) {
    message += `\n**Did you do any of these today?**\n${habitQuestions.join('\n')}\n`;
    message += `\nReply with what you did (or "none").`;
  } else {
    message += `\nAll habits accounted for! Reply "ok" to save.`;
  }

  await bot.api.sendMessage(config.telegramChatId, message);
  await setState(chatId, 'awaiting_summary', {
    summary_date: date,
    extracted,
    steps,
    eatHealthy,
    steps10k,
  });
}

export async function handleSummaryReply(ctx, stateContext) {
  const reply = ctx.message.text || '';
  const { summary_date, extracted, steps = 0, eatHealthy = false, steps10k = false } = stateContext;
  const date = summary_date || getTodayDate();

  // Start with habits from extraction
  let habits;
  if (extracted?.habits_confirmed) {
    habits = { ...extracted.habits_confirmed };
  } else {
    habits = {
      sleep_8h: false, workout_done: false, read_30min: false,
      supplements: false, positivity: false, calendar_reflection: false,
    };
  }

  // Parse the reply for any additional habits
  if (reply.trim().toLowerCase() !== 'ok' && reply.trim().toLowerCase() !== 'none') {
    try {
      const parsed = await parseHabitsWithClaude(reply);
      // Merge: only upgrade false → true, never downgrade true → false
      for (const [key, value] of Object.entries(parsed)) {
        if (value === true) habits[key] = true;
      }
    } catch (e) {
      console.error('Failed to parse habits from reply:', e.message);
    }
  }

  // Add auto-derived habits
  habits.eat_healthy = eatHealthy || false;
  habits.steps_10k = steps10k || false;

  // Calculate score
  const allHabits = { ...habits };
  const completed = Object.values(allHabits).filter(Boolean).length;
  const total = Object.keys(allHabits).length;
  const percentage = Math.round((completed / total) * 100);

  // Write to Supabase — food logs
  if (extracted?.meals?.length > 0) {
    for (const meal of extracted.meals) {
      await insertFoodLog({
        date,
        meal_name: meal.meal_name,
        meal_type: 'meal',
        calories: meal.calories || 0,
        protein_g: meal.protein_g || 0,
        carbs_g: meal.carbs_g || 0,
        fat_g: meal.fat_g || 0,
        food_quality: meal.food_quality || 'decent',
        ai_comment: '',
        input_type: 'conversation',
      });
    }
  }

  // Write to Supabase — daily summary
  const totals = extracted?.totals || { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  await upsertDailySummary({
    date,
    total_calories: totals.calories,
    total_protein_g: totals.protein_g,
    total_carbs_g: totals.carbs_g,
    total_fat_g: totals.fat_g,
    meal_count: extracted?.meals?.length || 0,
    steps,
    calorie_goal: config.calorieGoal,
    calorie_balance: config.calorieGoal - totals.calories,
    sleep_8h: allHabits.sleep_8h || false,
    eat_healthy: allHabits.eat_healthy || false,
    workout_done: allHabits.workout_done || false,
    steps_10k: allHabits.steps_10k || false,
    read_30min: allHabits.read_30min || false,
    supplements: allHabits.supplements || false,
    positivity: allHabits.positivity || false,
    calendar_reflection: allHabits.calendar_reflection || false,
    evening_notes: reply,
  });

  // Write to Notion
  await upsertHabits(date, allHabits);

  // Reset state
  await resetState(String(ctx.chat.id));

  // Build score message
  let verdict;
  if (percentage >= 75) verdict = 'Solid day. Keep it up. 💪';
  else if (percentage >= 50) verdict = 'Decent effort. Room for improvement tomorrow.';
  else verdict = 'Rough day. Reset tomorrow — no excuses.';

  const habitLines = [
    `${allHabits.sleep_8h ? '✅' : '❌'} Sleep 8h`,
    `${allHabits.eat_healthy ? '✅' : '❌'} Eat healthy`,
    `${allHabits.workout_done ? '✅' : '❌'} Workout`,
    `${allHabits.steps_10k ? '✅' : '❌'} 10k Steps`,
    `${allHabits.read_30min ? '✅' : '❌'} Read 30 min`,
    `${allHabits.supplements ? '✅' : '❌'} Supplements`,
    `${allHabits.positivity ? '✅' : '❌'} Positivity`,
    `${allHabits.calendar_reflection ? '✅' : '❌'} Calendar & Reflection`,
  ];

  const scoreMessage = `📊 Daily Score: ${completed}/${total} (${percentage}%)\n\n${habitLines.join('\n')}\n\n${verdict}\n\n✅ Saved to database for ${date}.`;
  await ctx.reply(scoreMessage);
}

async function parseHabitsWithClaude(reply) {
  const response = await anthropic.messages.create({
    model: config.claudeModel,
    max_tokens: 256,
    system: `You parse habit check-in messages. The user tells you what they did today.
Return ONLY a JSON object with these boolean fields — true if they DID it, false if they DIDN'T or didn't mention it.
Pay careful attention to negation: "didn't", "no", "not", "skipped" all mean FALSE.
If a habit is not mentioned at all, default to FALSE.

Fields:
- sleep_8h: Did they sleep 8 hours last night?
- workout_done: Did they work out today?
- read_30min: Did they read or learn for 30 minutes?
- supplements: Did they take their supplements?
- positivity: Did they practice positivity/gratefulness/mindfulness?
- calendar_reflection: Did they do calendar review & reflection?

Return ONLY valid JSON, no markdown fences, no explanation.`,
    messages: [{ role: 'user', content: reply }],
  });

  const text = response.content[0].text.trim();
  const jsonStr = text.replace(/^```json\s*\n?/, '').replace(/\n?```\s*$/, '');
  return JSON.parse(jsonStr);
}
