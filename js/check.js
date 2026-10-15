// Tolerant answer checking for the typing exercise.

const ARTICLES = /^(der|die|das|ein|eine|the|a|an|to)\s+/;

export function normalize(s) {
  return s.toLowerCase().normalize('NFC')
    .replace(/[’']/g, "'")
    .replace(/\(.*?\)/g, ' ')
    .replace(/[.!?¿¡"„“”,:;]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

export const bare = (s) => normalize(s).replace(ARTICLES, '').trim();

// "hurry (up)" → "hurry (up)" and "hurry up": the part in brackets is optional.
export function alternatives(expected) {
  const list = expected.split(/\s*[/;,]\s*/).map((a) => a.trim()).filter(Boolean);
  return [...new Set(list.flatMap((a) => (/\(.*?\)/.test(a) ? [a, a.replace(/[()]/g, '').replace(/\s+/g, ' ')] : [a])))];
}

// British and American spelling count the same (colour/color, centre/center,
// organise/organize, travelled/traveled, grey/gray …).
const AE = { grey: 'gray', programme: 'program', tyre: 'tire', mum: 'mom', practise: 'practice', licence: 'license', defence: 'defense', offence: 'offense', catalogue: 'catalog', dialogue: 'dialog', pyjamas: 'pajamas', jewellery: 'jewelry', plough: 'plow', cosy: 'cozy', sceptical: 'skeptical', aeroplane: 'airplane', moustache: 'mustache', cheque: 'check', kerb: 'curb', mould: 'mold', manoeuvre: 'maneuver', aluminium: 'aluminum', anaesthetic: 'anesthetic', encyclopaedia: 'encyclopedia', enrol: 'enroll', fulfil: 'fulfill', judgement: 'judgment', ageing: 'aging' };
export function spelling(s) {
  return s.split(' ').map((w) => {
    if (AE[w]) return AE[w];
    if (w.length > 5) w = w.replace(/our(s|ed|ing|ite|ites|able)?$/, 'or$1');
    w = w.replace(/^(\w{3,})is(e|es|ed|ing|ation|ations)$/, '$1iz$2').replace(/^(\w{3,})ys(e|es|ed|ing)$/, '$1yz$2');
    w = w.replace(/^(\w{3,})([tb])re(s)?$/, '$1$2er$3');
    w = w.replace(/^(\w{3,}[aeiou])ll(ed|ing|er|ers)$/, '$1l$2');
    return w;
  }).join(' ');
}

export function distance(a, b) {
  const m = a.length; const n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// Returns { ok, exact, hint } — hint names what was missing or misspelt.
export function check(input, expected) {
  const given = normalize(input);
  if (!given) return { ok: false, exact: false };
  for (const alt of alternatives(expected)) {
    const want = normalize(alt);
    if (given === want) return { ok: true, exact: true };
    // Articles and "to" are optional: "Hund" = "der Hund", "go" = "to go".
    if (bare(given) === bare(alt)) return { ok: true, exact: true };
    if (spelling(bare(given)) === spelling(bare(alt))) return { ok: true, exact: true };
    const b = bare(alt);
    if (b.length >= 5 && distance(bare(given), b) === 1) return { ok: true, exact: false, hint: `Fast! Richtig geschrieben: ${alt.replace(ARTICLES, '')}` };
  }
  return { ok: false, exact: false };
}
