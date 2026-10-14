// Helpers for the spelling bee and pronunciation modes.

import { alternatives } from './check.js';
import { esc } from './util.js';

const IRREGULAR = {
  be: ['am', 'is', 'are', 'was', 'were', 'been', 'being'], have: ['has', 'had', 'having'],
  do: ['does', 'did', 'done', 'doing'], go: ['goes', 'went', 'gone', 'going'],
  make: ['made'], take: ['took', 'taken'], see: ['saw', 'seen'], eat: ['ate', 'eaten'],
  come: ['came'], get: ['got', 'gotten'], give: ['gave', 'given'], buy: ['bought'],
  bring: ['brought'], think: ['thought'], teach: ['taught'], catch: ['caught'],
  find: ['found'], say: ['said'], tell: ['told'], sell: ['sold'], write: ['wrote', 'written'],
  read: ['read'], ride: ['rode', 'ridden'], drive: ['drove', 'driven'], run: ['ran'],
  swim: ['swam', 'swum'], sing: ['sang', 'sung'], drink: ['drank', 'drunk'], begin: ['began', 'begun'],
  know: ['knew', 'known'], grow: ['grew', 'grown'], throw: ['threw', 'thrown'], fly: ['flew', 'flown', 'flies'],
  draw: ['drew', 'drawn'], wear: ['wore', 'worn'], speak: ['spoke', 'spoken'], break: ['broke', 'broken'],
  choose: ['chose', 'chosen'], forget: ['forgot', 'forgotten'], fall: ['fell', 'fallen'], feel: ['felt'],
  keep: ['kept'], sleep: ['slept'], leave: ['left'], meet: ['met'], send: ['sent'], spend: ['spent'],
  build: ['built'], lose: ['lost'], pay: ['paid'], stand: ['stood'], understand: ['understood'],
  sit: ['sat'], win: ['won'], hear: ['heard'], hold: ['held'], lead: ['led'], feed: ['fed'],
  fight: ['fought'], wake: ['woke', 'woken'], hide: ['hid', 'hidden'], bite: ['bit', 'bitten'],
  shake: ['shook', 'shaken'], steal: ['stole', 'stolen'], become: ['became'], light: ['lit'],
  child: ['children'], man: ['men'], woman: ['women'], foot: ['feet'], tooth: ['teeth'], mouse: ['mice'],
  person: ['people'], knife: ['knives'], leaf: ['leaves'], wife: ['wives'], life: ['lives'], half: ['halves'],
};

// Likely inflected forms of one English word.
function forms(word) {
  const w = word.toLowerCase();
  const out = new Set([w, `${w}s`, `${w}es`, `${w}ed`, `${w}d`, `${w}ing`, `${w}er`, `${w}est`, ...(IRREGULAR[w] ?? [])]);
  if (/[^aeiou]y$/.test(w)) ['ies', 'ied', 'ier', 'iest'].forEach((s) => out.add(w.slice(0, -1) + s));
  if (/e$/.test(w)) ['ing', 'ed', 'er', 'est'].forEach((s) => out.add(w.slice(0, -1) + s));
  if (/[^aeiou][aeiou][bdgklmnprt]$/.test(w)) ['ed', 'ing', 'er', 'est'].forEach((s) => out.add(w + w.at(-1) + s));
  return [...out];
}

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const DET = /^(a|an|the|my|your|his|her|its|our|their|this|these)$/i;
const SOMEONE = /^(something|someone|somebody|sth|sb)$/i;

// Finds the word (or an inflected form of it) in the example sentence.
// First and last word of a phrase may be inflected ("get up" → "gets up",
// "solar panel" → "solar panels"); articles are interchangeable.
export function findWord(term, sentence) {
  if (!sentence) return null;
  for (const alt of alternatives(term)) {
    const parts = alt.replace(/^to\s+/i, '').replace(/\(.*?\)/g, '').trim().split(/\s+/).filter((p) => p && !SOMEONE.test(p));
    if (!parts.length) continue;
    const pat = parts.map((p, i) => {
      if (DET.test(p)) return '(?:a|an|the|my|your|his|her|its|our|their|this|these)';
      if (i === 0 || i === parts.length - 1) return `(?:${forms(p).sort((a, b) => b.length - a.length).map(reEsc).join('|')})`;
      return reEsc(p);
    }).join('\\s+');
    const m = new RegExp(`(?<![\\p{L}'])${pat}(?![\\p{L}])`, 'iu').exec(sentence);
    if (m) return { start: m.index, end: m.index + m[0].length };
  }
  return null;
}

// The word as it stands in the sentence ("wakes up"), or null.
export function gapWord(term, sentence) {
  const hit = findWord(term, sentence);
  return hit ? sentence.slice(hit.start, hit.end) : null;
}

// Sentence as HTML with the word replaced by a gap (or highlighted).
export function sentenceHtml(term, sentence, mode = 'gap') {
  const hit = findWord(term, sentence);
  if (!hit) return esc(sentence);
  const word = sentence.slice(hit.start, hit.end);
  const mid = mode === 'gap' ? `<span class="gap">${'_'.repeat(Math.min(Math.max(word.length, 4), 12))}</span>` : `<mark>${esc(word)}</mark>`;
  return esc(sentence.slice(0, hit.start)) + mid + esc(sentence.slice(hit.end));
}
