// Tolerant answer checking for the typing exercise.

const ARTICLES = /^(der|die|das|ein|eine|the|a|an|to)\s+/;

export function normalize(s) {
  return s.toLowerCase().normalize('NFC')
    .replace(/[’']/g, "'")
    .replace(/\(.*?\)/g, ' ')
    .replace(/[.!?¿¡"„“”,:;]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

const bare = (s) => normalize(s).replace(ARTICLES, '').trim();

export function alternatives(expected) {
  return expected.split(/\s*[/;,]\s*/).map((a) => a.trim()).filter(Boolean);
}

function distance(a, b) {
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
    if (bare(given) === bare(alt)) {
      const hadArticle = ARTICLES.test(want) && !ARTICLES.test(given);
      return { ok: true, exact: false, hint: hadArticle ? `Mit Artikel: ${alt}` : `Genau: ${alt}` };
    }
    const b = bare(alt);
    if (b.length >= 5 && distance(bare(given), b) === 1) return { ok: true, exact: false, hint: `Fast! Richtig geschrieben: ${alt}` };
  }
  return { ok: false, exact: false };
}
