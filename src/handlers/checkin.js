import Anthropic from '@anthropic-ai/sdk';
import { config, getTodayDate } from '../config.js';
import { getTodayFoodLogs, getDailySummary, upsertDailySummary } from '../services/supabase.js';
import { upsertHabits } from '../services/notion.js';
import { setState, resetState } from '../services/state.js';

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

export async function sendEveningCheckin(bot) {
  const date = getTodayDate();
  const meals = await getTodayFoodLogs(date);
  const summary = await getDailySummary(date);

  let totalCal = 0, totalProtein = 0, totalCarbs = 0, totalFat = 0;
  for (const m of meals) {
    totalCal += m.calories || 0;
    totalProtein += parseFloat(m.protein_g) || 0;
    totalCarbs += parseFloat(m.carbs_g) || 0;
    totalFat += parseFloat(m.fat_g) || 0;
  }

  const dayOfWeek = new Date().getDay();
  const isTrainingDay = config.trainingDays.includes(dayOfWeek);
  const goal = isTrainingDay ? config.calorieGoalTraining : config.calorieGoalRest;
  const steps = summary?.steps || 0;

  const calStatus = totalCal > 0 && totalCal <= goal + 100 ? '\u2705' : '\u26a0\ufe0f';
  const proteinStatus = totalProtein >= 140 ? '\u2705' : '\u26a0\ufe0f';
  const stepStatus = steps >= 10000 ? '\u2705' : `${steps.toLocaleString()} so far`;

  const message = `Hey! Time for your evening check-in.

\ud83d\udcca Today's numbers:
${calStatus} Calories: ${totalCal} / ${goal} kcal
${proteinStatus} Protein: ${Math.round(totalProtein)} / 170g
\ud83d\udeb6 Steps: ${stepStatus}

Which of these did you do today?
\u2022 \ud83d\ude34 Sleep (8 hours last night?)
\u2022 \ud83d\udcaa Workout
\u2022 \ud83d\udcd6 Read/Learn 30 min
\u2022 \ud83d\udc8a Supplements
\u2022 \ud83d\udcc5 Calendar & Reflection
\u2022 \ud83d\ude4f Positivity/Gratefulness

Just reply with what you did. I'll log everything.`;

  await bot.api.sendMessage(config.telegramChatId, message);

  await setState(config.telegramChatId, 'awaiting_checkin', {
    totalCal,
    totalProtein: Math.round(totalProtein * 10) / 10,
    totalCarbs: Math.round(totalCarbs * 10) / 10,
    totalFat: Math.round(totalFat * 10) / 10,
    isTrainingDay,
    goal,
    mealCount: meals.length,
    steps,
  });
}

/*
  Parse habits via Claude instead of regex.

  Why: regex can't handle negation — "i didn't take supplements"
  matches /supplement/ → true. Claude understands natural language.

  Flow:
    user reply ("did workout, didn't sleep, no supps")
        │
        ▼
    Claude → {"sleep_8h": false, "workout_done": true, ...}
        │
        ├──▶ Auto-override eat_healthy (from food data)
        ├──▶ Auto-override steps_10k (from step count)
        ├──▶ Notion → update checkboxes
        ├──▶ Supabase → upsert daily_summaries
        └──▶ Telegram → score reply
*/
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

  try {
    const text = response.content[0].text.trim();
    const jsonStr = text.replace(/^```json\s*\n?/, '').replace(/\n?```\s*$/, '');
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error('Failed to parse habit JSON from Claude:', e.message);
    return {
      sleep_8h: false,
      workout_done: false,
      read_30min: false,
      supplements: false,
      positivity: false,
      calendar_reflection: false,
    };
  }
}

export async function handleCheckinReply(ctx, stateContext) {
  const reply = ctx.message.text || '';
  const date = getTodayDate();

  // Parse habits with Claude (understands negation + natural language)
  const habits = await parseHabitsWithClaude(reply);

  // Ensure auto-derived fields exist
  habits.eat_healthy = habits.eat_healthy || false;
  habits.steps_10k = habits.steps_10k || false;

  const { totalCal = 0, totalProtein = 0, totalCarbs = 0, totalFat = 0, goal = 1900, isTrainingDay = false, mealCount = 0, steps = 0 } = stateContext;

  // Auto-derive eat_healthy from food data
  if (totalCal > 0 && totalCal <= goal + 100 && totalProtein >= 140) {
    habits.eat_healthy = true;
  }

  // Auto-derive steps_10k from step count
  if (steps >= 10000) {
    habits.steps_10k = true;
  }

  const completed = Object.values(habits).filter(Boolean).length;
  const total = Object.keys(habits).length;
  const percentage = Math.round((completed / total) * 100);

  // Update Notion
  await upsertHabits(date, habits);

  // Save daily summary
  await upsertDailySummary({
    date,
    total_calories: totalCal,
    total_protein_g: totalProtein,
    total_carbs_g: totalCarbs,
    total_fat_g: totalFat,
    meal_count: mealCount,
    steps,
    calorie_goal: goal,
    is_training_day: isTrainingDay,
    calorie_balance: goal - totalCal,
    sleep_8h: habits.sleep_8h,
    eat_healthy: habits.eat_healthy,
    workout_done: habits.workout_done,
    steps_10k: habits.steps_10k,
    read_30min: habits.read_30min,
    supplements: habits.supplements,
    positivity: habits.positivity,
    calendar_reflection: habits.calendar_reflection,
    evening_notes: reply,
  });

  // Reset state
  await resetState(config.telegramChatId);

  // Build score message
  let verdict;
  if (percentage >= 75) verdict = 'Solid day. Keep it up. \ud83d\udcaa';
  else if (percentage >= 50) verdict = 'Decent effort. Room for improvement tomorrow.';
  else verdict = 'Rough day. Reset tomorrow - no excuses.';

  const habitLines = [
    `${habits.sleep_8h ? '\u2705' : '\u274c'} Sleep 8h`,
    `${habits.eat_healthy ? '\u2705' : '\u274c'} Eat healthy`,
    `${habits.workout_done ? '\u2705' : '\u274c'} Workout`,
    `${habits.steps_10k ? '\u2705' : '\u274c'} 10k Steps`,
    `${habits.read_30min ? '\u2705' : '\u274c'} Read 30 min`,
    `${habits.supplements ? '\u2705' : '\u274c'} Supplements`,
    `${habits.positivity ? '\u2705' : '\u274c'} Positivity`,
    `${habits.calendar_reflection ? '\u2705' : '\u274c'} Calendar & Reflection`,
  ];

  const scoreMessage = `\ud83d\udcca Daily Score: ${completed}/${total} (${percentage}%)

${habitLines.join('\n')}

${verdict}`;

  await ctx.reply(scoreMessage);
}
