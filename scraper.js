'use strict';

// ── Quillbot (impit — funciona local, IP residencial)
// ── Groq (fallback — funciona Vercel com GROQ_API_KEY)

let Impit;
try { Impit = require('impit').Impit; } catch (_) {}

const { v4: uuidv4 } = require('uuid');

const POOL_SIZE = 10;
let pool = buildPool();
let poolIdx = 0;

function buildPool() {
  return Array.from({ length: POOL_SIZE }, () => ({
    anonId: 'anon_' + uuidv4().replace(/-/g, '').substring(0, 14),
    deviceId: uuidv4(),
  }));
}

function nextId() {
  const id = pool[poolIdx % pool.length];
  poolIdx++;
  return { id, idx: (poolIdx - 1) % pool.length };
}

function rotateId(idx) {
  pool[idx] = {
    anonId: 'anon_' + uuidv4().replace(/-/g, '').substring(0, 14),
    deviceId: uuidv4(),
  };
}

function parseNdjson(text) {
  let out = '';
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      if (j.type === 'content' && j.content) out += j.content;
    } catch (_) {}
  }
  return out
    .replace(/<editor-content>/g, '')
    .replace(/<\/editor-content>/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\n\n+/g, '\n')
    .trim();
}

// ── Quillbot ─────────────────────────────────────────────────────
async function quillbotSend(message) {
  if (!Impit) throw new Error('impit_not_available');

  const { id, idx } = nextId();
  const conversationId = uuidv4();
  const client = new Impit({ browser: 'chrome' });

  const res = await client.fetch(
    `https://quillbot.com/api/ai-chat/chat/conversation/${conversationId}`,
    {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Origin': 'https://quillbot.com',
        'Referer': `https://quillbot.com/ai-chat/c/${conversationId}`,
        'Accept': 'application/x-ndjson',
        'Content-Type': 'application/json',
        'platform-type': 'webapp',
        'qb-product': 'AI-CHAT',
        'webapp-version': '42.32.1',
        'Cookie': `abIDV2=383; premium=false; anonID=${id.anonId}; qbDeviceId=${id.deviceId}`,
        'anonid': id.anonId,
      },
      body: JSON.stringify({
        message: {
          content: message,
          prompt: { id: 'ai-chat/omnibox', version: 1 },
        },
        context: {
          editorContext: '',
          selectionContext: '',
          userDialect: 'en-us',
          apiVersion: 2,
        },
        origin: { name: 'ai-chat.chat', url: 'https://quillbot.com' },
      }),
    }
  );

  if (res.status === 429 || res.status === 403) {
    rotateId(idx);
    const err = new Error(`quillbot_${res.status}`);
    err.isRateLimit = true;
    throw err;
  }
  if (!res.ok) throw new Error(`quillbot_http_${res.status}`);

  const text = parseNdjson(await res.text());
  if (!text) throw new Error('quillbot_empty');
  return text;
}

// ── Groq ─────────────────────────────────────────────────────────
async function groqSend(message) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('groq_no_key');

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: message }],
      temperature: 0.7,
      max_tokens: 1024,
    }),
  });

  if (!res.ok) throw new Error(`groq_http_${res.status}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? '';
  if (!text.trim()) throw new Error('groq_empty');
  return text.trim();
}

// ── API pública ────────────────────────────────────────────────
async function sendMessage(message) {
  // Tenta Quillbot primeiro; se bloqueado/falhar, usa Groq
  try {
    return await quillbotSend(message);
  } catch (err) {
    if (process.env.GROQ_API_KEY) {
      return await groqSend(message);
    }
    throw err;
  }
}

module.exports = { sendMessage };
