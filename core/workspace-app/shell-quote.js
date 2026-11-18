/**
 * A value as one word of a bash line.
 *
 * In single quotes, which nothing inside can close, expand or run. JSON.stringify() is not this, though it
 * was used as if it were: it makes a double-quoted word, and inside double quotes bash still runs $(…) and
 * `…` and expands $VAR. A build argument, a prompt, a label or a summary typed into a form with any of
 * those in it was run by the shell, or arrived changed (a password "Pa$word" arrived as "Pa").
 *
 * A NUL cannot be carried by any shell word (or any argv): it is dropped.
 */
function shq(value) {
  return `'${String(value == null ? '' : value).replace(/\0/g, '').replace(/'/g, `'\\''`)}'`;
}

/** Several values as words of a bash line. */
function shWords(values) {
  return values.map(shq).join(' ');
}

module.exports = { shq, shWords };
