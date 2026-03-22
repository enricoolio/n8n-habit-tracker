import cron from 'node-cron';
import { config } from './config.js';
import { weeklyRecapSystemPrompt } from './prompts.js';
import { sendEveningCheckin } from './handlers/checkin.js';
import { getDateRangeFoodLogs, getDateRangeSummaries, insertWeeklyRecap } from './services/supabase.js';
import { generateWeeklyRecap, shouldNudge } from './services/claude.js';
import { getConversationHistory, appendToHistory } from './services/state.js';

/*
  Cron schedule (Europe/Berlin):

  10:00 AM  — nudge: "Log breakfast?"     (if not mentioned)
   2:00 PM  — nudge: "Had lunch?"          (if not mentioned)
   6:00 PM  — nudge: "Did you work out?"   (if not mentioned)
  10:00 PM  — end-of-day summary + habit check-in
  Sunday 8PM — weekly recap
*/

const NUDGE_MESSAGES = {
  breakfast: "Hey — did you have breakfast? Log it when you get a chance.",
  lunch: "Lunch time — what did you eat? Or are you eating later?",
  workout: "Did you work out today? Let me know.",
};

async function sendNudge(bot, topic) {
  const chatId = String(config.telegramChatId);
  try {
    const history = await getConversationHistory(chatId);
    const nudge = await shouldNudge(history, topic);

    if (nudge) {
      const message = NUDGE_MESSAGES[topic];
      await bot.api.sendMessage(config.telegramChatId, message);
      // Add nudge to conversation history so Claude knows it was sent
      await appendToHistory(chatId, `[System nudge about ${topic}]`, message);
      console.log(`Nudge sent: ${topic}`);
    } else {
      console.log(`Nudge skipped: ${topic} (already mentioned)`);
    }
  } catch (err) {
    console.error(`Nudge error (${topic}):`, err.message);
  }
}

