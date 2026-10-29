/**
 * Anthropic's Messages API, for SVG source only: Claude writes vector code, it does not render pictures.
 * The key goes in the x-api-key header.
 */

const { keyFor, post } = require('./http');

const API = () => process.env.ANTHROPIC_MESSAGES_API || 'https://api.anthropic.com/v1/messages';

const SVG_MODELS = { 'claude-sonnet-5-5': 'Claude Sonnet 5.5', 'claude-haiku-5-5': 'Claude Haiku 5.5 (fastest)' };

module.exports = {
  id: 'anthropic',
  label: 'Anthropic Claude',
  keyName: 'anthropic',
  kinds: ['svg'],
  svgModels: SVG_MODELS,
  defaultSvgModel: 'claude-haiku-5-5',
  key: () => keyFor('anthropic'),
  available() { return keyFor('anthropic') ? { ok: true } : { ok: false, why: 'set ai_providers.anthropic.api_key in settings.yml' }; },
  svgEstimate() { return null; },

  async svg({ system, messages, model }, key, { timeoutMs } = {}) {
    const m = SVG_MODELS[model] ? model : 'claude-haiku-5-5';
    const json = await post(API(), { who: 'Anthropic', type: 'application/json', timeoutMs,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: m, max_tokens: 16000, system, messages }) });
    const text = (json.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    return { text, model: m, cost: null };
  },
};
