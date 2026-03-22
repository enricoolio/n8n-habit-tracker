import { getTodayDate } from '../config.js';
import { getConversationState, upsertConversationState } from './supabase.js';

export async function getState(chatId) {
  const row = await getConversationState(chatId);
  if (!row) return { state: 'idle', context: {} };
  return {
    state: row.state || 'idle',
    context: row.context || {},
  };
}

export async function setState(chatId, state, extraContext = {}) {
  const existing = await getConversationState(chatId);
  const mergedContext = {
    ...existing?.context,
    ...extraContext,
  };
  await upsertConversationState(chatId, state, mergedContext);
}

export async function resetState(chatId) {
  const existing = await getConversationState(chatId);
  const preserved = {
    messages: existing?.context?.messages || [],
    history_date: existing?.context?.history_date || getTodayDate(),
  };
  await upsertConversationState(chatId, 'idle', preserved);
}

// --- Daily conversation history ---

export async function getConversationHistory(chatId) {
  const row = await getConversationState(chatId);
  const today = getTodayDate();
  if (!row || row.context?.history_date !== today) {
    return []; // new day → fresh conversation
  }
  return row.context?.messages || [];
}

export async function appendToHistory(chatId, userContent, assistantResponse) {
  const row = await getConversationState(chatId);
  const today = getTodayDate();

  // Start fresh if it's a new day
  const messages =
    row?.context?.history_date === today ? row?.context?.messages || [] : [];

  // Sanitize user content: replace base64 images with text summaries
  let storedUserContent = userContent;
  if (Array.isArray(storedUserContent)) {
    const firstLine = assistantResponse.split('\n').find((l) => l.trim()) || 'food photo';
    storedUserContent = storedUserContent.map((block) => {
      if (block.type === 'image') {
        return { type: 'text', text: `[Photo sent: ${firstLine}]` };
      }
      return block;
    });
    // Flatten to single text string if all blocks are now text
    if (storedUserContent.every((b) => b.type === 'text')) {
      storedUserContent = storedUserContent.map((b) => b.text).join('\n');
    }
  }

  messages.push(
    { role: 'user', content: storedUserContent },
    { role: 'assistant', content: assistantResponse }
  );

  const mergedContext = {
    ...row?.context,
    messages,
    history_date: today,
  };

  await upsertConversationState(
    String(chatId),
    row?.state || 'idle',
    mergedContext
  );
}
