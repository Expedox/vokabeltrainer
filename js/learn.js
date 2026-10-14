// A learning round in one of three modes:
//   cards  – flip the card, then "Kann ich" / "Muss ich wiederholen"
//   choice – pick the right answer out of four
//   write  – type the answer (tolerant check, see check.js)
// Missed words come back a few cards later in the same round. The round ends
// when every word has been answered right once.

import * as db from './db.js';
import * as srs from './srs.js';
import { esc, plain } from './util.js';
import { speak, canSpeak } from './speech.js';
import { check } from './check.js';

export const MODES = [
  { id: 'cards', name: 'Karteikarten', icon: '🃏', hint: 'Umdrehen und selbst bewerten' },
  { id: 'choice', name: 'Auswählen', icon: '🔘', hint: 'Richtige Antwort antippen' },
  { id: 'write', name: 'Schreiben', icon: '✍️', hint: 'Wort eintippen' },
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
  const { profile, words, mode, direction, onExit } = opts;
  if (!words.length) { view.innerHTML = '<p class="empty">Keine Wörter für diese Runde.</p>'; return; }
  const progress = await srs.progressMap(profile.id, words);
  const session = srs.newSession(profile.id, opts.topicId ?? null, mode);
  if (opts.label) session.label = opts.label;

  // Weakest first, shuffled within the same box.
  const queue = shuffle(words.slice()).sort((a, b) => progress.get(a.id).box - progress.get(b.id).box);
  const total = queue.length;
  const missed = new Set();
  let known = 0;
  let answered = false;
  let busy = false;
  let keys = {};

  // Shown without "der/die/das" and "to"; the check still uses the full answer.
  const rawBack = (w) => (direction === 'de-en' ? w.term : w.translation);
  const front = (w) => (direction === 'de-en' ? plain(w.translation, 'de') : plain(w.term, 'en'));
  const back = (w) => (direction === 'de-en' ? plain(w.term, 'en') : plain(w.translation, 'de'));
  const englishOn = (side) => (direction === 'de-en') === (side === 'back');
  const speakBtn = (w) => (canSpeak() ? `<button class="speak" data-say="${esc(w.term)}" aria-label="Vorlesen">🔊</button>` : '');

  function wireSpeak(root) {
    root.querySelectorAll('.speak').forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); speak(b.dataset.say); };
    });
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
    if (mode === 'choice') renderChoice(w);
    else if (mode === 'write') renderWrite(w);
    else renderCard(w);
  }

  // ---- cards ----
  function renderCard(w) {
    frame(`
      <div class="flashcard" id="card" role="button" tabindex="0" aria-label="Karte umdrehen">
        <div class="face front">
          ${englishOn('front') ? speakBtn(w) : ''}
          <span class="word">${esc(front(w))}</span>
          <span class="tap">Tippen zum Umdrehen</span>
        </div>
        <div class="face back">
          ${englishOn('back') ? speakBtn(w) : ''}
          <span class="word">${esc(back(w))}</span>
          ${w.note ? `<span class="note">${esc(w.note)}</span>` : ''}
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
      if (opts.autoSpeak && englishOn('back')) speak(w.term);
    };
    card.onclick = flip;
    if (opts.autoSpeak && englishOn('front')) speak(w.term);
    view.querySelector('#wrong').onclick = () => flipped && answer(false);
    view.querySelector('#right').onclick = () => flipped && answer(true);
    keys = { flip, left: () => flipped && answer(false), right: () => flipped && answer(true) };
  }

  // ---- choice ----
  function renderChoice(w) {
    const others = shuffle([...words, ...(opts.pool ?? [])].filter((o) => o.id !== w.id && back(o) !== back(w)));
    const options = [];
    for (const o of others) {
      if (options.length === 3) break;
      if (!options.some((x) => back(x) === back(o))) options.push(o);
    }
    options.push(w);
    shuffle(options);
    frame(`
      <div class="prompt-card">
        ${englishOn('front') ? speakBtn(w) : ''}
        <span class="word">${esc(front(w))}</span>
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
        <span class="word">${esc(front(w))}</span>
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
      settle(check(input.value, rawBack(w)));
    };
    view.querySelector('#giveup').onclick = () => { if (!answered) settle({ ok: false }); };
    // Tip: first letter, then the rest as blanks ("H _ _ _"); a second tap shows one more letter.
    let shown = 0;
    view.querySelector('#tip').onclick = () => {
      const target = back(w).split(/\s*[/;,]\s*/)[0];
      shown = Math.min(shown + 1, Math.max(1, target.length - 1));
      const tip = form.querySelector('.tip');
      tip.textContent = [...target].map((c, i) => (i < shown || c === ' ' ? c : '_')).join(' ');
      tip.hidden = false;
      input.focus();
    };
    keys = {};
  }

  // Feedback for choice/write: right answers move on by themselves, wrong ones
  // wait for a tap so the child can read the solution.
  function feedback(ok, w, hint) {
    answered = true;
    const box = view.querySelector('.feedback');
    const t = theme();
    box.className = `feedback ${ok ? 'ok' : 'no'}`;
    box.innerHTML = ok
      ? `<strong>${pick(CHEER[t])}</strong>${hint ? `<span>${esc(hint)}</span>` : ''}`
      : `<strong>${pick(COMFORT[t])}</strong>
         <span class="solution">${esc(front(w))} = <b>${esc(back(w))}</b> ${speakBtn(w)}</span>
         ${w.note ? `<span class="note">${esc(w.note)}</span>` : ''}
         <button class="btn primary" id="next">Weiter</button>`;
    box.hidden = false;
    wireSpeak(box);
    if (opts.autoSpeak && (ok ? englishOn('back') : true)) speak(w.term);
    if (ok) {
      setTimeout(() => answer(true), hint ? 1700 : 900);
    } else {
      const next = box.querySelector('#next');
      next.onclick = () => answer(false);
      next.focus();
      keys = { next: () => answer(false) };
    }
  }

  async function answer(ok) {
    if (busy || !view.querySelector('.learn')) return;
    busy = true;
    const w = queue.shift();
    const p = progress.get(w.id);
    srs.applyAnswer(p, ok, missed.has(w.id));
    if (ok) known++;
    else {
      missed.add(w.id);
      // In a test every word is asked once; otherwise missed words come back.
      if (opts.exam) known++;
      else queue.splice(Math.min(3, queue.length), 0, w);
    }
    await Promise.all([srs.logAnswer(session, w.id, ok), db.put('progress', p)]);
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
