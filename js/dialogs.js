// Holiday and everyday situations for adults: listen to a dialogue (normal or
// slow), then answer questions you only hear.

import * as db from './db.js';
import * as srs from './srs.js';
import { esc, LEVELS } from './util.js';
import { speak, canSpeak } from './speech.js';

const SLOW = 0.6;
const NORMAL = 0.9;

let cache;
async function situations(lang) {
  cache ??= (await (await fetch(`data/dialogs-${lang}.json`)).json()).situations;
  return cache;
}
const metaKey = (p) => `dialogs:${p.id}`;

// Reads the lines one after another; resolves when done or stopped.
function playLines(lines, rate, onLine) {
  let stopped = false;
  const done = new Promise((resolve) => {
    let i = 0;
    const nextLine = () => {
      if (stopped || i >= lines.length) { onLine(-1); resolve(); return; }
      onLine(i);
      const u = new SpeechSynthesisUtterance(lines[i].en);
      u.lang = 'en-GB';
      u.rate = rate;
      // A slightly different pitch tells the two speakers apart.
      u.pitch = lines[i].speaker === 'you' ? 1.15 : 0.9;
      u.onend = () => { i++; setTimeout(nextLine, 350); };
      u.onerror = u.onend;
      speechSynthesis.speak(u);
    };
    speechSynthesis.cancel();
    nextLine();
  });
  return { done, stop: () => { stopped = true; speechSynthesis.cancel(); } };
}

export async function dialogListView(ctx, p) {
  const { view } = ctx;
  ctx.setHeader('Situationen', '#/');
  const list = await situations(ctx.lang);
  const results = (await db.getMeta(metaKey(p), {})) ?? {};
  const levels = Object.values(LEVELS).filter((l) => list.some((x) => x.level === l));
  view.innerHTML = `
    <p class="hint">Typische Gespräche aus Urlaub und Alltag: erst anhören, dann selbst antworten.</p>
    ${levels.map((l) => `
      <h3 class="section">Niveau ${l}</h3>
      <div class="grid topics">
        ${list.filter((x) => x.level === l).map((x) => `
          <a class="tile topic-tile" href="#/dialog/${encodeURIComponent(x.id)}">
            <span class="emoji" aria-hidden="true">${esc(x.icon || '💬')}</span>
            <span class="name">${esc(x.title_de)}</span>
            <span class="small">${results[x.id] ? `${results[x.id].best} % beim Üben` : `${x.practice.length} Fragen`}</span>
          </a>`).join('')}
      </div>`).join('')}`;
}

export async function dialogView(ctx, p, id) {
  const { view } = ctx;
  const sit = (await situations(ctx.lang)).find((x) => x.id === id);
  if (!sit) { location.hash = '#/dialogs'; return; }
  ctx.setHeader(sit.title_de, '#/dialogs');
  let player = null;
  view.innerHTML = `
    <section class="card">
      <div class="row center">
        ${canSpeak() ? `<button class="btn primary" id="play">▶️ Anhören</button>
        <button class="btn" id="play-slow">🐢 Langsam</button>` : ''}
        <button class="btn" id="toggle-text">Text verbergen</button>
      </div>
      <ol class="dialog">
        ${sit.lines.map((l, i) => `
          <li class="line ${l.speaker === 'you' ? 'you' : 'them'}" data-i="${i}">
            <span class="who">${l.speaker === 'you' ? 'Du' : 'Gegenüber'}</span>
            <span class="en">${esc(l.en)}</span>
            <span class="de">${esc(l.de)}</span>
            ${canSpeak() ? `<button class="speak-note" data-i="${i}" aria-label="Vorlesen">🔊</button>` : ''}
          </li>`).join('')}
      </ol>
    </section>
    <button class="btn primary big" id="practice">Jetzt du: ${sit.practice.length} Fragen beantworten</button>`;
  const mark = (i) => view.querySelectorAll('.line').forEach((li) => li.classList.toggle('playing', Number(li.dataset.i) === i));
  const play = (rate) => { player?.stop(); player = playLines(sit.lines, rate, mark); };
  view.querySelector('#play')?.addEventListener('click', () => play(NORMAL));
  view.querySelector('#play-slow')?.addEventListener('click', () => play(SLOW));
  view.querySelectorAll('.line .speak-note').forEach((b) => { b.onclick = () => { player?.stop(); speak(sit.lines[b.dataset.i].en); }; });
  view.querySelector('#toggle-text').onclick = (e) => {
    const hidden = view.querySelector('.dialog').classList.toggle('hide-text');
    e.target.textContent = hidden ? 'Text zeigen' : 'Text verbergen';
  };
  view.querySelector('#practice').onclick = () => { player?.stop(); practice(ctx, p, sit); };
}

