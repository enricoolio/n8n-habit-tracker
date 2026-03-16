import { config, getTodayDate } from '../config.js';
import { getTodayFoodLogs } from '../services/supabase.js';

export async function handleCommand(ctx) {
  const text = (ctx.message.text || '').trim();
  const cmd = text.split(' ')[0].toLowerCase();

  switch (cmd) {
    case '/help':
      await ctx.reply(
        `Available commands:
/help - Show this message
/totals - Today's food totals
/training - Check if today is a training day
/recap - Trigger weekly recap

Or just send me:
- Text describing what you ate
- A photo of your food
- A voice note about your meal`
      );
      break;

    case '/totals': {
      const date = getTodayDate();
      const meals = await getTodayFoodLogs(date);

      if (meals.length === 0) {
        await ctx.reply('No food logged today yet.');
        return;
      }

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

      await ctx.reply(
        `\ud83d\udcca Today's Totals (${meals.length} meals)

Calories: ${totalCal} / ${goal} kcal
Protein: ${totalProtein.toFixed(1)} / ${config.proteinTarget}g
Carbs: ${totalCarbs.toFixed(1)}g
Fat: ${totalFat.toFixed(1)}g

Remaining: ${goal - totalCal} kcal | ${(config.proteinTarget - totalProtein).toFixed(1)}g protein`
      );
      break;
    }

    case '/training': {
      const dayOfWeek = new Date().getDay();
      const isTrainingDay = config.trainingDays.includes(dayOfWeek);
      const goal = isTrainingDay ? config.calorieGoalTraining : config.calorieGoalRest;
      await ctx.reply(
        isTrainingDay
          ? `\ud83c\udfcb\ufe0f Today is a TRAINING day. Goal: ${goal} kcal.`
          : `\ud83d\udecb\ufe0f Today is a REST day. Goal: ${goal} kcal.`
      );
      break;
    }

    case '/recap':
      // Signal that we want a recap — handled by the caller
      await ctx.reply('Generating weekly recap... give me a moment.');
      // We return 'recap' so the bot router can trigger it
      return 'recap';

    default:
      await ctx.reply(`Unknown command: ${cmd}\nTry /help for available commands.`);
  }
}
