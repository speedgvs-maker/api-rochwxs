'use strict';
const axios = require('axios');
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

function isRateLimitError(error) {
  const status = error.response?.status;
  const data = String(error.response?.data || '');
  return status === 429 || status === 403 ||
    data.includes('sign up') || data.includes('login') ||
    (error.message || '').toLowerCase().includes('rate limit');
}

// Lê um stream NDJSON e resolve com o texto completo
function readStream(stream) {
  return new Promise((resolve, reject) => {
    let fullText = '';
    let buffer = '';

    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line);
          if (json.type === 'content' && json.content) fullText += json.content;
          if (json.type === 'error') reject(new Error(json.message ?? 'Quillbot error'));
        } catch (_) {}
      }
    });

    stream.on('end', () => resolve(cleanResponse(fullText)));
    stream.on('error', reject);
  });
}

async function attemptRequest(message, { anonId, deviceId }, signal) {
  const conversationId = uuidv4();
  const cookie = makeCookie(anonId, deviceId);

  const response = await axios.post(
    `https://quillbot.com/api/ai-chat/chat/conversation/${conversationId}`,
    {
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
    },
    {
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
      responseType: 'stream',
      timeout: 60000,
      signal,
    }
  );

  return readStream(response.data);
}

/**
 * Envia mensagem para o Quillbot com retry automático e rotação de ID.
 * @param {string} message
 * @param {{ signal?: AbortSignal }} opts
 * @returns {Promise<string>}
 */
async function sendMessage(message, { signal } = {}) {
  const MAX_ATTEMPTS = 4;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const idIndex = (poolIndex + attempt) % idPool.length;
    const id = idPool[idIndex];

    try {
      const text = await attemptRequest(message, id, signal);
      if (!text) throw new Error('empty_response');
      return text;
    } catch (err) {
      if (signal?.aborted) throw err;

      if (isRateLimitError(err)) {
        rotateId(idIndex);
        // backoff leve: 0, 300, 600, 900 ms
        if (attempt < MAX_ATTEMPTS - 1) await sleep(300 * attempt);
        continue;
      }

      // Erro não recuperável
      throw err;
    }
  }

  throw new Error('rate_limit_exceeded — todos os IDs esgotados');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { sendMessage };
