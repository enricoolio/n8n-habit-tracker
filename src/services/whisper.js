import OpenAI from 'openai';
import { config } from '../config.js';

const client = new OpenAI({ apiKey: config.openaiApiKey });

export async function transcribeVoice(buffer, filename = 'voice.ogg') {
  const file = new File([buffer], filename, { type: 'audio/ogg' });
  const transcription = await client.audio.transcriptions.create({
    model: 'whisper-1',
    file,
  });
  return transcription.text;
}
