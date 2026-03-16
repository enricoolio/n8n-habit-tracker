import { config, getTodayDate } from '../config.js';
import { foodCoachSystemPrompt } from '../prompts.js';
import { getTodayFoodLogs, insertFoodLog } from '../services/supabase.js';
import { analyzeFood, analyzeFoodPhoto } from '../services/claude.js';
import { transcribeVoice } from '../services/whisper.js';

function buildContext(meals, isTrainingDay, calorieGoal) {
  const running = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  const mealList = [];

  for (const meal of meals) {
    running.calories += meal.calories || 0;
    running.protein += parseFloat(meal.protein_g) || 0;
    running.carbs += parseFloat(meal.carbs_g) || 0;
    running.fat += parseFloat(meal.fat_g) || 0;
    running.fiber += parseFloat(meal.fiber_g) || 0;
    mealList.push(
      `- ${meal.meal_name}: ${meal.calories} kcal, P:${meal.protein_g}g C:${meal.carbs_g}g F:${meal.fat_g}g`
    );
  }

  const date = getTodayDate();
  return `\n## Today's Date: ${date}\n## Training Day: ${isTrainingDay ? 'YES (2100 kcal goal)' : 'NO (1900 kcal goal)'}\n## Meals so far today (${meals.length} meals):\n${mealList.length > 0 ? mealList.join('\n') : 'No meals logged yet'}\n\n## Running Total:\nCalories: ${running.calories} / ${calorieGoal} kcal\nProtein: ${running.protein.toFixed(1)} / ${config.proteinTarget} g\nCarbs: ${running.carbs.toFixed(1)} g\nFat: ${running.fat.toFixed(1)} g\nFiber: ${running.fiber.toFixed(1)} g\nRemaining: ${calorieGoal - running.calories} kcal | ${(config.proteinTarget - running.protein).toFixed(1)}g protein\n`;
}

function parseClaudeResponse(response) {
  // Extract JSON block from Claude's response
  const jsonMatch = response.match(/```json\s*\n([\s\S]*?)\n```/);
  if (!jsonMatch) {
    return { is_food: false };
  }

  try {
    const data = JSON.parse(jsonMatch[1]);
    if (!data.is_food) {
      return { is_food: false };
    }

    // Meal type from current hour in Berlin
    const hour = parseInt(
      new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false })
    );
    let mealType = 'snack';
    if (hour < 11) mealType = 'breakfast';
    else if (hour < 14) mealType = 'lunch';
    else if (hour >= 17) mealType = 'dinner';

    return {
      is_food: true,
      meal_name: data.meal_name || 'Meal',
      meal_type: mealType,
      calories: parseInt(data.calories) || 0,
      protein_g: parseFloat(data.protein_g) || 0,
      carbs_g: parseFloat(data.carbs_g) || 0,
      fat_g: parseFloat(data.fat_g) || 0,
      fiber_g: data.fiber_g ? parseFloat(data.fiber_g) : null,
      sodium_mg: data.sodium_mg ? parseFloat(data.sodium_mg) : null,
      food_quality: data.food_quality || 'decent',
      ai_comment: data.ai_comment || '',
    };
  } catch (e) {
    console.error('Failed to parse Claude JSON:', e.message);
    return { is_food: false };
  }
}

function stripJsonBlock(response) {
  // Remove the JSON block so the user only sees the Telegram reply
  return response.replace(/\n?```json\s*\n[\s\S]*?\n```\s*$/, '').trim();
}

export async function handleFoodMessage(ctx) {
  const date = getTodayDate();
  const dayOfWeek = new Date().getDay();
  const isTrainingDay = config.trainingDays.includes(dayOfWeek);
  const calorieGoal = isTrainingDay ? config.calorieGoalTraining : config.calorieGoalRest;

  // Fetch today's meals for context
  const todayMeals = await getTodayFoodLogs(date);
  const context = buildContext(todayMeals, isTrainingDay, calorieGoal);

  let claudeResponse;
  let inputType = 'text';

  if (ctx.message.photo) {
    // Photo: download and send to Claude vision
    inputType = 'photo';
    const photos = ctx.message.photo;
    const largestPhoto = photos[photos.length - 1]; // Telegram sends multiple sizes
    const file = await ctx.api.getFile(largestPhoto.file_id);
    const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;

    const res = await fetch(url);
    const buffer = Buffer.from(await res.arrayBuffer());
    const base64 = buffer.toString('base64');

    let mediaType = 'image/jpeg';
    if (file.file_path.endsWith('.png')) mediaType = 'image/png';
    else if (file.file_path.endsWith('.webp')) mediaType = 'image/webp';

    const caption = ctx.message.caption || 'See attached photo';
    claudeResponse = await analyzeFoodPhoto(foodCoachSystemPrompt, context, base64, mediaType, caption);
  } else if (ctx.message.voice) {
    // Voice: download, transcribe with Whisper, then Claude
    inputType = 'voice';
    const file = await ctx.api.getFile(ctx.message.voice.file_id);
    const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;

    const res = await fetch(url);
    const buffer = Buffer.from(await res.arrayBuffer());
    const transcription = await transcribeVoice(buffer, file.file_path.split('/').pop());

    claudeResponse = await analyzeFood(foodCoachSystemPrompt, context, transcription);
  } else {
    // Text
    claudeResponse = await analyzeFood(foodCoachSystemPrompt, context, ctx.message.text);
  }

  // Parse structured data and send clean reply
  const parsed = parseClaudeResponse(claudeResponse);
  const telegramReply = stripJsonBlock(claudeResponse);

  // Only save to DB if Claude identified this as actual food
  if (parsed.is_food) {
    await insertFoodLog({
      date,
      meal_name: parsed.meal_name,
      meal_type: parsed.meal_type,
      calories: parsed.calories,
      protein_g: parsed.protein_g,
      carbs_g: parsed.carbs_g,
      fat_g: parsed.fat_g,
      fiber_g: parsed.fiber_g,
      sodium_mg: parsed.sodium_mg,
      food_quality: parsed.food_quality,
      ai_comment: parsed.ai_comment,
      input_type: inputType,
      is_training_day: isTrainingDay,
    });
  }

  await ctx.reply(telegramReply);
}
