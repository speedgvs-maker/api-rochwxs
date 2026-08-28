'use strict';

// Analisa imagem: Groq vision (se GROQ_API_KEY disponível)
// ou OCR Tesseract (fallback gratuito, sem chave)

const { createWorker } = require('tesseract.js');

let _worker = null;
let _workerReady = false;

// Inicializa o worker no background (downloads lang data uma vez)
async function getWorker() {
  if (_worker) return _worker;
  _worker = await createWorker('por+eng', 1, { logger: () => {} });
  _workerReady = true;
  return _worker;
}

// Pré-aquece o worker assim que o módulo é carregado
getWorker().catch(() => {});

function isReady() { return _workerReady; }

// ── Groq vision ───────────────────────────────────────────────
async function groqVision(imageData, question) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('groq_no_key');

  // imageData pode ser URL ou base64 (data:image/...;base64,...)
  const imageContent = imageData.startsWith('http')
    ? { type: 'image_url', image_url: { url: imageData } }
    : { type: 'image_url', image_url: { url: imageData } }; // Groq aceita data: URI

  const prompt = question
    ? `${question}\n\nResponda em português.`
    : 'Descreva o conteúdo desta imagem em detalhes, em português.';

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        {
          role: 'user',
          content: [
            imageContent,
            { type: 'text', text: prompt },
          ],
        },
      ],
      max_tokens: 1024,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`groq_vision_${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? '';
  if (!text.trim()) throw new Error('groq_vision_empty');
  return { method: 'groq_vision', text: text.trim() };
}

// ── Tesseract OCR ─────────────────────────────────────────────
async function tesseractOcr(imageData) {
  const worker = await getWorker();
  const { data } = await worker.recognize(imageData);
  return data.text?.trim() ?? '';
}

// ── API pública ───────────────────────────────────────────────
/**
 * Analisa uma imagem.
 * @param {string} imageData  URL ou data URI (data:image/png;base64,...)
 * @param {string} [question] Pergunta sobre a imagem
 * @returns {Promise<{method: string, text: string, ocr?: string}>}
 */
async function analyzeImage(imageData, question) {
  if (!imageData) throw new Error('imageData é obrigatório');

  // Groq vision: melhor qualidade
  if (process.env.GROQ_API_KEY) {
    try {
      return await groqVision(imageData, question);
    } catch (err) {
      console.error('[vision] groq falhou:', err.message, '— usando OCR');
    }
  }

  // Tesseract OCR: fallback gratuito
  const ocrText = await tesseractOcr(imageData);
  if (!ocrText) throw new Error('OCR não extraiu texto');

  return { method: 'tesseract_ocr', text: ocrText };
}

module.exports = { analyzeImage, isReady };
