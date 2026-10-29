/**
 * xAI image generation and edits (OpenAI-shaped endpoints). The key goes in the Authorization header.
 * The docs page this was built from names the model and endpoints but not a size field, so no size is sent.
 */

const { keyFor, post } = require('./http');

const API = () => process.env.XAI_IMAGES_API || 'https://api.x.ai/v1/images/generations';
const EDITS_API = () => process.env.XAI_EDITS_API || 'https://api.x.ai/v1/images/edits';

const MODELS = { 'grok-imagine-image-2.0': 'Grok Imagine Image 2.0' };
const auth = (key) => ({ Authorization: `Bearer ${key}` });

module.exports = {
  id: 'xai',
  label: 'xAI Grok',
  keyName: 'xai',
  kinds: ['generate', 'edit'],
  models: MODELS,
  defaultModel: 'grok-imagine-image-2.0',
  sizes: { square: 'model default' },
  qualities: null,
  maxCount: 4,
  key: () => keyFor('xai'),
  available() { return keyFor('xai') ? { ok: true } : { ok: false, why: 'set ai_providers.xai.api_key in settings.yml' }; },
  // A flat fee per image; the docs page links to the pricing page rather than stating it.
  estimate() { return null; },
  editEstimate() { return null; },

  async generate(p, key) {
    const json = await post(API(), { who: 'xAI', type: 'application/json', headers: auth(key),
      body: JSON.stringify({ model: p.model, prompt: p.prompt, n: p.n, response_format: 'b64_json' }) });
    const images = (json.data || []).filter((d) => d.b64_json).map((d) => ({ data: Buffer.from(d.b64_json, 'base64'), ext: 'png', revised: d.revised_prompt }));
    return { images, cost: null };
  },

  async edit(p, upload, key) {
    const json = await post(EDITS_API(), { who: 'xAI', type: 'application/json', headers: auth(key),
      body: JSON.stringify({ model: p.model, prompt: p.prompt, response_format: 'b64_json',
        image: { type: 'image_url', url: `data:${upload.type};base64,${upload.data.toString('base64')}` } }) });
    const item = (json.data || []).find((d) => d.b64_json);
    return { image: item ? Buffer.from(item.b64_json, 'base64') : null, cost: null };
  },
};
