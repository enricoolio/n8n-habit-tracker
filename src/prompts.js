import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const promptsDir = join(__dirname, '..', 'prompts');

export const foodCoachSystemPrompt = readFileSync(
  join(promptsDir, 'food-coach-system-prompt.md'),
  'utf-8'
);

export const weeklyRecapSystemPrompt =
  "You are a blunt, no-BS fitness coach providing weekly recaps. Be specific and actionable. Reference actual numbers. Don't sugarcoat.";