export async function sendWeeklyRecap(bot) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
  const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)
    .toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });

  const summaries = await getDateRangeSummaries(sixDaysAgo, today);
  const foods = await getDateRangeFoodLogs(sixDaysAgo, today);

  const days = summaries.length || 1;

  const totalCal = foods.reduce((s, f) => s + (f.calories || 0), 0);
  const totalProtein = foods.reduce((s, f) => s + (parseFloat(f.protein_g) || 0), 0);
  const totalCarbs = foods.reduce((s, f) => s + (parseFloat(f.carbs_g) || 0), 0);
  const totalFat = foods.reduce((s, f) => s + (parseFloat(f.fat_g) || 0), 0);
  const totalFiber = foods.reduce((s, f) => s + (parseFloat(f.fiber_g) || 0), 0);

  const habits = {
    sleep: summaries.filter((s) => s.sleep_8h).length,
    eat: summaries.filter((s) => s.eat_healthy).length,
    workout: summaries.filter((s) => s.workout_done).length,
    steps: summaries.filter((s) => s.steps_10k).length,
    read: summaries.filter((s) => s.read_30min).length,
    supplements: summaries.filter((s) => s.supplements).length,
    positivity: summaries.filter((s) => s.positivity).length,
    reflection: summaries.filter((s) => s.calendar_reflection).length,
  };

  const totalSteps = summaries.reduce((s, d) => s + (d.steps || 0), 0);
  const avgSteps = Math.round(totalSteps / days);
  const daysWithTenKSteps = summaries.filter((s) => s.steps_10k).length;

  const dailyPercentages = summaries.map((s) => {
    const checked = [s.sleep_8h, s.eat_healthy, s.workout_done, s.steps_10k, s.read_30min, s.supplements, s.positivity, s.calendar_reflection].filter(Boolean).length;
    return (checked / 8) * 100;
  });
  const avgHabitPercentage = dailyPercentages.length > 0
    ? (dailyPercentages.reduce((a, b) => a + b, 0) / dailyPercentages.length).toFixed(2)
    : '0.00';

  const qualityCounts = { clean: 0, decent: 0, processed: 0, junk: 0 };
  for (const f of foods) {
    if (f.food_quality && qualityCounts[f.food_quality] !== undefined) {
      qualityCounts[f.food_quality]++;
    }
  }

  let bestDay = null, worstDay = null, bestPct = -1, worstPct = 101;
  for (const s of summaries) {
    const checked = [s.sleep_8h, s.eat_healthy, s.workout_done, s.steps_10k, s.read_30min, s.supplements, s.positivity, s.calendar_reflection].filter(Boolean).length;
    const pct = (checked / 8) * 100;
    if (pct > bestPct) { bestPct = pct; bestDay = s.date; }
    if (pct < worstPct) { worstPct = pct; worstDay = s.date; }
  }

  const prompt = `Generate a weekly fitness & nutrition recap based on this data. Be blunt and actionable.

WEEK DATA (${days} days tracked):
- Avg daily calories: ${Math.round(totalCal / days)} kcal (goal: 1900)
- Avg daily protein: ${(totalProtein / days).toFixed(1)}g (goal: 170g)
- Avg daily carbs: ${(totalCarbs / days).toFixed(1)}g
- Avg daily fat: ${(totalFat / days).toFixed(1)}g
- Avg daily fiber: ${(totalFiber / days).toFixed(1)}g
- Total meals: ${foods.length}
- Food quality: ${qualityCounts.clean} clean, ${qualityCounts.decent} decent, ${qualityCounts.processed} processed, ${qualityCounts.junk} junk

ACTIVITY:
- Total steps: ${totalSteps} (avg ${avgSteps}/day)
- Days with 10k+ steps: ${daysWithTenKSteps}/${days}
- Workouts: ${habits.workout}/week

HABIT COMPLETION (out of ${days} days):
- Sleep 8h: ${habits.sleep}/${days}
- Eat healthy: ${habits.eat}/${days}
- Workout: ${habits.workout}/${days}
- 10k steps: ${habits.steps}/${days}
- Read 30min: ${habits.read}/${days}
- Supplements: ${habits.supplements}/${days}
- Positivity: ${habits.positivity}/${days}
- Calendar/Reflection: ${habits.reflection}/${days}
- Average daily habit score: ${avgHabitPercentage}%

Best day: ${bestDay} (${bestPct}%) | Worst day: ${worstDay} (${worstPct}%)

Provide:
1. One-paragraph blunt assessment
2. Top 3 specific improvements for next week
3. One thing done well to keep doing

Keep it under 200 words. Telegram format.`;

  const recapText = await generateWeeklyRecap(weeklyRecapSystemPrompt, prompt);

  await insertWeeklyRecap({
    week_start: sixDaysAgo,
    week_end: today,
    avg_daily_calories: Math.round(totalCal / days),
    avg_daily_protein_g: parseFloat((totalProtein / days).toFixed(1)),
    avg_daily_carbs_g: parseFloat((totalCarbs / days).toFixed(1)),
    avg_daily_fat_g: parseFloat((totalFat / days).toFixed(1)),
    total_week_calories: totalCal,
    total_steps: totalSteps,
    avg_daily_steps: avgSteps,
    workouts_completed: habits.workout,
    days_with_10k_steps: daysWithTenKSteps,
    sleep_completion: habits.sleep,
    eat_healthy_completion: habits.eat,
    supplement_completion: habits.supplements,
    read_completion: habits.read,
    positivity_completion: habits.positivity,
    workout_completion: habits.workout,
    steps_completion: habits.steps,
    avg_habit_percentage: parseFloat(avgHabitPercentage),
    best_day: bestDay,
    worst_day: worstDay,
    ai_weekly_summary: recapText,
  });

  await bot.api.sendMessage(config.telegramChatId, `📊 WEEKLY RECAP\n\n${recapText}\n\n---\n\n⚖️ **Weigh-in reminder:** Step on the scale tomorrow morning (fasted) and send me your weight, e.g. "92.4 kg".`);
}

export function startCronJobs(bot) {
  // Smart nudges
  cron.schedule('0 10 * * *', () => sendNudge(bot, 'breakfast'), { timezone: 'Europe/Berlin' });
  cron.schedule('0 14 * * *', () => sendNudge(bot, 'lunch'), { timezone: 'Europe/Berlin' });
  cron.schedule('0 18 * * *', () => sendNudge(bot, 'workout'), { timezone: 'Europe/Berlin' });

  // Daily 10pm CET — end-of-day summary
  cron.schedule('0 22 * * *', () => {
    console.log('Cron: sending evening summary');
    sendEveningCheckin(bot).catch((err) => console.error('Evening summary error:', err));
  }, { timezone: 'Europe/Berlin' });

  // Sunday 8pm CET — weekly recap
  cron.schedule('0 20 * * 0', () => {
    console.log('Cron: sending weekly recap');
    sendWeeklyRecap(bot).catch((err) => console.error('Weekly recap error:', err));
  }, { timezone: 'Europe/Berlin' });

  console.log('Cron jobs scheduled (Europe/Berlin): nudges 10am/2pm/6pm, summary 10pm, recap Sun 8pm');
}
