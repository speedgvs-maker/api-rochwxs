'use strict';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

async function sendMessage(message, { signal } = {}) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY não configurada');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);
  const eff = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;

  let res;
  try {
    res = await fetch(GROQ_URL, {
      method: 'POST',
      signal: eff,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: message }],
        temperature: 0.7,
        max_tokens: 1024,
      }),
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Groq HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? '';
  if (!text.trim()) throw new Error('Groq retornou resposta vazia');
  return text.trim();
}

module.exports = { sendMessage };
