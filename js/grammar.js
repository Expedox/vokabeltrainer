// Grammar for adults: chapters with explanation, examples and exercises
// (gap, choice, transform). Results per chapter are kept in meta.

import * as db from './db.js';
import * as srs from './srs.js';
import { esc, LEVELS } from './util.js';
import { speak, canSpeak } from './speech.js';

let cache;
async function chapters(lang) {
  cache ??= (await (await fetch(`data/grammar-${lang}.json`)).json()).chapters;
  return cache;
}

const metaKey = (p) => `grammar:${p.id}`;
// A chapter is due again when the last round was under 80 % or a week ago.
const due = (r) => r.last < 80 || Date.now() - r.at > 7 * 864e5;
const norm = (s) => String(s).toLowerCase().replace(/[’`´]/g, "'").replace(/[.!?]+$/, '').replace(/\s+/g, ' ').trim();
const say = (text) => (canSpeak() ? ` <button class="speak-note" data-say="${esc(text)}" aria-label="Vorlesen">🔊</button>` : '');
const wireSay = (root) => root.querySelectorAll('[data-say]').forEach((b) => { b.onclick = () => speak(b.dataset.say); });

export async function grammarListView(ctx, p) {
  const { view } = ctx;
  ctx.setHeader('Grammatik', '#/');
  const list = await chapters(ctx.lang);
  const results = (await db.getMeta(metaKey(p), {})) ?? {};
  const levels = Object.values(LEVELS).filter((l) => list.some((c) => c.level === l));
  view.innerHTML = levels.length ? levels.map((l) => `
    <h3 class="section">Niveau ${l}</h3>
    <ul class="topic-progress grammar-list">
      ${list.filter((c) => c.level === l).map((c) => {
        const r = results[c.id];
        return `<li><a href="#/grammar/${encodeURIComponent(c.id)}">
          <span class="tp-name">${esc(c.title_de)}</span>
          <span class="tp-bar"><span style="width:${r?.best ?? 0}%"></span></span>
          <span class="tp-num">${!r ? 'neu' : due(r) ? `${r.last} % · wiederholen` : `${r.best} %`}</span></a></li>`;
      }).join('')}
    </ul>`).join('') : '<p class="empty">Noch keine Grammatik-Kapitel.</p>';
}

export async function grammarChapterView(ctx, p, id) {
  const { view } = ctx;
  const c = (await chapters(ctx.lang)).find((x) => x.id === id);
  if (!c) { location.hash = '#/grammar'; return; }
  ctx.setHeader(c.title_de, '#/grammar');
  view.innerHTML = `
    <section class="card">
      <p class="hint">Niveau ${esc(c.level)}</p>
      <p class="explain">${esc(c.explanation_de)}</p>
    </section>
    <section class="card">
      <h2>Beispiele</h2>
      <ul class="wordlist">${c.examples.map((e) => `<li><span class="term">${esc(e.en)}${say(e.en)}</span><span class="trans">${esc(e.de)}</span></li>`).join('')}</ul>
    </section>
    <button class="btn primary big" id="go">${c.exercises.length} Übungen starten</button>`;
  wireSay(view);
  view.querySelector('#go').onclick = () => run(ctx, p, c);
}

function run(ctx, p, c) {
  const { view } = ctx;
  const session = srs.newSession(p.id, null, 'grammar');
  session.label = `📐 Grammatik: ${c.title_de}`;
  // Every exercise once; the missed ones come back at the end until right.
  const queue = c.exercises.map((ex, n) => ({ ex, n }));
  const total = queue.length;
  const missed = new Set();
  let i = 0;
  let right = 0;

  const next = () => {
    const cur = queue.shift();
    if (lastOk === false) queue.push(cur);
    i++;
    if (queue.length) ask(); else finish();
  };
  let lastOk = null;

  const settle = (ok, ex) => {
    const { n } = queue[0];
    lastOk = ok;
    if (ok && !missed.has(n)) right++;
    if (!ok) missed.add(n);
    srs.logAnswer(session, `g:${c.id}:${n}`, ok, 'grammar');
    const solution = ex.type === 'choice' ? ex.options[ex.answer] : ex.answer;
    const box = view.querySelector('.feedback');
    box.className = `feedback ${ok ? 'ok' : 'no'}`;
    box.innerHTML = ok
      ? '<strong>Richtig.</strong>'
      : `<strong>Richtig wäre:</strong><span class="solution"><b>${esc(solution)}</b></span>
         ${ex.why_de || ex.hint_de ? `<span class="why">💡 ${esc(ex.why_de || ex.hint_de)}</span>` : ''}
         <button class="btn primary" id="next">Weiter</button>`;
    box.hidden = false;
    if (ok) setTimeout(next, 900);
    else { box.querySelector('#next').onclick = next; box.querySelector('#next').focus(); }
  };

  const ask = () => {
    const { ex, n } = queue[0];
    const again = missed.has(n);
    view.innerHTML = `
      <div class="learn">
        <div class="progress"><div class="bar" style="width:${(Math.min(i, total) / total) * 100}%"></div></div>
        <p class="counter">${again ? `Wiederholung · noch ${queue.length}` : `Übung ${i + 1} von ${total}`}</p>
        <div class="prompt-card sentence-card">
          <span class="de-sentence">${esc(ex.prompt)}</span>
          ${ex.type === 'transform' ? '<p class="hint">Schreib den ganzen Satz um.</p>' : ''}
        </div>
        ${ex.type === 'choice'
          ? `<div class="options sentence-options">${ex.options.map((o, n) => `<button class="btn option" data-n="${n}">${esc(o)}</button>`).join('')}</div>`
          : `<form class="write-form" autocomplete="off">
              <input class="write-input" name="answer" placeholder="${ex.type === 'gap' ? 'Fehlendes Wort …' : 'Ganzer Satz …'}" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done">
              <div class="row">
                ${ex.hint_de ? '<button type="button" class="btn" id="tip">💡</button>' : ''}
                <button class="btn primary">Prüfen</button>
              </div>
              <p class="tip" hidden></p>
            </form>`}
        <div class="feedback" hidden></div>
      </div>`;
    let done = false;
    if (ex.type === 'choice') {
      view.querySelectorAll('.option').forEach((b) => {
        b.onclick = () => {
          if (done) return; done = true;
          const ok = Number(b.dataset.n) === ex.answer;
          view.querySelectorAll('.option').forEach((x) => { x.disabled = true; if (Number(x.dataset.n) === ex.answer) x.classList.add('is-right'); });
          if (!ok) b.classList.add('is-wrong');
          settle(ok, ex);
        };
      });
    } else {
      const form = view.querySelector('form');
      setTimeout(() => form.answer.focus(), 50);
      view.querySelector('#tip')?.addEventListener('click', () => { const t = form.querySelector('.tip'); t.textContent = ex.hint_de; t.hidden = false; });
      form.onsubmit = (e) => {
        e.preventDefault();
        if (done || !form.answer.value.trim()) return;
        done = true;
        const ok = [ex.answer, ...(ex.accepted ?? [])].some((a) => norm(a) === norm(form.answer.value));
        form.answer.disabled = true;
        form.answer.classList.add(ok ? 'is-right' : 'is-wrong');
        form.querySelector('.row').hidden = true;
        settle(ok, ex);
      };
    }
  };

  const finish = async () => {
    // Score = right at the first try.
    const pct = Math.round((right / total) * 100);
    const all = (await db.getMeta(metaKey(p), {})) ?? {};
    all[c.id] = { best: Math.max(pct, all[c.id]?.best ?? 0), last: pct, at: Date.now() };
    await db.setMeta(metaKey(p), all);
    view.innerHTML = `
      <div class="learn done">
        <div class="result-emoji" aria-hidden="true">✓</div>
        <h2>${pct >= 80 ? 'Sitzt.' : 'Kapitel beendet.'}</h2>
        <p class="lead">${right} von ${total} beim ersten Versuch richtig (${pct} %)</p>
        <p class="hint">${pct >= 80 ? 'Gut. Wiederhole das Kapitel in ein paar Tagen.' : 'Lies die Erklärung noch einmal und mach die Übungen erneut.'}</p>
        <div class="stack">
          <button class="btn primary" id="again">Nochmal</button>
          <a class="btn" href="#/grammar/${encodeURIComponent(c.id)}">Zur Erklärung</a>
          <a class="btn" href="#/grammar">Alle Kapitel</a>
        </div>
      </div>`;
    view.querySelector('#again').onclick = () => run(ctx, p, c);
  };

  ask();
}