// Questions are only heard (text on request); pick the fitting answer.
function practice(ctx, p, sit) {
  const { view } = ctx;
  const session = srs.newSession(p.id, null, 'dialog');
  session.label = `💬 Situation: ${sit.title_de}`;
  const queue = sit.practice.map((q, n) => ({ q, n }));
  const total = queue.length;
  const missed = new Set();
  let right = 0;
  let asked = 0;

  const ask = () => {
    const { q, n } = queue[0];
    const listen = canSpeak();
    view.innerHTML = `
      <div class="learn">
        <div class="progress"><div class="bar" style="width:${(Math.min(asked, total) / total) * 100}%"></div></div>
        <p class="counter">${missed.has(n) ? `Wiederholung · noch ${queue.length}` : `Frage ${asked + 1} von ${total}`}</p>
        <div class="prompt-card sentence-card">
          ${listen ? `<div class="row center">
            <button class="btn" id="again">🔊 Nochmal</button>
            <button class="btn" id="slow">🐢 Langsam</button>
          </div>
          <button class="link-btn" id="show">Text anzeigen</button>` : ''}
          <span class="de-sentence"${listen ? ' hidden' : ''}>${esc(q.prompt_en)}</span>
        </div>
        <p class="hint center">Was antwortest du?</p>
        <div class="options sentence-options">
          ${q.options.map((o, i) => `<button class="btn option" data-i="${i}">${esc(o)}</button>`).join('')}
        </div>
        <div class="feedback" hidden></div>
      </div>`;
    const reveal = () => { view.querySelector('.de-sentence').hidden = false; view.querySelector('#show')?.remove(); };
    view.querySelector('#again')?.addEventListener('click', () => speak(q.prompt_en));
    view.querySelector('#slow')?.addEventListener('click', () => speak(q.prompt_en, 'en-GB', SLOW));
    view.querySelector('#show')?.addEventListener('click', reveal);
    if (listen) speak(q.prompt_en);
    let done = false;
    view.querySelectorAll('.option').forEach((b) => {
      b.onclick = () => {
        if (done) return; done = true;
        const ok = Number(b.dataset.i) === q.answer;
        view.querySelectorAll('.option').forEach((x) => { x.disabled = true; if (Number(x.dataset.i) === q.answer) x.classList.add('is-right'); });
        if (!ok) b.classList.add('is-wrong');
        if (ok && !missed.has(n)) right++;
        if (!ok) missed.add(n);
        srs.logAnswer(session, `d:${sit.id}:${n}`, ok, 'dialog');
        reveal();
        const box = view.querySelector('.feedback');
        box.className = `feedback ${ok ? 'ok' : 'no'}`;
        box.innerHTML = `
          <strong>${ok ? 'Passt.' : 'Das passt nicht ganz.'}</strong>
          <span class="hint">„${esc(q.prompt_en)}“ = ${esc(q.prompt_de)}</span>
          <span>Typische Antworten: ${q.answers.map((a) => `<b>${esc(a)}</b>`).join(' · ')}</span>
          <button class="btn primary" id="next">Weiter</button>`;
        box.hidden = false;
        if (canSpeak()) speak(q.options[q.answer]);
        box.querySelector('#next').onclick = () => {
          const cur = queue.shift();
          if (!ok) queue.push(cur);
          asked++;
          if (queue.length) ask(); else finish();
        };
      };
    });
  };

  const finish = async () => {
    const pct = Math.round((right / total) * 100);
    const all = (await db.getMeta(metaKey(p), {})) ?? {};
    all[sit.id] = { best: Math.max(pct, all[sit.id]?.best ?? 0), last: pct, at: Date.now() };
    await db.setMeta(metaKey(p), all);
    view.innerHTML = `
      <div class="learn done">
        <div class="result-emoji" aria-hidden="true">✓</div>
        <h2>${pct >= 80 ? 'Damit kommst du durch.' : 'Situation beendet.'}</h2>
        <p class="lead">${right} von ${total} beim ersten Versuch richtig (${pct} %)</p>
        <div class="stack">
          <button class="btn primary" id="again">Nochmal üben</button>
          <a class="btn" href="#/dialog/${encodeURIComponent(sit.id)}">Dialog anhören</a>
          <a class="btn" href="#/dialogs">Alle Situationen</a>
        </div>
      </div>`;
    view.querySelector('#again').onclick = () => practice(ctx, p, sit);
  };

  ask();
}
