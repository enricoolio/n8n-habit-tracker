import { Router } from 'express';
import { upsertDailySummary } from '../services/supabase.js';

export const stepsRouter = Router();

stepsRouter.post('/steps', async (req, res) => {
  try {
    const { steps, date } = req.body;

    if (steps == null) {
      return res.status(400).json({ error: 'Missing "steps" field' });
    }

    const stepCount = parseInt(steps, 10);
    const dateStr = date || new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
    const steps10k = stepCount >= 10000;

    await upsertDailySummary({
      date: dateStr,
      steps: stepCount,
      steps_10k: steps10k,
    });

    res.json({ status: 'ok', steps: stepCount, hit_10k: steps10k });
  } catch (err) {
    console.error('Steps webhook error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
