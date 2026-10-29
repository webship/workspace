/**
 * OpenAI: the Images API for generate and edit, and a chat model for SVG source.
 * Endpoints can be pointed at a local stand-in for tests (OPENAI_*_API).
 */

const { keyFor, post, multipart } = require('./http');

const API = () => process.env.OPENAI_IMAGES_API || 'https://api.openai.com/v1/images/generations';
const EDITS_API = () => process.env.OPENAI_EDITS_API || 'https://api.openai.com/v1/images/edits';
const CHAT_API = () => process.env.OPENAI_CHAT_API || 'https://api.openai.com/v1/chat/completions';

const MODELS = {
  'gpt-image-2.5-flare': 'GPT Image 2.5 Flare (fast, everyday)',
  'gpt-image-2.5-sunburst': 'GPT Image 2.5 Sunburst (most precise)',
};
const SIZES = { square: '1024x1024', landscape: '1536x1024', portrait: '1024x1536' };
const QUALITIES = ['low', 'medium', 'high'];
// Per image, from OpenAI's published GPT Image 2 figures; the 2.5 models share its token price.
const ESTIMATE = { low: 0.006, medium: 0.053, high: 0.211 };
const OUTPUT_PER_TOKEN = 30 / 1e6;
const TEXT_IN_PER_TOKEN = 5 / 1e6;
const IMAGE_IN_PER_TOKEN = 8 / 1e6;
const EDIT_INPUT_ESTIMATE = 0.01;
// SVG source from a small text model; prices per token from OpenAI's pricing page.
const SVG_MODELS = { 'gpt-5.4-mini': 'GPT-5.4 mini', 'gpt-5.4-nano': 'GPT-5.4 nano (cheapest)' };
const SVG_PRICE = { 'gpt-5.4-mini': [0.75 / 1e6, 4.5 / 1e6], 'gpt-5.4-nano': [0.20 / 1e6, 1.25 / 1e6] };

const auth = (key) => ({ Authorization: `Bearer ${key}` });

/** What a run actually cost, from the usage OpenAI reports. */
function actualCost(usage) {
  if (!usage) return null;
  const out = Number(usage.output_tokens || 0);
  const inText = Number((usage.input_tokens_details && usage.input_tokens_details.text_tokens) || usage.input_tokens || 0);
  return out * OUTPUT_PER_TOKEN + inText * TEXT_IN_PER_TOKEN;
}

module.exports = {
  id: 'openai',
  label: 'OpenAI',
  keyName: 'openai',
  kinds: ['generate', 'edit', 'svg'],
  models: MODELS,
  defaultModel: 'gpt-image-2.5-flare',
  sizes: SIZES,
  qualities: QUALITIES,
  maxCount: 4,
  svgModels: SVG_MODELS,
  defaultSvgModel: 'gpt-5.4-mini',
  ESTIMATE,
  EDIT_INPUT_ESTIMATE,
  actualCost,
  key: () => keyFor('openai'),
  available() { return keyFor('openai') ? { ok: true } : { ok: false, why: 'set ai_providers.openai.api_key in settings.yml' }; },
  estimate({ quality }) { return ESTIMATE[quality] || ESTIMATE.low; },
  editEstimate({ quality }) { return (ESTIMATE[quality] || ESTIMATE.low) + EDIT_INPUT_ESTIMATE; },
  svgEstimate() { return 0.004; },

  async generate(p, key) {
    const json = await post(API(), { who: 'OpenAI', type: 'application/json', headers: auth(key),
      body: JSON.stringify({ model: p.model, prompt: p.prompt, size: p.size, quality: p.quality, n: p.n, output_format: 'png' }) });
    const images = (json.data || []).filter((d) => d.b64_json).map((d) => ({ data: Buffer.from(d.b64_json, 'base64'), ext: 'png', revised: d.revised_prompt }));
    return { images, cost: actualCost(json.usage) };
  },

  async edit(p, upload, key) {
    const fmt = p.outExt === 'jpg' ? 'jpeg' : p.outExt;
    const mp = multipart({ model: p.model, prompt: p.prompt, size: p.size, quality: p.quality, n: '1', output_format: fmt }, [upload]);
    const json = await post(EDITS_API(), { who: 'OpenAI', ...mp, headers: auth(key) });
    const item = (json.data || []).find((d) => d.b64_json);
    const u = json.usage || {};
    const imageIn = Number((u.input_tokens_details && u.input_tokens_details.image_tokens) || 0);
    const cost = u.output_tokens !== undefined ? actualCost(u) + imageIn * IMAGE_IN_PER_TOKEN : null;
    return { image: item ? Buffer.from(item.b64_json, 'base64') : null, cost };
  },

  /** SVG source and its words, as JSON from a chat model. */
  async svg({ system, messages, model }, key, { timeoutMs } = {}) {
    const m = SVG_MODELS[model] ? model : 'gpt-5.4-mini';
    const json = await post(CHAT_API(), { who: 'OpenAI', type: 'application/json', headers: auth(key), timeoutMs,
      body: JSON.stringify({ model: m, response_format: { type: 'json_object' }, reasoning_effort: 'low',
        messages: [{ role: 'system', content: system }, ...messages] }) });
    const text = String((((json.choices || [])[0] || {}).message || {}).content || '');
    const u = json.usage || {};
    const [pin, pout] = SVG_PRICE[m];
    return { text, model: m, cost: Number(u.prompt_tokens || 0) * pin + Number(u.completion_tokens || 0) * pout };
  },
};
