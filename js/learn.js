// A learning round in one of five modes:
//   cards  – flip the card, then "Kann ich" / "Muss ich wiederholen"
//   choice – pick the right answer out of four
//   write  – type the answer (tolerant check, see check.js)
//   spell  – spelling bee: hear word and example sentence, type the English word exactly
//   sentences – pick the right English sentence out of four
//   build     – build the sentence from word tiles (with trap words)
//   listen – the English word or sentence is only read out; pick its meaning
// Sentence items (kind: 'sentence') are always shown as sentence exercises,
// e.g. when they turn up in "Heute wiederholen".
// Missed words come back a few cards later in the same round. The round ends
// when every word has been answered right once.

import * as db from './db.js';
import * as srs from './srs.js';
import { esc, plain } from './util.js';
import { speak, speakAll, canSpeak, stop, whenDone } from './speech.js';
import { check, alternatives, bare, normalize } from './check.js';
import { sentenceHtml, gapWord, inflections } from './bee.js';
import { synonyms, related } from './synonyms.js';
import { isSentence, tokens, sameSentence, diffHtml, tiles } from './sentences.js';

export const MODES = [
  { id: 'cards', name: 'Karteikarten', icon: '🃏', hint: 'Umdrehen und selbst bewerten' },
  { id: 'choice', name: 'Auswählen', icon: '🔘', hint: 'Richtige Antwort antippen' },
  { id: 'write', name: 'Schreiben', icon: '✍️', hint: 'Wort eintippen' },
  { id: 'spell', name: 'Buchstabieren', icon: '🐝', hint: 'Hören und richtig schreiben', english: true },
  { id: 'sentences', name: 'Sätze', icon: '💬', hint: 'Den richtigen Satz unter vier finden', english: true },
  { id: 'build', name: 'Satz bauen', icon: '🧩', hint: 'Satz aus Wortbausteinen bauen, Vorsicht vor Fallen', english: true },
  { id: 'listen', name: 'Hören', icon: '👂', hint: 'Nur hören, dann die Bedeutung wählen', english: true },
];

