/**
 * Stability AI, Stable Image Core: multipart in, base64 JSON out (Accept: application/json).
 * Generate only. The key goes in the Authorization header.
 */

const { keyFor, post, multipart } = require('./http');

const API = () => process.env.STABILITY_CORE_API || 'https://api.stability.ai/v2beta/stable-image/generate/core';

const SIZES = { square: '1:1', landscape: '16:9', portrait: '9:16' };
// About 3 credits a successful image, at $0.01 a credit; failed generations are not charged.
const PER_IMAGE = 0.03;

module.exports = {
  id: 'stability',
  label: 'Stability AI',
  keyName: 'stability',
  kinds: ['generate'],
  models: { 'stable-image-core': 'Stable Image Core' },
  defaultModel: 'stable-image-core',
  sizes: SIZES,
  qualities: null,
  maxCount: 4,
  key: () => keyFor('stability'),
  available() { return keyFor('stability') ? { ok: true } : { ok: false, why: 'set ai_providers.stability.api_key in settings.yml' }; },
  estimate() { return PER_IMAGE; },

  async generate(p, key) {
    const images = [];
    for (let i = 0; i < p.n; i += 1) {
      const mp = multipart({ prompt: p.prompt, aspect_ratio: p.size, output_format: 'png' });
      const json = await post(API(), { who: 'Stability AI', ...mp, headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } });
      if (json.image) images.push({ data: Buffer.from(json.image, 'base64'), ext: 'png' });
    }
    return { images, cost: images.length * PER_IMAGE };
  },
};
