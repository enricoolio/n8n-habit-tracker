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
  // Merge new context with existing — preserves conversation history
  const existing = await getConversationState(chatId);
  const mergedContext = {
    ...existing?.context,
    ...extraContext,
  };
  await upsertConversationState(chatId, state, mergedContext);
}

export async function resetState(chatId) {
  // Preserve conversation history when resetting to idle
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

  // Strip context header from user content before storing
  // (running totals are stale in history — only the current message should have them)
  let storedUserContent = userContent;
  if (typeof storedUserContent === 'string') {
    storedUserContent = storedUserContent.replace(/^[\s\S]*?User message:\n/m, '').trim();
  }

  // Sanitize user content: replace base64 images with text summaries
  if (Array.isArray(storedUserContent)) {
    // Extract meal name from first line of Claude's response for the summary
    const firstLine = assistantResponse.split('\n').find((l) => l.trim()) || 'food photo';
    storedUserContent = userContent.map((block) => {
      if (block.type === 'image') {
        return { type: 'text', text: `[Photo sent: ${firstLine}]` };
      }
      if (block.type === 'text') {
        // Strip context header from text blocks too
        const stripped = block.text.replace(/^[\s\S]*?User message:\n/m, '').trim();
        return { ...block, text: stripped };
      }
      return block;
    });
    // Flatten to single text string if all blocks are now text
    if (storedUserContent.every((b) => b.type === 'text')) {
      storedUserContent = storedUserContent.map((b) => b.text).join('\n');
    }
  }

  // Strip the JSON block from assistant response before storing in history
  const cleanAssistantResponse = assistantResponse
    .replace(/\n?```json\s*\n[\s\S]*?\n```\s*$/, '')
    .trim();

  messages.push(
    { role: 'user', content: storedUserContent },
    { role: 'assistant', content: cleanAssistantResponse }
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
