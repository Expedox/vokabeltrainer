// Flashcard session. Leitner boxes 0–5 per word:
//   "Kann ich"  → box + 1
//   "Wiederholen" → box 0, and the card comes back later in the same session
//                   (getting it right then does not lift it out of box 0).
// A session ends when every card has been answered "Kann ich" once.

import * as db from './db.js';
import { esc } from './util.js';

const PRAISE = {
  kids: ['Super! 🌟', 'Toll gemacht! 🎉', 'Spitze! 🦁', 'Klasse! 🚀'],
  teen: ['Stark!', 'Läuft!', 'Nice!', 'Gut gemacht!'],
  adult: ['Gut gemacht.', 'Sauber.', 'Weiter so.'],
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export async function progressFor(words) {
  const rows = await Promise.all(words.map((w) => db.get('progress', w.id)));
  return new Map(words.map((w, i) => [w.id, rows[i] ?? { vocabId: w.id, box: 0, right: 0, wrong: 0, seen: 0 }]));
}

// Words answered wrong last time (box 0 after being seen).
export const needsRepeat = (p) => p.seen > 0 && p.box === 0;

export async function runSession(view, { topic, words, mode, direction, onExit }) {
  const progress = await progressFor(words);
  let pool = mode === 'repeat' ? words.filter((w) => needsRepeat(progress.get(w.id))) : words.slice();
  if (!pool.length) pool = words.slice();

  // Weakest and least recently seen first, shuffled within the same box.
  pool = shuffle(pool).sort((a, b) => progress.get(a.id).box - progress.get(b.id).box);
  const queue = pool.slice();
  const total = pool.length;
  const missed = new Set();
  let known = 0;
  let flipped = false;

  const theme = () => document.body.dataset.theme;

  function render() {
    const w = queue[0];
    const front = direction === 'de-en' ? w.translation : w.term;
    const back = direction === 'de-en' ? w.term : w.translation;
    flipped = false;
    view.innerHTML = `
      <div class="learn">
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${known}">
          <div class="bar" style="width:${(known / total) * 100}%"></div>
        </div>
        <p class="counter">${known} von ${total} gewusst</p>
        <button class="flashcard" id="card" aria-label="Karte umdrehen">
          <span class="face front">
            <span class="word">${esc(front)}</span>
            <span class="tap">Tippen zum Umdrehen</span>
          </span>
          <span class="face back">
            <span class="word">${esc(back)}</span>
            ${w.note ? `<span class="note">${esc(w.note)}</span>` : ''}
          </span>
        </button>
        <div class="answers" hidden>
          <button class="btn answer wrong" id="wrong">↺ Muss ich wiederholen</button>
          <button class="btn answer right" id="right">✓ Kann ich</button>
        </div>
      </div>`;
    view.querySelector('#card').onclick = flip;
    view.querySelector('#wrong').onclick = () => answer(false);
    view.querySelector('#right').onclick = () => answer(true);
  }

  function flip() {
    if (flipped) return;
    flipped = true;
    view.querySelector('#card').classList.add('flipped');
    view.querySelector('.answers').hidden = false;
  }

  async function answer(ok) {
    if (!flipped) return;
    const w = queue.shift();
    const p = progress.get(w.id);
    p.seen = Date.now();
    if (ok) {
      // A word missed earlier in this session stays in box 0 so it shows up
      // under "Fehler wiederholen" next time.
      if (!missed.has(w.id)) p.box = Math.min(5, p.box + 1);
      p.right++;
      known++;
    } else {
      p.box = 0;
      p.wrong++;
      missed.add(w.id);
      // Bring it back a few cards later (or at the end if the queue is short).
      queue.splice(Math.min(3, queue.length), 0, w);
    }
    await db.put('progress', p);
    if (queue.length) render(); else finish();
  }

  function finish() {
    const perfect = missed.size === 0;
    const t = theme();
    view.innerHTML = `
      <div class="learn done">
        <div class="result-emoji" aria-hidden="true">${t === 'adult' ? '✓' : perfect ? '🏆' : '⭐'}</div>
        <h2>${perfect ? pick(PRAISE[t]) : t === 'adult' ? 'Runde beendet.' : 'Geschafft!'}</h2>
        <p class="lead">${total} Wörter · ${perfect ? 'alles beim ersten Mal gewusst' : `${missed.size} musstest du wiederholen`}</p>
        <div class="stack">
          ${missed.size ? '<button class="btn primary" id="again-missed">Diese Fehler nochmal üben</button>' : ''}
          <button class="btn${missed.size ? '' : ' primary'}" id="again">Nochmal alle</button>
          <button class="btn" id="exit">Zurück zum Thema</button>
        </div>
      </div>`;
    const missedWords = words.filter((w) => missed.has(w.id));
    view.querySelector('#again-missed')?.addEventListener('click', () =>
      runSession(view, { topic, words: missedWords, mode: 'all', direction, onExit }));
    view.querySelector('#again').onclick = () => runSession(view, { topic, words, mode: 'all', direction, onExit });
    view.querySelector('#exit').onclick = onExit;
  }

  // Keyboard on iPad/desktop: space flips, ← wrong, → right.
  const onKey = (e) => {
    if (!document.body.contains(view.querySelector('.flashcard'))) return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); }
    else if (e.key === 'ArrowLeft') answer(false);
    else if (e.key === 'ArrowRight') answer(true);
  };
  document.removeEventListener('keydown', window.__learnKey);
  window.__learnKey = onKey;
  document.addEventListener('keydown', onKey);

  render();
}
