// Load env BEFORE any other imports (ESM hoists imports, so we use dynamic import)
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const { config, getTodayDate } = await import('./src/config.js');
const { analyzeFoodWithHistory } = await import('./src/services/claude.js');
const { foodCoachSystemPrompt } = await import('./src/prompts.js');

const PASS = '✅';
const FAIL = '❌';
let passed = 0;
let failed = 0;

function assert(condition, testName, detail = '') {
  if (condition) {
    console.log(`${PASS} ${testName}`);
    passed++;
  } else {
    console.log(`${FAIL} ${testName}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

function parseJson(response) {
  const match = response.match(/```json\s*\n([\s\S]*?)\n```/);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

// Build a fake context like the bot does
function buildContext(meals) {
  const goal = 1900;
  const running = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  const mealList = meals.map((m, i) => {
    running.calories += m.calories;
    running.protein += m.protein_g;
    running.carbs += m.carbs_g;
    running.fat += m.fat_g;
    return `- [#${i + 1}] ${m.meal_name}: ${m.calories} kcal, P:${m.protein_g}g C:${m.carbs_g}g F:${m.fat_g}g`;
  });
  return `
## Today's Date: ${getTodayDate()}
## Daily Goal: ${goal} kcal
## Meals so far today (${meals.length} meals):
${mealList.length > 0 ? mealList.join('\n') : 'No meals logged yet'}

## Running Total:
Calories: ${running.calories} / ${goal} kcal
Protein: ${running.protein.toFixed(1)} / 170 g
Carbs: ${running.carbs.toFixed(1)} g
Fat: ${running.fat.toFixed(1)} g
Remaining: ${goal - running.calories} kcal | ${(170 - running.protein).toFixed(1)}g protein
`;
}

async function callClaude(context, history, userMessage) {
  return analyzeFoodWithHistory(foodCoachSystemPrompt, context, history, userMessage);
}

async function runTests() {
  console.log('\n🧪 Running edge case tests against live Claude API...\n');
  console.log('─'.repeat(60));

  // ──────────────────────────────────────────────────────
  // TEST 1: Simple meal logging
  // ──────────────────────────────────────────────────────
  console.log('\n📋 TEST 1: Simple meal — "chicken breast 200g with rice"');
  const ctx1 = buildContext([]);
  const r1 = await callClaude(ctx1, [], 'chicken breast 200g with rice');
  const j1 = parseJson(r1);
  assert(j1 !== null, 'Returns valid JSON block');
  assert(j1?.is_food === true, 'Identified as food');
  assert(j1?.action === 'log', 'Action is "log"');
  assert(j1?.calories > 300 && j1?.calories < 600, `Calories reasonable (${j1?.calories})`);
  assert(j1?.protein_g > 30, `Protein reasonable (${j1?.protein_g}g)`);
  assert(j1?.meal_name && j1.meal_name.length > 3, `Has meal name: "${j1?.meal_name}"`);

  // ──────────────────────────────────────────────────────
  // TEST 2: Non-food message should NOT be logged
  // ──────────────────────────────────────────────────────
  console.log('\n📋 TEST 2: Non-food message — "how much protein should I eat today?"');
  const r2 = await callClaude(ctx1, [], 'how much protein should I eat today?');
  const j2 = parseJson(r2);
  assert(j2 !== null, 'Returns valid JSON block');
  assert(j2?.is_food === false, 'Identified as NOT food');

  // ──────────────────────────────────────────────────────
  // TEST 3: "restart day" / "clear" → NOT food, no fake reset
  // ──────────────────────────────────────────────────────
  console.log('\n📋 TEST 3: "restart this day" — should NOT claim to reset');
  const mealsForCtx3 = [{ meal_name: 'Coffee', calories: 80, protein_g: 3, carbs_g: 6, fat_g: 4 }];
  const ctx3 = buildContext(mealsForCtx3);
  const r3 = await callClaude(ctx3, [], 'restart this day');
  const j3 = parseJson(r3);
  assert(j3?.is_food === false || j3?.action === 'delete', 'Did NOT log as food');
  assert(!r3.includes('All meals cleared') && !r3.includes('Day reset'), 'Did NOT claim to reset/clear');

  // ──────────────────────────────────────────────────────
  // TEST 4: Correction targets correct meal by index
  // ──────────────────────────────────────────────────────
  console.log('\n📋 TEST 4: Correction — "fix the skyr, it was 450g not 100g"');
  const mealsForCtx4 = [
    { meal_name: 'Coffee', calories: 80, protein_g: 3, carbs_g: 6, fat_g: 4 },
    { meal_name: 'Arla Skyr Vanilla', calories: 135, protein_g: 20, carbs_g: 11, fat_g: 0.3 },
    { meal_name: 'Boiled Egg', calories: 78, protein_g: 6, carbs_g: 1, fat_g: 5 },
  ];
  const ctx4 = buildContext(mealsForCtx4);
  const r4 = await callClaude(ctx4, [], 'fix the skyr, it was 450g not 100g. its 71 kcal per 100g and 8.6g protein per 100g');
  const j4 = parseJson(r4);
  assert(j4?.action === 'correct', `Action is "correct" (got "${j4?.action}")`);
  assert(j4?.correct_index === 2, `Targets index 2 / skyr (got ${j4?.correct_index})`);
  assert(j4?.calories > 280 && j4?.calories < 360, `Corrected calories ~320 (got ${j4?.calories})`);
  assert(j4?.protein_g > 35 && j4?.protein_g < 45, `Corrected protein ~39g (got ${j4?.protein_g})`);

  // ──────────────────────────────────────────────────────
  // TEST 5: Delete specific meal
  // ──────────────────────────────────────────────────────
  console.log('\n📋 TEST 5: Delete — "delete the boiled egg"');
  const r5 = await callClaude(ctx4, [], 'delete the boiled egg');
  const j5 = parseJson(r5);
  assert(j5?.action === 'delete', `Action is "delete" (got "${j5?.action}")`);
  assert(j5?.correct_index === 3, `Targets index 3 / egg (got ${j5?.correct_index})`);

  // ──────────────────────────────────────────────────────
  // TEST 6: Negation in correction — "2 eggs instead of 1"
  // ──────────────────────────────────────────────────────
  console.log('\n📋 TEST 6: Quantity correction — "it was 2 eggs not 1"');
  const r6 = await callClaude(ctx4, [], 'it was 2 boiled eggs, not 1');
  const j6 = parseJson(r6);
  assert(j6?.action === 'correct', `Action is "correct" (got "${j6?.action}")`);
  assert(j6?.correct_index === 3, `Targets index 3 / egg (got ${j6?.correct_index})`);
  assert(j6?.calories > 140 && j6?.calories < 170, `2 eggs ~155 kcal (got ${j6?.calories})`);

  // ──────────────────────────────────────────────────────
  // TEST 7: Conversation history — "that's not right" after a meal
  // ──────────────────────────────────────────────────────
  console.log('\n📋 TEST 7: Conversation history — correction via "that\'s not right"');
  const history7 = [
    { role: 'user', content: '450g vanilla skyr' },
    { role: 'assistant', content: '🍨 Arla Skyr Vanilla (450g)\nCalories: 135 kcal\nP: 20g | C: 11g | F: 0.3g\n\n--- Daily Total ---\nCalories: 135 / 1900 kcal' },
  ];
  const mealsForCtx7 = [
    { meal_name: 'Arla Skyr Vanilla', calories: 135, protein_g: 20, carbs_g: 11, fat_g: 0.3 },
  ];
  const ctx7 = buildContext(mealsForCtx7);
  const r7 = await callClaude(ctx7, history7, "that's not right, it should be 320 kcal for 450g");
  const j7 = parseJson(r7);
  assert(j7?.action === 'correct', `Action is "correct" (got "${j7?.action}")`);
  assert(j7?.correct_index === 1, `Targets index 1 / skyr (got ${j7?.correct_index})`);
  assert(j7?.calories >= 300 && j7?.calories <= 340, `Corrected to ~320 kcal (got ${j7?.calories})`);

  // ──────────────────────────────────────────────────────
  // TEST 8: Training day detection
  // ──────────────────────────────────────────────────────
  console.log('\n📋 TEST 8: Always shows 1900 kcal goal (flat target)');
  const ctx8 = buildContext([]);
  const r8 = await callClaude(ctx8, [], 'protein shake with banana');
  assert(r8.includes('1900'), 'Response references 1900 kcal goal');

  // ──────────────────────────────────────────────────────
  // TEST 9: German text should still work
  // ──────────────────────────────────────────────────────
  console.log('\n📋 TEST 9: German food description — "Hähnchenbrust mit Reis"');
  const r9 = await callClaude(ctx1, [], 'Hähnchenbrust 200g mit Reis');
  const j9 = parseJson(r9);
  assert(j9?.is_food === true, 'German food identified correctly');
  assert(j9?.protein_g > 30, `Protein reasonable for chicken+rice (${j9?.protein_g}g)`);

  // ──────────────────────────────────────────────────────
  // TEST 10: Greetings / random chat → is_food false
  // ──────────────────────────────────────────────────────
  console.log('\n📋 TEST 10: Random chat — "hey, good morning"');
  const r10 = await callClaude(ctx1, [], 'hey, good morning');
  const j10 = parseJson(r10);
  assert(j10?.is_food === false, 'Greeting identified as NOT food');

  // ──────────────────────────────────────────────────────
  // RESULTS
  // ──────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log(`\n🏁 Results: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
  if (failed === 0) {
    console.log('🎉 All tests passed!\n');
  } else {
    console.log('⚠️  Some tests failed — review above.\n');
  }
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
