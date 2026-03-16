import { getConversationState, upsertConversationState } from './supabase.js';

export async function getState(chatId) {
  const row = await getConversationState(chatId);
  if (!row) return { state: 'idle', context: {} };
  return {
    state: row.state || 'idle',
    context: row.context || {},
  };
}

export async function setState(chatId, state, context = {}) {
  await upsertConversationState(chatId, state, context);
}

export async function resetState(chatId) {
  await upsertConversationState(chatId, 'idle', {});
}