const PRAISE = {
  kids: ['Super! 🌟', 'Toll gemacht! 🎉', 'Spitze! 🦁', 'Klasse! 🚀', 'Wow! 🌈'],
  teen: ['Stark!', 'Läuft!', 'Nice!', 'Gut gemacht!', 'Weiter so!'],
  adult: ['Gut gemacht.', 'Sauber.', 'Weiter so.'],
};
const CHEER = {
  kids: ['Richtig! ⭐', 'Juhu! 🎈', 'Genau! 👍', 'Super! ✨'],
  teen: ['Richtig!', 'Yes!', 'Genau!', '👍'],
  adult: ['Richtig.', 'Korrekt.'],
};
const COMFORT = {
  kids: ['Fast! Das schaffst du beim nächsten Mal. 💪', 'Nicht schlimm, die Karte kommt gleich wieder.'],
  teen: ['Knapp daneben, kommt gleich nochmal.', 'Nicht schlimm, gleich nochmal.'],
  adult: ['Kommt gleich noch einmal.'],
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const theme = () => document.body.dataset.theme;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function confetti(host) {
  if (theme() === 'adult' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#ff8a3d', '#ffb703', '#3fae5a', '#5b5bf0', '#e5534b', '#4fd1c5'];
  const box = document.createElement('div');
  box.className = 'confetti';
  box.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 40; i++) {
    const s = document.createElement('i');
    s.style.left = `${Math.random() * 100}%`;
    s.style.background = colors[i % colors.length];
    s.style.animationDelay = `${Math.random() * 0.4}s`;
    box.append(s);
  }
  host.append(box);
  setTimeout(() => box.remove(), 2500);
}

/**
 * opts: { profile, words, pool, mode, direction, topicId, autoSpeak,
 *         onExit(), onFinish({ total, missed }) → Promise<html> }
 * pool: extra words used as wrong options in choice mode.
 */
export async function runSession(view, opts) {
  const { profile, words, mode, onExit } = opts;
  // Spelling, sentences and listening always go from English to German.
  const direction = MODES.find((m) => m.id === mode)?.english ? 'en-de' : opts.direction;
  if (!words.length) {
    view.innerHTML = `<p class="empty">${mode === 'sentences' || mode === 'build' ? 'Hier gibt es noch keine Sätze zum Üben.' : 'Keine Wörter für diese Runde.'}</p>`;
    return;
  }
  const progress = await srs.progressMap(profile.id, words);
  const session = srs.newSession(profile.id, opts.topicId ?? null, mode);
  if (opts.label) session.label = opts.label;

  // Weakest first, shuffled within the same box.
  const queue = shuffle(words.slice()).sort((a, b) => progress.get(a.id).box - progress.get(b.id).box);
  const total = queue.length;
  const missed = new Set();
  // Strict (adults): typos count as wrong, a missed word must be right twice more.
  const strict = Boolean(profile.strict);
  const needs = new Map();
  let known = 0;
  let answered = false;
  let busy = false;
  let keys = {};

  // Shown without "der/die/das" and "to"; the check still uses the full answer.
  const rawBack = (w) => (direction === 'de-en' ? w.term : w.translation);
  const front = (w) => (direction === 'de-en' ? plain(w.translation, 'de') : plain(w.term, 'en'));
  const back = (w) => (direction === 'de-en' ? plain(w.term, 'en') : plain(w.translation, 'de'));
  const englishOn = (side) => (direction === 'de-en') === (side === 'back');
  const pic = (w) => (w.icon ? `<span class="pic" aria-hidden="true">${esc(w.icon)}</span>` : '');
  const speakBtn = (w) => (canSpeak() ? `<button class="speak" data-say="${esc(w.term)}" aria-label="Vorlesen">🔊</button>` : '');

  function wireSpeak(root) {
    root.querySelectorAll('.speak').forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); speak(b.dataset.say); };
    });
    root.querySelectorAll('.speak-note').forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); speakAll([b.dataset.say]); };
    });
  }
  // Example sentence with its own read-aloud button.
  const noteHtml = (w) => (w.note ? `<span class="note">${esc(w.note)}${canSpeak() ? ` <button class="speak-note" data-say="${esc(w.note)}" aria-label="Satz vorlesen">🔊</button>` : ''}</span>` : '');

  // Context for words with several meanings ("beenden": finish or end).
  // German → English: the data's German hint ("die Hausaufgabe beenden"), else
  // the example sentence with a gap. English → German: the example sentence.
  // Setting "Satz als Hilfe zeigen" (on unless switched off).
  const gapDe = (t) => esc(t).replace(/_{2,}/, '<span class="gap">_____</span>');
  const contextHtml = (w) => {
    // German sentence with a gap for the German word: helps both directions
    // and gives nothing away.
    if (w.hintDe) return `<span class="context">${gapDe(w.hintDe)}</span>`;
    if (profile.contextHint === false) return w.hint && !englishOn('front') ? `<span class="context">${esc(w.hint)}</span>` : '';
    if (englishOn('front')) return w.note ? `<span class="context">${esc(w.note)}</span>` : '';
    const sentence = w.note ? `<span class="context">${sentenceHtml(w.term, w.note)}</span>` : '';
    return w.hint ? `<span class="context">${esc(w.hint)}</span>${sentence}` : sentence;
  };
  // Other answers that are also right: listed in the data ("alt") or a word
  // in this round with the same meaning.
  const allWords = [...words, ...(opts.pool ?? [])];
  // Same meaning in another topic or grade ("sich beeilen": hurry, hurry up).
  const lexicon = (await db.all('vocab')).filter((v) => !isSentence(v));
  const sameKey = (x) => normalize(plain(x, 'de'));
  // Could this other word's meaning also be right for w? Then it must not be a
  // wrong option ("to stop": "beenden" next to "aufhören").
  const meanings = (text, lang) => alternatives(text).map((a) => bare(plain(a, lang))).filter(Boolean);
  function clash(w, o) {
    const enW = [...meanings(w.term, 'en'), ...(w.alt ?? []).map((a) => bare(a))];
    const enO = [...meanings(o.term, 'en'), ...(o.alt ?? []).map((a) => bare(a))];
    if (enW.some((a) => enO.some((b) => related(a, b, 'en')))) return true;
    const deW = [...meanings(w.translation, 'de'), ...(w.deAlt ?? []).map((a) => bare(a))];
    const deO = [...meanings(o.translation, 'de'), ...(o.deAlt ?? []).map((a) => bare(a))];
    return deW.some((a) => deO.some((b) => related(a, b, 'de')));
  }

  // Three wrong options: from this round first, then words of a nearby grade
  // (a round of one word still gets a real choice). Never a word that could
  // also be meant, never the same label twice; verbs go with verbs.
  const gradeOf = (v) => Number(/^\w+-(\d+)-/.exec(v.topicId ?? '')?.[1] ?? 0);
  function wrongOptions(w, label, ok = () => true) {
    const isVerb = (v) => /^to\s/i.test(v.term);
    const fits = (o) => o.id !== w.id && !isSentence(o) && label(o) !== label(w) && front(o) !== front(w) && !clash(w, o) && ok(o);
    const near = lexicon.filter((o) => Math.abs(gradeOf(o) - gradeOf(w)) <= 2 && isVerb(o) === isVerb(w));
    const out = [];
    for (const list of [shuffle(allWords.slice()), shuffle(near), shuffle(lexicon.slice())]) {
      for (const o of list) {
        if (out.length === 3) return out;
        if (fits(o) && !out.some((x) => label(x) === label(o))) out.push(o);
      }
    }
    return out;
  }

  function alsoRight(w) {
    const list = direction === 'de-en'
      ? [...(w.alt ?? []), ...lexicon.filter((o) => o.id !== w.id && sameKey(o.translation) === sameKey(w.translation)).map((o) => o.term)]
      : [...(w.deAlt ?? []), ...lexicon.filter((o) => o.id !== w.id && normalize(plain(o.term, 'en')) === normalize(plain(w.term, 'en'))).map((o) => o.translation)];
    if (direction === 'de-en') for (const a of alternatives(w.term)) list.push(...synonyms(plain(a, 'en')));
    return [...new Set(list)];
  }

  function frame(inner) {
    view.innerHTML = `
      <div class="learn">
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${known}">
          <div class="bar" style="width:${(known / total) * 100}%"></div>
        </div>
        <p class="counter">${opts.exam ? `Frage ${Math.min(known + 1, total)} von ${total}` : `${known} von ${total} geschafft${missed.size ? ` · ${missed.size} zum Wiederholen` : ''}`}</p>
        ${inner}
      </div>`;
    wireSpeak(view);
  }

  function render() {
    answered = false;
    const w = queue[0];
    if (mode === 'listen' && canSpeak()) renderListen(w);
    else if (isSentence(w)) {
      // "Satz bauen": tiles. Everywhere else: pick the right one out of four.
      if (mode === 'build' && tokens(w.term).length <= 14) renderBuild(w); else renderPick(w);
    } else if (mode === 'choice' || mode === 'sentences' || mode === 'build') renderChoice(w);
    else if (mode === 'write') renderWrite(w);
    else if (mode === 'spell') renderSpell(w);
    else renderCard(w);
  }

  // ---- cards ----
  function renderCard(w) {
    frame(`
      <div class="flashcard" id="card" role="button" tabindex="0" aria-label="Karte umdrehen">
        <div class="face front">
          ${englishOn('front') ? speakBtn(w) : ''}
          ${pic(w)}
          <span class="word">${esc(front(w))}</span>
          ${contextHtml(w)}
          <span class="tap">Tippen zum Umdrehen</span>
        </div>
        <div class="face back">
          ${englishOn('back') ? speakBtn(w) : ''}
          <span class="word">${esc(back(w))}</span>
          ${noteHtml(w)}
        </div>
      </div>
      <div class="answers" hidden>
        <button class="btn answer wrong" id="wrong">↺ Muss ich wiederholen</button>
        <button class="btn answer right" id="right">✓ Kann ich</button>
      </div>`);
    const card = view.querySelector('#card');
    let flipped = false;
    const flip = () => {
      if (flipped) return;
      flipped = true;
      card.classList.add('flipped');
      view.querySelector('.answers').hidden = false;
      if (opts.autoSpeak) speakAll(englishOn('back') ? [w.term, w.note] : [w.note]);
    };
    card.onclick = flip;
    if (opts.autoSpeak && englishOn('front')) speak(w.term);
    view.querySelector('#wrong').onclick = () => flipped && answer(false);
    view.querySelector('#right').onclick = () => flipped && answer(true);
    keys = { flip, left: () => flipped && answer(false), right: () => flipped && answer(true) };
  }

  // ---- choice ----
  function renderChoice(w) {
    const also = new Set(alsoRight(w).map((a) => normalize(plain(a, direction === 'de-en' ? 'en' : 'de'))));
    const options = wrongOptions(w, back, (o) => !also.has(normalize(back(o))));
    options.push(w);
    shuffle(options);
    frame(`
      <div class="prompt-card">
        ${englishOn('front') ? speakBtn(w) : ''}
        ${pic(w)}
        <span class="word">${esc(front(w))}</span>
        ${contextHtml(w)}
      </div>
      <div class="options">
        ${options.map((o) => `<button class="btn option" data-id="${esc(o.id)}">${esc(back(o))}</button>`).join('')}
      </div>
      <div class="feedback" hidden></div>`);
    if (opts.autoSpeak && englishOn('front')) speak(w.term);
    const choose = (btn) => {
      if (answered) return;
      const ok = btn.dataset.id === w.id;
      view.querySelectorAll('.option').forEach((b) => {
        b.disabled = true;
        if (b.dataset.id === w.id) b.classList.add('is-right');
      });
      if (!ok) btn.classList.add('is-wrong');
      feedback(ok, w);
    };
    view.querySelectorAll('.option').forEach((b) => { b.onclick = () => choose(b); });
    keys = { pick: (n) => { const b = view.querySelectorAll('.option')[n]; if (b) choose(b); } };
  }

  // ---- write ----
  function renderWrite(w) {
    const lang = direction === 'de-en' ? 'Englisch' : 'Deutsch';
    frame(`
      <div class="prompt-card">
        ${englishOn('front') ? speakBtn(w) : ''}
        ${pic(w)}
        <span class="word">${esc(front(w))}</span>
        ${contextHtml(w)}
      </div>
      <form class="write-form" autocomplete="off">
        <input class="write-input" name="answer" placeholder="Auf ${lang} …" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" aria-label="Antwort auf ${lang}">
        <p class="tip" hidden></p>
        <div class="row">
          <button type="button" class="btn" id="tip" aria-label="Tipp">💡</button>
          <button type="button" class="btn" id="giveup">Weiß ich nicht</button>
          <button class="btn primary">Prüfen</button>
        </div>
      </form>
      <div class="feedback" hidden></div>`);
    if (opts.autoSpeak && englishOn('front')) speak(w.term);
    const form = view.querySelector('form');
    const input = form.answer;
    // English verbs: "to " is already there, the child only types the verb.
    if (direction === 'de-en' && /^to\s/i.test(w.term)) input.value = 'to ';
    setTimeout(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 50);
    const settle = (res) => {
      input.disabled = true;
      input.classList.add(res.ok ? 'is-right' : 'is-wrong');
      form.querySelector('.row').hidden = true;
      feedback(res.ok, w, res.hint);
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      if (answered) return;
      if (!input.value.trim() || /^to$/i.test(input.value.trim())) { input.focus(); return; }
      let res = check(input.value, rawBack(w));
      // The form in the example sentence's gap ("finished") counts too, and
      // with a gap sentence so do inflected forms of other right answers
      // ("The lesson ___ at eight.": starts, begins).
      const gap = direction === 'de-en' && gapWord(w.term, w.note);
      if (!res.ok && gap && check(input.value, gap).exact) res = { ok: true, exact: true };
      if (!res.ok) {
        const given = bare(input.value);
        const alt = alsoRight(w).find((a) => check(input.value, a).exact || (gap && inflections(a).includes(given)));
        if (alt) res = { ok: true, exact: true, hint: `Auch richtig. Hier gemeint: ${gap || back(w)}` };
      }
      settle(strict && res.ok && !res.exact ? { ok: false, hint: res.hint } : res);
    };
    view.querySelector('#giveup').onclick = () => { if (!answered) settle({ ok: false }); };
    // Tip: first letter, then the rest as blanks ("H _ _ _"); each tap shows one
    // more letter, but never more than half the word.
    let shown = 0;
    view.querySelector('#tip').onclick = () => {
      const target = back(w).split(/\s*[/;,]\s*/)[0];
      shown = Math.min(shown + 1, Math.max(1, Math.floor(target.length / 2)));
      const tip = form.querySelector('.tip');
      tip.textContent = `Tipp: ${[...target].map((c, i) => (i < shown || c === ' ' ? c : '_')).join(' ')}`;
      tip.hidden = false;
      input.focus();
    };
    keys = {};
  }

  // ---- spell (spelling bee) ----
  // The word is read out, then the example sentence, then the word again.
  // The sentence is shown with a gap where the word is; the German meaning helps.
  // The answer is the form in the gap ("goes"), so gap and input read as a
  // correct sentence; the base form ("go") counts too.
  function renderSpell(w) {
    const target = gapWord(w.term, w.note) ?? plain(w.term, 'en');
    const say = () => speakAll([target, w.note, target]);
    frame(`
      <div class="prompt-card bee">
        ${pic(w)}
        ${canSpeak() ? `<div class="row center">
          <button class="btn" id="say-word">🔊 Wort</button>
          ${w.note ? '<button class="btn" id="say-sentence">💬 Satz</button>' : ''}
        </div>` : ''}
        ${w.note ? `<p class="sentence">${sentenceHtml(w.term, w.note)}</p>` : ''}
        <span class="meaning">${esc(plain(w.translation, 'de'))}</span>
      </div>
      <form class="write-form" autocomplete="off">
        <input class="write-input" name="answer" placeholder="Wie schreibt man das?" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" aria-label="Englisches Wort">
        <div class="row">
          <button type="button" class="btn" id="giveup">Weiß ich nicht</button>
          <button class="btn primary">Prüfen</button>
        </div>
      </form>
      <div class="feedback" hidden></div>`);
    view.querySelector('#say-word')?.addEventListener('click', () => speak(target));
    view.querySelector('#say-sentence')?.addEventListener('click', () => speakAll([w.note]));
    say();
    const form = view.querySelector('form');
    const input = form.answer;
    setTimeout(() => input.focus(), 50);
    const settle = (ok, hint) => {
      input.disabled = true;
      input.classList.add(ok ? 'is-right' : 'is-wrong');
      form.querySelector('.row').hidden = true;
      feedback(ok, w, hint, target);
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      if (answered) return;
      if (!input.value.trim()) { input.focus(); return; }
      // Spelling counts letter by letter: "almost" is not enough here.
      const res = check(input.value, w.term);
      const exact = normalize(input.value) === normalize(target) || res.exact;
      settle(exact, !exact && (res.ok || check(input.value, target).ok) ? 'Ganz knapp, ein Buchstabe stimmt nicht.' : '');
    };
    view.querySelector('#giveup').onclick = () => { if (!answered) settle(false); };
    keys = {};
  }

  // ---- listen ----
  // Only heard, not shown: pick the German meaning. Replay normal or slow.
  function renderListen(w) {
    const meaning = (v) => (isSentence(v) ? v.translation : plain(v.translation, 'de'));
    const options = isSentence(w)
      ? shuffle(allWords.filter((o) => isSentence(o) && o.id !== w.id && meaning(o) !== meaning(w))).filter((o, k, a) => a.findIndex((x) => meaning(x) === meaning(o)) === k).slice(0, 3)
      : wrongOptions(w, meaning);
    options.push(w);
    shuffle(options);
    frame(`
      <div class="prompt-card listen-card">
        ${pic(w)}
        <div class="row center">
          <button class="btn primary" id="again">🔊 Nochmal</button>
          <button class="btn" id="slow">🐢 Langsam</button>
        </div>
        <span class="word listen-text" hidden>${esc(isSentence(w) ? w.term : plain(w.term, 'en'))}</span>
      </div>
      <p class="hint center">Was bedeutet das?</p>
      <div class="options${isSentence(w) ? ' sentence-options' : ''}">
        ${options.map((o) => `<button class="btn option" data-id="${esc(o.id)}">${esc(meaning(o))}</button>`).join('')}
      </div>
      <div class="feedback" hidden></div>`);
    view.querySelector('#again').onclick = () => speak(w.term);
    view.querySelector('#slow').onclick = () => speak(w.term, 'en-GB', 0.6);
    speak(w.term);
    const choose = (btn) => {
      if (answered) return;
      const ok = btn.dataset.id === w.id;
      view.querySelectorAll('.option').forEach((b) => {
        b.disabled = true;
        if (b.dataset.id === w.id) b.classList.add('is-right');
      });
      if (!ok) btn.classList.add('is-wrong');
      view.querySelector('.listen-text').hidden = false;
      feedback(ok, w);
    };
    view.querySelectorAll('.option').forEach((b) => { b.onclick = () => choose(b); });
    keys = { pick: (n) => { const b = view.querySelectorAll('.option')[n]; if (b) choose(b); } };
  }

  // ---- sentences ----
  let given = '';
  let why = '';
  const sentencePrompt = (w, task) => `
      <div class="prompt-card sentence-card">
        <span class="de-sentence">${esc(w.translation)}</span>
      </div>
      <p class="hint center">${task}</p>`;

  function renderPick(w) {
    const options = shuffle([w.term, ...(w.distractors ?? [])]);
    frame(`${sentencePrompt(w, 'Welcher Satz ist richtig?')}
      <div class="options sentence-options">
        ${options.map((o, i) => `<button class="btn option" data-i="${i}">${esc(o)}</button>`).join('')}
      </div>
      <div class="feedback" hidden></div>`);
    const choose = (btn) => {
      if (answered) return;
      const text = options[Number(btn.dataset.i)];
      const ok = text === w.term;
      view.querySelectorAll('.option').forEach((b) => {
        b.disabled = true;
        if (options[Number(b.dataset.i)] === w.term) b.classList.add('is-right');
      });
      if (!ok) {
        btn.classList.add('is-wrong');
        btn.innerHTML = diffHtml(text, w.term, 'bad');
        view.querySelector('.option.is-right').innerHTML = diffHtml(w.term, text, 'good');
        given = text;
        why = w.why?.[(w.distractors ?? []).indexOf(text)] ?? '';
      }
      feedback(ok, w);
    };
    view.querySelectorAll('.option').forEach((b) => { b.onclick = () => choose(b); });
    keys = { pick: (n) => { const b = view.querySelectorAll('.option')[n]; if (b) choose(b); } };
  }

  function renderBuild(w) {
    const set = tiles(w.term, w.distractors);
    const pool = shuffle(set.all.map((t, i) => ({ t, i })));
    const built = [];
    frame(`${sentencePrompt(w, 'Bau den Satz auf Englisch.')}
      <div class="built" aria-live="polite"></div>
      <div class="tiles">${pool.map(({ t, i }) => `<button class="tile-word" data-i="${i}">${esc(t)}</button>`).join('')}</div>
      <div class="row center">
        <button class="btn" id="giveup">Weiß ich nicht</button>
        <button class="btn primary" id="check" disabled>Prüfen</button>
      </div>
      <div class="feedback" hidden></div>`);
    const box = view.querySelector('.built');
    const check = view.querySelector('#check');
    const draw = () => {
      box.innerHTML = built.map((i, n) => `<button class="tile-word placed" data-n="${n}">${esc(set.all[i])}</button>`).join('') || '<span class="hint">Tippe die Wörter in der richtigen Reihenfolge an.</span>';
      view.querySelectorAll('.tiles .tile-word').forEach((b) => { b.disabled = answered || built.includes(Number(b.dataset.i)); });
      box.querySelectorAll('.placed').forEach((b) => {
        b.onclick = () => { if (answered) return; built.splice(Number(b.dataset.n), 1); draw(); };
      });
      check.disabled = !built.length;
    };
    view.querySelectorAll('.tiles .tile-word').forEach((b) => {
      b.onclick = () => { if (answered) return; built.push(Number(b.dataset.i)); draw(); };
    });
    draw();
    const settle = (ok) => {
      view.querySelector('.row.center').hidden = true;
      view.querySelector('.tiles').hidden = true;
      if (!ok) {
        given = built.map((i) => set.all[i]).join(' ');
        box.innerHTML = given ? diffHtml(given, w.term, 'bad') : '';
        // A trap word from one of the wrong versions explains the mistake.
        const k = (w.distractors ?? []).findIndex((d) => tokens(given).some((t) => !tokens(w.term).includes(t) && tokens(d).includes(t)));
        why = k >= 0 ? (w.why?.[k] ?? '') : '';
      }
      box.classList.add(ok ? 'is-right' : 'is-wrong');
      feedback(ok, w);
    };
    check.onclick = () => { if (!answered && built.length) settle(sameSentence(built.map((i) => set.all[i]).join(' '), w.term)); };
    view.querySelector('#giveup').onclick = () => { if (!answered) { built.length = 0; settle(false); } };
    keys = {};
  }

  // Feedback for choice/write: right answers move on by themselves, wrong ones
  // wait for a tap so the child can read the solution.
  // spelled: the word to show letter by letter (spelling bee). quiet: no comfort text.
  function feedback(ok, w, hint, spelled = false, quiet = false) {
    answered = true;
    const box = view.querySelector('.feedback');
    const t = theme();
    box.className = `feedback ${ok ? 'ok' : 'no'}`;
    box.innerHTML = ok
      ? `<strong>${pick(CHEER[t])}</strong>${hint ? `<span>${esc(hint)}</span>` : ''}`
      : `<strong>${quiet ? 'Kommt gleich nochmal.' : pick(COMFORT[t])}</strong>
         ${hint && !spelled ? `<span>${esc(hint)}</span>` : ''}
         ${isSentence(w) ? `<span class="solution sentence-solution">${given ? diffHtml(w.term, given, 'good') : esc(w.term)} ${speakBtn(w)}</span>${why ? `<span class="why">💡 ${esc(why)}</span>` : ''}`
           : spelled ? `<span class="hint">${esc(hint || '')}</span><span class="spelling">${spelled.split(/\s+/).map((word) => `<span>${[...word].map((c) => `<b>${esc(c)}</b>`).join('')}</span>`).join('')}</span><span class="solution">${esc(plain(w.translation, 'de'))} ${speakBtn(w)}</span>`
           : `<span class="solution">${esc(front(w))} = <b>${esc(back(w))}</b> ${speakBtn(w)}</span>`}
         ${isSentence(w) ? '' : noteHtml(w)}
         <button class="btn primary" id="next">Weiter</button>`;
    box.hidden = false;
    wireSpeak(box);
    if (opts.autoSpeak && ok && (englishOn('back') || isSentence(w)) && mode !== 'spell') speak(w.term);
    if (opts.autoSpeak && !ok) speakAll(isSentence(w) ? [w.term] : [w.term, w.note]);
    given = ''; why = '';
    if (ok) {
      // Go on after the pause, but never cut off what is being read out.
      const pause = new Promise((r) => setTimeout(r, hint ? 1700 : isSentence(w) ? 1600 : 900));
      Promise.all([pause, pause.then(() => whenDone(10000))]).then(() => answer(true));
    } else {
      const next = box.querySelector('#next');
      next.onclick = () => answer(false);
      next.focus();
      keys = { next: () => answer(false) };
    }
  }

  async function answer(ok) {
    if (busy || !view.querySelector('.learn')) return;
    stop();
    busy = true;
    const w = queue.shift();
    const p = progress.get(w.id);
    srs.applyAnswer(p, ok, missed.has(w.id));
    if (ok && needs.get(w.id) > 1) {
      // Strict: right again, but it has to sit, so it comes back once more.
      needs.set(w.id, needs.get(w.id) - 1);
      queue.splice(Math.min(5, queue.length), 0, w);
    } else if (ok) known++;
    else {
      missed.add(w.id);
      if (strict && !opts.exam) needs.set(w.id, 2);
      // In a test every word is asked once; otherwise missed words come back.
      if (opts.exam) known++;
      else queue.splice(Math.min(3, queue.length), 0, w);
    }
    const asked = mode === 'listen' && canSpeak() ? 'listen'
      : isSentence(w) ? (mode === 'build' && tokens(w.term).length <= 14 ? 'build' : 'sentences')
      : ['sentences', 'build', 'listen'].includes(mode) ? 'choice' : mode;
    await Promise.all([srs.logAnswer(session, w.id, ok, asked), db.put('progress', p)]);
    busy = false;
    if (queue.length) render(); else finish();
  }

  async function finish() {
    keys = {};
    const perfect = missed.size === 0;
    const t = theme();
    const extra = opts.onFinish ? await opts.onFinish({ total, missed: missed.size, missedIds: [...missed] }) : '';
    view.innerHTML = `
      <div class="learn done">
        <div class="result-emoji" aria-hidden="true">${t === 'adult' ? '✓' : perfect ? '🏆' : '⭐'}</div>
        <h2>${perfect ? pick(PRAISE[t]) : opts.exam ? 'Probe-Prüfung beendet' : t === 'adult' ? 'Runde beendet.' : 'Geschafft!'}</h2>
        <p class="lead">${opts.exam
          ? `${total - missed.size} von ${total} richtig`
          : `${total} Wörter · ${perfect ? 'alles beim ersten Mal gewusst' : `${missed.size} musstest du wiederholen`}`}</p>
        ${extra}
        <div class="stack">
          ${missed.size ? '<button class="btn primary" id="again-missed">Diese Fehler nochmal üben</button>' : ''}
          ${opts.exam ? '' : `<button class="btn${missed.size ? '' : ' primary'}" id="again">Nochmal</button>`}
          <button class="btn" id="exit">Fertig</button>
        </div>
      </div>`;
    if (missed.size <= total / 4) confetti(view);
    const missedWords = words.filter((w) => missed.has(w.id));
    view.querySelector('#again-missed')?.addEventListener('click', () => runSession(view, { ...opts, exam: false, label: undefined, words: missedWords }));
    view.querySelector('#again')?.addEventListener('click', () => runSession(view, opts));
    view.querySelector('#exit').onclick = onExit;
  }

  // Keyboard (iPad keyboard, desktop): space flips, ←/→ rate, 1–4 choose, Enter continues.
  document.removeEventListener('keydown', window.__learnKey);
  window.__learnKey = (e) => {
    if (!view.querySelector('.learn') || e.target.tagName === 'INPUT') return;
    if ((e.key === ' ' || e.key === 'Enter') && keys.flip) { e.preventDefault(); keys.flip(); }
    else if (e.key === 'Enter' && keys.next) { e.preventDefault(); keys.next(); }
    else if (e.key === 'ArrowLeft' && keys.left) keys.left();
    else if (e.key === 'ArrowRight' && keys.right) keys.right();
    else if (/^[1-4]$/.test(e.key) && keys.pick) keys.pick(Number(e.key) - 1);
  };
  document.addEventListener('keydown', window.__learnKey);

  render();
}
