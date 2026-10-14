// Helpers for sentence training: comparing sentences word by word and
// building the word tiles.

import { esc } from './util.js';

export const isSentence = (v) => v?.kind === 'sentence';
export const isSentenceId = (id) => id.includes(':s:');

// Words with surrounding punctuation stripped ("house." → "house").
export const tokens = (s) => s.trim().split(/\s+/).map((t) => t.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '')).filter(Boolean);
const key = (t) => t.toLowerCase().replace(/’/g, "'");

export const sameSentence = (a, b) => tokens(a).map(key).join(' ') === tokens(b).map(key).join(' ');

// Marks the words of `text` that are not in `other` (longest common subsequence).
function marks(text, other) {
  const a = text.trim().split(/\s+/);
  const b = tokens(other).map(key);
  const ka = a.map((t) => key(tokens(t)[0] ?? t));
  const L = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    L[i][j] = ka[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  }
  const out = [];
  let i = 0; let j = 0;
  while (i < a.length) {
    if (j < b.length && ka[i] === b[j]) { out.push([a[i], false]); i++; j++; }
    else if (j < b.length && L[i][j + 1] > L[i + 1][j]) j++;
    else { out.push([a[i], true]); i++; }
  }
  return out;
}

// HTML of `text` with the words that differ from `other` highlighted.
export function diffHtml(text, other, cls) {
  return marks(text, other).map(([t, diff]) => (diff ? `<mark class="${cls}">${esc(t)}</mark>` : esc(t))).join(' ');
}

// Tiles for building the sentence: its words plus up to two "trap" words
// taken from the wrong versions (e.g. "life" next to "live").
export function tiles(sentence, distractors = []) {
  const right = tokens(sentence);
  const have = new Set(right.map(key));
  const traps = [];
  for (const d of distractors) {
    for (const t of tokens(d)) {
      if (!have.has(key(t)) && !traps.some((x) => key(x) === key(t))) { traps.push(t); break; }
    }
    if (traps.length === 2) break;
  }
  return { right, all: [...right, ...traps] };
}
