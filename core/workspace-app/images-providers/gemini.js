/**
 * Google Gemini, through the Interactions API: the native image model for generate and edit (the older
 * Imagen API is shut down), and a text model for SVG source. The key goes in the x-goog-api-key header.
 */

const { keyFor, post } = require('./http');

const API = () => process.env.GEMINI_INTERACTIONS_API || 'https://generativelanguage.googleapis.com/v1beta/interactions';

const MODELS = { 'gemini-nano-banana-2.1': 'Gemini Nano Banana 2.1' };
const SIZES = { square: '1:1', landscape: '16:9', portrait: '9:16' };
const RESOLUTIONS = { low: '1K', medium: '2K', high: '4K' };
const SVG_MODELS = { 'gemini-3.5-flash-lite': 'Gemini 3.5 Flash Lite', 'gemini-3.8-flash': 'Gemini 3.8 Flash' };

const auth = (key) => ({ 'x-goog-api-key': key });

/** Every block of a type in the model's output steps. */
function blocks(json, type) {
  const out = [];
  for (const step of json.steps || []) {
    if (step.type && step.type !== 'model_output') continue;
    for (const c of step.content || []) if (c.type === type) out.push(c);
  }
  return out;
}

module.exports = {
  id: 'gemini',
  label: 'Google Gemini',
  keyName: 'gemini',
  kinds: ['generate', 'edit', 'svg'],
  models: MODELS,
  defaultModel: 'gemini-nano-banana-2.1',
  sizes: SIZES,
  qualities: ['low', 'medium', 'high'],
  qualityLabels: { low: '1K', medium: '2K', high: '4K' },
  maxCount: 4,
  svgModels: SVG_MODELS,
  defaultSvgModel: 'gemini-3.5-flash-lite',
  blocks,
  key: () => keyFor('gemini'),
  available() { return keyFor('gemini') ? { ok: true } : { ok: false, why: 'set ai_providers.gemini.api_key in settings.yml' }; },
  // Google's docs give no per-image figure for this model on the page this was built from.
  estimate() { return null; },
  editEstimate() { return null; },
  svgEstimate() { return null; },

  async generate(p, key) {
    const images = [];
    // One image per call: the API returns the images of one interaction, so a count is several calls.
    for (let i = 0; i < p.n; i += 1) {
      const json = await post(API(), { who: 'Gemini', type: 'application/json', headers: auth(key),
        body: JSON.stringify({ model: p.model, input: [{ type: 'text', text: p.prompt }],
          response_format: { type: 'image', aspect_ratio: p.size, image_size: RESOLUTIONS[p.quality] || '1K' } }) });
      for (const b of blocks(json, 'image')) {
        const ext = /jpe?g/.test(b.mime_type || '') ? 'jpg' : 'png';
        images.push({ data: Buffer.from(b.data, 'base64'), ext });
      }
    }
    return { images, cost: null };
  },

  async edit(p, upload, key) {
    const json = await post(API(), { who: 'Gemini', type: 'application/json', headers: auth(key),
      body: JSON.stringify({ model: p.model, input: [{ type: 'text', text: p.prompt },
        { type: 'image', mime_type: upload.type, data: upload.data.toString('base64') }],
      response_format: { type: 'image', aspect_ratio: p.size || '1:1', image_size: RESOLUTIONS[p.quality] || '1K' } }) });
    const b = blocks(json, 'image')[0];
    return { image: b ? Buffer.from(b.data, 'base64') : null, cost: null };
  },

  async svg({ system, messages, model }, key, { timeoutMs } = {}) {
    const m = SVG_MODELS[model] ? model : 'gemini-3.5-flash-lite';
    const text = [`${system}`, ...messages.map((x) => `${x.role === 'assistant' ? 'Your previous answer' : 'Request'}:\n${x.content}`)].join('\n\n');
    const json = await post(API(), { who: 'Gemini', type: 'application/json', headers: auth(key), timeoutMs,
      body: JSON.stringify({ model: m, input: text }) });
    return { text: blocks(json, 'text').map((b) => b.text || '').join('\n'), model: m, cost: null };
  },
};
