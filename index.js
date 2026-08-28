'use strict';
const express = require('express');
const { sendMessage } = require('./scraper');
const { analyzeImage, isReady: visionReady } = require('./vision');

// ── System prompt ─────────────────────────────────────────────
const SYSTEM_PROMPT = `Você é um assistente educacional para alunos do Ensino Médio da rede pública de SP.
Responda de forma direta, clara, em linguagem adequada para adolescentes.
Não use listas ou marcadores a menos que seja necessário. Escreva em prosa.
Não revele ser uma IA. Não use "Primeiramente", "Em suma", "Concluo".`;

function buildPrompt(userMessage, customSystem) {
  const sys = customSystem || SYSTEM_PROMPT;
  return `<system>\n${sys}\n</system>\n\n<human>\n${userMessage}\n</human>\n\nAssistant:`;
}

// ── Cache em memória (TTL 5 min) ──────────────────────────────
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function cacheGet(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.exp) { cache.delete(key); return null; }
  return item.value;
}
function cacheSet(key, value) {
  cache.set(key, { value, exp: Date.now() + CACHE_TTL });
  if (cache.size > 500) {
    const now = Date.now();
    for (const [k, v] of cache) if (now > v.exp) cache.delete(k);
  }
}

// ── App ───────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});
app.options('*', (_req, res) => res.sendStatus(204));

// GET / — status
app.get('/', (_req, res) => {
  const hasGroq = !!process.env.GROQ_API_KEY;
  res.json({
    status: 'online',
    chat: hasGroq ? 'quillbot + groq (fallback)' : 'quillbot',
    vision: hasGroq ? 'groq_vision + tesseract (fallback)' : 'tesseract_ocr',
    ocr_ready: visionReady(),
    endpoints: ['/chat', '/vision', '/vision/chat'],
  });
});

// GET|POST /chat — texto
app.all('/chat', async (req, res) => {
  if (req.method === 'OPTIONS') return res.sendStatus(204);

  const message = req.method === 'GET'
    ? String(req.query.message ?? '')
    : String(req.body?.message ?? '');
  const customSystem = req.method === 'GET'
    ? String(req.query.system ?? '')
    : String(req.body?.system ?? '');

  if (!message.trim()) {
    return res.status(400).json({ success: false, error: 'message é obrigatório' });
  }

  const ck = `${customSystem}::${message}`;
  const cached = cacheGet(ck);
  if (cached) return res.json({ success: true, response: cached, cached: true });

  try {
    const prompt = buildPrompt(message.trim(), customSystem.trim() || null);
    const response = await sendMessage(prompt);
    cacheSet(ck, response);
    return res.json({ success: true, response });
  } catch (err) {
    console.error('[chat] erro:', err.message);
    return res.status(502).json({ success: false, error: 'Serviço temporariamente indisponível' });
  }
});

// POST /vision — analisa imagem, retorna descrição/OCR
// (primeira vez pode demorar ~30s enquanto tesseract baixa o modelo)
// Body: { image: "<url ou data URI>", question?: "texto" }
app.post('/vision', async (req, res) => {
  req.socket.setTimeout(120000);
  const image = String(req.body?.image ?? '').trim();
  const question = String(req.body?.question ?? '').trim();

  if (!image) {
    return res.status(400).json({ success: false, error: 'image é obrigatório (URL ou data URI)' });
  }

  try {
    const result = await analyzeImage(image, question || null);
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[vision] erro:', err.message);
    return res.status(502).json({ success: false, error: err.message });
  }
});

// POST /vision/chat — OCR + pergunta ao chat (sem chave de visão)
// Body: { image: "<url ou data URI>", question?: "texto" }
app.post('/vision/chat', async (req, res) => {
  req.socket.setTimeout(150000);
  const image = String(req.body?.image ?? '').trim();
  const question = String(req.body?.question ?? '').trim();

  if (!image) {
    return res.status(400).json({ success: false, error: 'image é obrigatório' });
  }

  try {
    // 1. Tenta visão direta (Groq)
    const { analyzeImage: ai } = require('./vision');
    let imgText = '';
    try {
      const vr = await ai(image, question || null);
      if (vr.method === 'groq_vision') {
        return res.json({ success: true, method: 'groq_vision', response: vr.text });
      }
      imgText = vr.text; // OCR text
    } catch (_) {}

    if (!imgText) {
      return res.status(502).json({ success: false, error: 'Não foi possível extrair texto da imagem' });
    }

    // 2. Manda o texto extraído + pergunta para o chat
    const prompt = question
      ? `Imagem contém o seguinte texto:\n\n${imgText}\n\nPergunta: ${question}`
      : `Imagem contém o seguinte texto:\n\n${imgText}\n\nExplique ou responda o que for solicitado.`;

    const response = await sendMessage(buildPrompt(prompt));
    return res.json({ success: true, method: 'ocr+chat', ocr: imgText, response });
  } catch (err) {
    console.error('[vision/chat] erro:', err.message);
    return res.status(502).json({ success: false, error: 'Serviço temporariamente indisponível' });
  }
});

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
if (require.main === module) {
  app.listen(PORT, () => {
    const hasGroq = !!process.env.GROQ_API_KEY;
    console.log(`[api] rodando em http://localhost:${PORT}`);
    console.log(`[api] chat: ${hasGroq ? 'quillbot+groq' : 'quillbot'} | vision: ${hasGroq ? 'groq+ocr' : 'ocr'}`);
  });
}

module.exports = app;
