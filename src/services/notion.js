import { Client } from '@notionhq/client';
import { config } from '../config.js';

const notion = new Client({ auth: config.notionApiKey });

// Property names must match the Notion database exactly (including trailing space on "Eat healthy ")
const HABIT_PROPERTIES = {
  sleep_8h: '8 hours sleep',
  eat_healthy: 'Eat healthy ',
  workout_done: 'Work out',
  steps_10k: '10.000 Steps',
  read_30min: 'Read 30 minutes',
  supplements: 'Supplements',
  positivity: 'Positivity',
  calendar_reflection: 'Calendar & Reflection',
};

async function findTodayPage(date) {
  const response = await notion.databases.query({
    database_id: config.notionDatabaseId,
    filter: {
      property: 'Date',
      date: { equals: date },
    },
  });
  return response.results.length > 0 ? response.results[0].id : null;
}

function buildProperties(date, habits) {
  const properties = {
    'what went wrong?': { title: [{ text: { content: '' } }] },
    Date: { date: { start: date } },
  };
  for (const [key, notionName] of Object.entries(HABIT_PROPERTIES)) {
    properties[notionName] = { checkbox: habits[key] || false };
  }
  return properties;
}

export async function upsertHabits(date, habits) {
  const pageId = await findTodayPage(date);

  if (pageId) {
    // Update existing page — only set checkboxes, not title/date
    const properties = {};
    for (const [key, notionName] of Object.entries(HABIT_PROPERTIES)) {
      properties[notionName] = { checkbox: habits[key] || false };
    }
    await notion.pages.update({ page_id: pageId, properties });
    return pageId;
  } else {
    // Create new page
    const response = await notion.pages.create({
      parent: { database_id: config.notionDatabaseId },
      properties: buildProperties(date, habits),
    });
    return response.id;
  }
}
