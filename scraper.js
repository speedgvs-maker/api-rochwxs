'use strict';
const { v4: uuidv4 } = require('uuid');

// Pool de IDs anônimos — rotaciona para evitar rate limit
const ID_POOL_SIZE = 10;
let idPool = buildPool();
let poolIndex = 0;

function buildPool() {
  return Array.from({ length: ID_POOL_SIZE }, () => ({
    anonId: 'anon_' + uuidv4().replace(/-/g, '').substring(0, 14),
    deviceId: uuidv4(),
  }));
}

function nextId() {
  const id = idPool[poolIndex % idPool.length];
  poolIndex++;
  return id;
}

function rotateId(index) {
  idPool[index % idPool.length] = {
    anonId: 'anon_' + uuidv4().replace(/-/g, '').substring(0, 14),
    deviceId: uuidv4(),
  };
}

function makeCookie(anonId, deviceId) {
  return `abIDV2=383; premium=false; anonID=${anonId}; qbDeviceId=${deviceId}`;
}

function cleanResponse(text) {
  if (!text) return '';
  return text
    .replace(/<editor-content>/g, '')
    .replace(/<\/editor-content>/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\n\n+/g, '\n')
    .trim();
}

function isRateLimitError(status, body) {
  const s = String(body || '');
  return status === 429 || status === 403 ||
    s.includes('sign up') || s.includes('login') || s.includes('rate limit');
}

// Parseia texto NDJSON e extrai o conteúdo
function parseNDJSON(text) {
  let result = '';
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const json = JSON.parse(line);
      if (json.type === 'content' && json.content) result += json.content;
    } catch (_) {}
  }
  return cleanResponse(result);
}

async function attemptRequest(message, { anonId, deviceId }) {
  const conversationId = uuidv4();
  const cookie = makeCookie(anonId, deviceId);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);

  let res;
  try {
    res = await fetch(
      `https://quillbot.com/api/ai-chat/chat/conversation/${conversationId}`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Origin': 'https://quillbot.com',
          'Referer': `https://quillbot.com/ai-chat/c/${conversationId}`,
          'Accept': 'application/x-ndjson',
          'Content-Type': 'application/json',
          'platform-type': 'webapp',
          'qb-product': 'AI-CHAT',
          'webapp-version': '42.32.1',
          'Cookie': cookie,
          'anonid': anonId,
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
  } finally {
    clearTimeout(timeout);
  }

  const body = await res.text();

  if (isRateLimitError(res.status, body)) {
    const err = new Error('rate_limit');
    err.isRateLimit = true;
    throw err;
  }

  if (!res.ok) throw new Error(`quillbot HTTP ${res.status}`);

  const text = parseNDJSON(body);
  if (!text) throw new Error('empty_response');
  return text;
}

async function sendMessage(message, { signal } = {}) {
  const MAX_ATTEMPTS = 4;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const idIndex = (poolIndex + attempt) % idPool.length;
    const id = idPool[idIndex];

    try {
      return await attemptRequest(message, id);
    } catch (err) {
      if (signal?.aborted) throw err;

      if (err.isRateLimit) {
        rotateId(idIndex);
        if (attempt < MAX_ATTEMPTS - 1) await sleep(300 * attempt);
        continue;
      }

      throw err;
    }
  }

  throw new Error('rate_limit_exceeded — todos os IDs esgotados');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { sendMessage };
