'use strict';

const POLLINATIONS_URL = 'https://text.pollinations.ai/';

function cleanResponse(text) {
  if (!text) return '';
  return text
    .replace(/<editor-content>/g, '')
    .replace(/<\/editor-content>/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\n\n+/g, '\n')
    .trim();
}

async function attemptRequest(message) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);

  let res;
  try {
    res = await fetch(POLLINATIONS_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0',
        'Origin': 'https://pollinations.ai',
        'Referer': 'https://pollinations.ai/',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: message }],
        model: 'openai',
        seed: Math.floor(Math.random() * 9999),
        private: true,
      }),
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const err = new Error(`pollinations HTTP ${res.status}`);
    err.isRateLimit = res.status === 429 || res.status === 503;
    throw err;
  }

  const text = await res.text();
  const clean = cleanResponse(text);
  if (!clean) throw new Error('empty_response');
  return clean;
}

async function sendMessage(message, { signal } = {}) {
  const MAX_ATTEMPTS = 3;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await attemptRequest(message);
    } catch (err) {
      if (signal?.aborted) throw err;
      if (err.isRateLimit && attempt < MAX_ATTEMPTS - 1) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }

  throw new Error('todas as tentativas falharam');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { sendMessage };
