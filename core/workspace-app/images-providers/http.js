/**
 * What every image provider shares: its key from settings.yml, one HTTPS request with the key in a header,
 * and errors with any key masked. Nothing here prints, logs or puts a key in a URL.
 */

const crypto = require('crypto');

const { loadSettings } = require('../workspaces');

/** ai_providers.<name>.api_key, or '' when it is missing or still a placeholder. */
function keyFor(name) {
  try {
    const key = String(((loadSettings().ai_providers || {})[name] || {}).api_key || '').trim();
    return key && !/CHANGE_ME|change-this/i.test(key) ? key : '';
  } catch (_) {
    return '';
  }
}

/** Anything that looks like a key, masked, so an error can be shown. */
function mask(text) {
  return String(text || '')
    .replace(/sk-[A-Za-z0-9_-]+/g, 'sk-…')
    .replace(/xai-[A-Za-z0-9_-]+/g, 'xai-…')
    .replace(/AIza[0-9A-Za-z_-]+/g, 'AIza…')
    .replace(/Bearer\s+\S+/g, 'Bearer …');
}

/**
 * One POST. `headers` carries the auth; the answer is JSON (or raw bytes with `raw: true`).
 * https.request is looked up at call time so a test can stand a local server in for the provider.
 */
function post(url, { body, type, headers = {}, raw = false, timeoutMs = 300000, who = 'The provider' }) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const req = https.request(url, { method: 'POST', timeout: timeoutMs,
      headers: { 'Content-Type': type, 'Content-Length': data.length, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString('utf8')); } catch (_) { /* not JSON */ }
        if (res.statusCode >= 200 && res.statusCode < 300 && (raw || json)) return resolve(raw ? { buf, headers: res.headers } : json);
        const why = (json && ((json.error && (json.error.message || json.error)) || json.message || json.errors)) || `HTTP ${res.statusCode}`;
        return reject(new Error(mask(typeof why === 'string' ? why : JSON.stringify(why)).slice(0, 300)));
      });
    });
    req.on('timeout', () => req.destroy(new Error(`${who} did not answer in time.`)));
    req.on('error', (e) => reject(new Error(mask(e.message))));
    req.end(data);
  });
}

/** A multipart body: text fields, then optional files. */
function multipart(fields, files = []) {
  const boundary = `----images${crypto.randomBytes(12).toString('hex')}`;
  const parts = Object.entries(fields).map(([k, v]) => Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  for (const f of files) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.field || 'image'}"; filename="${f.name}"\r\nContent-Type: ${f.type}\r\n\r\n`));
    parts.push(f.data, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
}

module.exports = { keyFor, mask, post, multipart };
