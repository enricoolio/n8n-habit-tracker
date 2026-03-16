import dotenv from 'dotenv';
dotenv.config({ override: true });

const { bot, setWeeklyRecapFn } = await import('./bot.js');
const { startCronJobs, sendWeeklyRecap } = await import('./cron.js');
const { stepsRouter } = await import('./handlers/steps.js');
const { config } = await import('./config.js');
const express = (await import('express')).default;

// Wire up the recap function for /recap command
setWeeklyRecapFn(sendWeeklyRecap);

// Express server for webhooks + health check
const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/webhook', stepsRouter);

app.listen(config.port, () => {
  console.log(`Server listening on port ${config.port}`);
});

// Start cron jobs
startCronJobs(bot);

// Start Telegram bot (long polling)
bot.start({
  onStart: () => console.log('Telegram bot started'),
});
