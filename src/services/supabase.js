import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey);

export async function getTodayFoodLogs(date) {
  const { data, error } = await supabase
    .from('food_logs')
    .select('*')
    .eq('date', date)
    .order('logged_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function insertFoodLog(record) {
  const { data, error } = await supabase
    .from('food_logs')
    .insert(record)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getLatestFoodLog(date) {
  const { data, error } = await supabase
    .from('food_logs')
    .select('*')
    .eq('date', date)
    .order('logged_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateFoodLog(id, updates) {
  const { data, error } = await supabase
    .from('food_logs')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteFoodLog(id) {
  const { error } = await supabase
    .from('food_logs')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

export async function getDateRangeFoodLogs(startDate, endDate) {
  const { data, error } = await supabase
    .from('food_logs')
    .select('*')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('logged_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getDailySummary(date) {
  const { data, error } = await supabase
    .from('daily_summaries')
    .select('*')
    .eq('date', date)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getDateRangeSummaries(startDate, endDate) {
  const { data, error } = await supabase
    .from('daily_summaries')
    .select('*')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function upsertDailySummary(record) {
  const { data, error } = await supabase
    .from('daily_summaries')
    .upsert(record, { onConflict: 'date' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function insertWeeklyRecap(record) {
  const { data, error } = await supabase
    .from('weekly_recaps')
    .insert(record)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getConversationState(chatId) {
  const { data, error } = await supabase
    .from('conversation_state')
    .select('*')
    .eq('chat_id', String(chatId))
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertConversationState(chatId, state, context) {
  const { error } = await supabase
    .from('conversation_state')
    .upsert(
      {
        chat_id: String(chatId),
        state,
        context,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'chat_id' }
    );
  if (error) throw error;
}
