// Placement test for adults: questions from A1 to B2, then the level to start with.

import * as profiles from './profiles.js';
import { esc, LEVELS, levelGrade } from './util.js';

const PASS = 0.6;

// Start where it stops being easy: the first level under 60 %, or B2.
export function result(answers) {
  const per = {};
  for (const { level, ok } of answers) {
    per[level] ??= { right: 0, total: 0 };
    per[level].total++;
    if (ok) per[level].right++;
  }
  const order = Object.values(LEVELS);
  const start = order.find((l) => per[l] && per[l].right / per[l].total < PASS) ?? order.at(-1);
  return { per, start };
}

export async function placementView(ctx, p) {
  const { view } = ctx;
  ctx.setHeader('Einstufungstest', '#/');
  const { questions } = await (await fetch(`data/placement-${ctx.lang}.json`)).json();
  const answers = [];
  let i = 0;

  const intro = () => {
    view.innerHTML = `
      <section class="card">
        <h2>Wo stehst du?</h2>
        <p>${questions.length} kurze Fragen, von leicht bis schwer, etwa 5 Minuten. Danach weißt du, mit welchem Niveau du am besten startest.</p>
        <p class="hint">Rate nicht: Wenn du etwas nicht weißt, tippe auf „Weiß ich nicht“.</p>
      </section>
      <button class="btn primary big" id="start">Test starten</button>`;
    view.querySelector('#start').onclick = ask;
  };

  const ask = () => {
    const q = questions[i];
    view.innerHTML = `
      <div class="learn">
        <div class="progress"><div class="bar" style="width:${(i / questions.length) * 100}%"></div></div>
        <p class="counter">Frage ${i + 1} von ${questions.length}</p>
        <div class="prompt-card sentence-card"><span class="de-sentence">${esc(q.q)}</span></div>
        <div class="options sentence-options">
          ${q.options.map((o, n) => `<button class="btn option" data-n="${n}">${esc(o)}</button>`).join('')}
          <button class="btn" data-n="-1">Weiß ich nicht</button>
        </div>
      </div>`;
    view.querySelectorAll('[data-n]').forEach((b) => {
      b.onclick = () => {
        answers.push({ level: q.level, ok: Number(b.dataset.n) === q.answer });
        i++;
        if (i < questions.length) ask(); else done();
      };
    });
  };

  const done = async () => {
    const { per, start } = result(answers);
    view.innerHTML = `
      <div class="learn done">
        <h2>Empfohlen: Niveau ${start}</h2>
        <ul class="topic-progress">
          ${Object.values(LEVELS).filter((l) => per[l]).map((l) => `
            <li><span class="tp-name">${l}</span>
              <span class="tp-bar"><span style="width:${Math.round((per[l].right / per[l].total) * 100)}%"></span></span>
              <span class="tp-num">${per[l].right}/${per[l].total}</span></li>`).join('')}
        </ul>
        <p class="hint">Ab ${start} wird es für dich schwierig. Dort lernst du am meisten. Du kannst das Niveau in den Einstellungen jederzeit ändern.</p>
        <div class="stack">
          <button class="btn primary" id="take">Mit ${start} starten</button>
          <a class="btn" href="#/">Zurück</a>
        </div>
      </div>`;
    view.querySelector('#take').onclick = async () => {
      p.grade = levelGrade(start);
      await profiles.save(p);
      await ctx.refresh();
      location.hash = '#/';
    };
  };

  intro();
}
