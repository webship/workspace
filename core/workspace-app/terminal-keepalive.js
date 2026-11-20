/**
 * A terminal's websocket, kept alive while nothing is said on it.
 *
 * A screen session waiting for an answer prints nothing for minutes, and a proxy between the browser and the
 * dashboard closes a connection that carried nothing for a while: nginx's default read timeout is 60 seconds.
 * The window then stayed on the screen with nothing behind it. So both ends say something on a quiet socket:
 *
 *   - the PAGE sends an empty binary frame every 25 seconds (public/terminal.js). No keystroke can make one: the
 *     terminal sends what is typed as text. The server answers it with the same and never writes it into the
 *     session. A page whose answer does not come back knows its socket is dead, which a socket that went quiet
 *     after a laptop slept or the network changed never says by itself.
 *   - the SERVER pings every socket on the same beat, and ends one whose browser did not answer the last ping:
 *     a browser that went away without closing would otherwise leave its `screen -x` client attached, holding
 *     the session's size to its own and one of the terminal slots.
 *
 * Plain node; `ws` is the server's.
 */

const KEEPALIVE_MS = Number(process.env.WORKSPACE_TERM_KEEPALIVE_MS) || 25 * 1000;

/** Is this frame the page's keepalive rather than something typed? An empty binary frame, and only that. */
function isKeepalive(data, isBinary) {
  return !!isBinary && (!data || data.length === 0 || data.byteLength === 0);
}

/**
 * Ping `ws` every `everyMs` and end it when the page did not answer the ping before. Any frame from the page
 * counts as an answer. Returns the function that stops it; closing the socket stops it too.
 */
function keepAlive(ws, { everyMs = KEEPALIVE_MS } = {}) {
  let answered = true;
  const heard = () => { answered = true; };
  ws.on('pong', heard);
  ws.on('message', heard);
  const timer = setInterval(() => {
    if (ws.readyState !== 1) return;
    if (!answered) {
      // Gone without a word: ending it here is what makes the server reap its pty and its screen client.
      stop();
      try { ws.terminate(); } catch (_) { /* gone already */ }
      return;
    }
    answered = false;
    try { ws.ping(); } catch (_) { /* closing */ }
  }, everyMs);
  if (timer.unref) timer.unref();
  function stop() { clearInterval(timer); }
  ws.on('close', stop);
  ws.on('error', stop);
  return stop;
}

module.exports = { KEEPALIVE_MS, isKeepalive, keepAlive };
