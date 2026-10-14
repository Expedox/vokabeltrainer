// Parents' view of one child: progress, problem words, tasks, settings, report.

import * as db from './db.js';
import * as srs from './srs.js';
import * as profiles from './profiles.js';
import { esc, plain, STAGES, classLabel } from './util.js';
import { saveFile } from './io.js';
import { examsSection, examReport } from './exams.js';

const WEEKDAY = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const fmtDate = (t) => new Date(t).toLocaleDateString('de-AT', { day: 'numeric', month: 'numeric' });
const fmtDateTime = (t) => new Date(t).toLocaleString('de-AT', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
const minutes = (ms) => Math.max(1, Math.round(ms / 60000));
const pl = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

export async function childSummary(p) {
  const sessions = await srs.sessionsFor(p.id);
  const days = srs.perDay(sessions);
  const progress = await srs.allProgress(p.id);
  const last14 = srs.lastDays(days, 14);
  const week = last14.slice(7);
  const weekAnswers = week.reduce((n, d) => n + d.answers, 0);
  const weekRight = week.reduce((n, d) => n + d.right, 0);
  return {
    sessions, days, progress, last14,
    streak: srs.streak(days),
    learned: progress.filter(srs.isLearned).length,
    solid: progress.filter((r) => r.box >= 3).length,
    seen: progress.filter((r) => r.seen).length,
    due: progress.filter((r) => srs.isDue(r)).length,
    weekDays: week.filter((d) => d.answers).length,
    weekAnswers,
    weekQuote: pct(weekRight, weekAnswers),
    weekMinutes: week.reduce((n, d) => n + (d.answers ? minutes(d.ms) : 0), 0),
    last: sessions.at(-1)?.end ?? null,
  };
}

function barChart(last14, goal) {
  const max = Math.max(goal, ...last14.map((d) => d.answers), 1);
  return `
    <figure class="chart" aria-label="Antworten pro Tag, letzte 14 Tage">
      <div class="bars">
        ${last14.map((d) => {
          const h = (d.answers / max) * 100;
          const label = `${WEEKDAY[d.date.getDay()]} ${fmtDate(d.date)}: ${d.answers} Antworten${d.answers ? `, ${pct(d.right, d.answers)} % richtig, ca. ${minutes(d.ms)} Min.` : ''}`;
          return `<button class="bar-col" type="button" data-tip="${esc(label)}" aria-label="${esc(label)}">
            <span class="bar-fill${d.answers >= goal ? ' met' : ''}" style="height:${h}%"></span>
          </button>`;
        }).join('')}
        <span class="goal-line" style="bottom:${(goal / max) * 100}%"><span>Ziel ${goal}</span></span>
      </div>
      <div class="bar-labels">${last14.map((d, i) => `<span>${i === 13 ? 'heute' : (13 - i) % 2 ? '' : WEEKDAY[d.date.getDay()]}</span>`).join('')}</div>
      <figcaption class="chart-tip" aria-live="polite">Tippe auf einen Balken für Details.</figcaption>
    </figure>`;
}

async function topicRows(p, progressRows) {
  const byVocab = new Map(progressRows.map((r) => [r.vocabId, r]));
  const topics = (await db.all('topics')).filter((t) => t.lang === 'en');
  const rows = [];
  for (const t of topics) {
    const words = await db.vocabFor(t.id);
    const seen = words.filter((w) => byVocab.get(w.id)?.seen);
    if (!seen.length && !(p.tasks || []).includes(t.id)) continue;
    const map = new Map(words.map((w) => [w.id, byVocab.get(w.id) ?? srs.blank(p.id, w.id)]));
    rows.push({
      t, total: words.length,
      learned: words.filter((w) => srs.isLearned(map.get(w.id))).length,
      stars: srs.stars(words, map),
      task: (p.tasks || []).includes(t.id),
    });
  }
  return rows.sort((a, b) => Number(b.task) - Number(a.task) || a.t.grade - b.t.grade || a.t.title.localeCompare(b.t.title, 'de'));
}

async function problemWords(progressRows, limit = 10) {
  const rows = progressRows.filter((r) => r.wrong > 0 && (r.box <= 1 || r.wrong > r.right))
    .sort((a, b) => b.wrong - a.wrong || a.box - b.box).slice(0, limit);
  const words = await Promise.all(rows.map((r) => db.get('vocab', r.vocabId)));
  return rows.map((r, i) => ({ r, w: words[i] })).filter((x) => x.w);
}

function reportText(p, s, topics, problems) {
  const lines = [
    `Lernbericht ${p.name} (${classLabel(p.grade)}) – ${new Date().toLocaleDateString('de-AT')}`,
    '',
    `Letzte 7 Tage: an ${pl(s.weekDays, 'Tag', 'Tagen')} gelernt, ${pl(s.weekAnswers, 'Antwort', 'Antworten')}, ${s.weekQuote} % richtig, ca. ${pl(s.weekMinutes, 'Minute', 'Minuten')}.`,
    `Serie: ${pl(s.streak, 'Tag', 'Tage')} in Folge.`,
    `Gelernte Wörter: ${s.learned} (davon ${s.solid} schon sicher).`,
    s.due ? `Zum Wiederholen fällig: ${pl(s.due, 'Wort', 'Wörter')}.` : 'Keine Wörter überfällig.',
  ];
  if (topics.length) {
    lines.push('', 'Themen:');
    for (const r of topics) lines.push(`- ${r.t.title} (${classLabel(r.t.grade)}): ${r.learned}/${r.total} gelernt ${'★'.repeat(r.stars)}${r.task ? ' [Aufgabe]' : ''}`);
  }
  if (problems.length) {
    lines.push('', 'Schwierige Wörter:');
    for (const { w, r } of problems) lines.push(`- ${w.term} = ${w.translation} (${r.wrong}× falsch)`);
  }
  return lines.join('\n');
}

export async function childView(ctx, id) {
  const { view } = ctx;
  const p = await db.get('profiles', id);
  if (!p) { location.hash = '#/parents'; return; }
  ctx.setHeader(`${p.avatar} ${p.name}`, '#/parents');
  const s = await childSummary(p);
  const topics = await topicRows(p, s.progress);
  const problems = await problemWords(s.progress);
  const recent = s.sessions.slice(-8).reverse();
  const topicNames = new Map((await db.all('topics')).map((t) => [t.id, t.title]));
  const goal = p.dailyGoal || profiles.DEFAULT_GOAL;
  const modeName = { cards: 'Karteikarten', choice: 'Auswählen', write: 'Schreiben' };

  view.innerHTML = `
    <p class="lead">${classLabel(p.grade)} <a class="link-btn" href="#/parents/child/${encodeURIComponent(p.id)}/edit">Klasse ändern</a><br>${s.last ? `zuletzt gelernt ${fmtDateTime(s.last)}` : 'hat noch nicht gelernt'}</p>
    <div class="kpis">
      <div class="kpi"><b>${s.weekDays}/7</b><span>Lerntage (7 Tage)</span></div>
      <div class="kpi"><b>${s.weekQuote} %</b><span>richtig (7 Tage)</span></div>
      <div class="kpi"><b>${s.learned}</b><span>Wörter gelernt</span></div>
      <div class="kpi"><b>🔥 ${s.streak}</b><span>Tage in Folge</span></div>
    </div>

    ${await examsSection(p, ctx.lang)}

    <section class="card">
      <h2>Antworten pro Tag</h2>
      ${barChart(s.last14, goal)}
      <p class="hint">${s.weekAnswers} Antworten in den letzten 7 Tagen, ca. ${s.weekMinutes} Minuten. ${s.due ? `${pl(s.due, 'Wort ist', 'Wörter sind')} zum Wiederholen fällig.` : ''}</p>
    </section>

    <section class="card">
      <h2>Schwierige Wörter</h2>
      ${problems.length ? `<ul class="wordlist">
        ${problems.map(({ w, r }) => `<li><span class="term">${esc(plain(w.term, 'en'))}</span><span class="trans">${esc(plain(w.translation, 'de'))}</span><span class="badge-soft">${r.wrong}× falsch</span></li>`).join('')}
      </ul><p class="hint">Diese Wörter kommen beim Kind unter „Heute wiederholen“ automatisch öfter.</p>` : '<p class="hint">Noch keine Wörter, die öfter falsch waren.</p>'}
    </section>

    <section class="card">
      <h2>Themen</h2>
      ${topics.length ? `<ul class="topic-progress">
        ${topics.map((r) => `
          <li>
            <span class="tp-name">${esc(r.t.icon || '📘')} ${esc(r.t.title)} <small>${classLabel(r.t.grade)}${r.task ? ' · 📌 Aufgabe' : ''}</small></span>
            <span class="tp-bar"><span style="width:${pct(r.learned, r.total)}%"></span></span>
            <span class="tp-num">${r.learned}/${r.total}</span>
          </li>`).join('')}
      </ul>` : '<p class="hint">Noch kein Thema begonnen.</p>'}
    </section>

    <section class="card">
      <h2>Letzte Lernrunden</h2>
      ${recent.length ? `<ul class="wordlist">
        ${recent.map((r) => `<li><span class="term">${esc(r.label ?? (r.topicId ? topicNames.get(r.topicId) ?? 'Thema' : 'Wiederholung'))}<small>${fmtDateTime(r.start)} · ${modeName[r.mode] ?? ''}</small></span><span class="trans">${r.right}/${r.answers} richtig</span></li>`).join('')}
      </ul>` : '<p class="hint">Noch keine Lernrunden.</p>'}
    </section>

    <div class="stack wide">
      <a class="btn primary" href="#/parents/child/${encodeURIComponent(p.id)}/tasks">📌 Aufgaben festlegen</a>
      <button class="btn" id="report">📤 Lernbericht teilen</button>
      <a class="btn" href="#/parents/child/${encodeURIComponent(p.id)}/edit">⚙️ Einstellungen für ${esc(p.name)}</a>
    </div>
  `;
  const tip = view.querySelector('.chart-tip');
  view.querySelectorAll('.bar-col').forEach((b) => {
    const show = () => { tip.textContent = b.dataset.tip; view.querySelectorAll('.bar-col').forEach((x) => x.classList.toggle('active', x === b)); };
    b.addEventListener('click', show);
    b.addEventListener('mouseenter', show);
  });
  view.querySelectorAll('.share-exam').forEach((b) => {
    b.onclick = async () => {
      const exam = p.exams.find((e) => e.id === b.dataset.id);
      shareText(`${exam.title}-${p.name}.txt`, await examReport(p, exam, ctx.lang));
    };
  });
  view.querySelector('#report').onclick = () => {
    const text = reportText(p, s, topics, problems);
    shareText(`Lernbericht-${p.name}.txt`, text);
  };
}

async function shareText(name, text) {
  if (navigator.share) {
    try { await navigator.share({ title: name.replace(/\.txt$/, ''), text }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  await saveFile(name, text, 'text/plain');
}

export async function tasksView(ctx, id) {
  const { view } = ctx;
  const p = await db.get('profiles', id);
  if (!p) { location.hash = '#/parents'; return; }
  ctx.setHeader('Aufgaben', `#/parents/child/${encodeURIComponent(id)}`);
  const topics = (await db.all('topics')).filter((t) => t.lang === ctx.lang);
  const tasks = new Set(p.tasks || []);
  const grades = STAGES.flatMap((s) => s.grades);
  // Show the child's own class first.
  grades.sort((a, b) => (a === p.grade ? -1 : b === p.grade ? 1 : a - b));
  view.innerHTML = `
    <p class="hint">Gewählte Themen erscheinen bei ${esc(p.name)} ganz oben als „📌 Aufgaben“, z. B. für die nächste Schularbeit.</p>
    <form class="form">
      ${grades.map((g) => {
        const list = topics.filter((t) => t.grade === g).sort((a, b) => a.title.localeCompare(b.title, 'de'));
        if (!list.length) return '';
        return `<details class="card"${g === p.grade || list.some((t) => tasks.has(t.id)) ? ' open' : ''}>
          <summary><h2>${classLabel(g)}</h2></summary>
          <div class="choices">
            ${list.map((t) => `<label class="choice"><input type="checkbox" name="t" value="${esc(t.id)}"${tasks.has(t.id) ? ' checked' : ''}><span><strong>${esc(t.icon || '📘')} ${esc(t.title)}</strong></span></label>`).join('')}
          </div>
        </details>`;
      }).join('')}
      <button class="btn primary sticky-save">Speichern</button>
    </form>`;
  view.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    p.tasks = [...view.querySelectorAll('input[name=t]:checked')].map((el) => el.value);
    await profiles.save(p);
    await ctx.refresh();
    location.hash = `#/parents/child/${encodeURIComponent(id)}`;
  };
}

export async function editChildView(ctx, id) {
  const { view } = ctx;
  const p = await db.get('profiles', id);
  if (!p) { location.hash = '#/parents'; return; }
  const back = `#/parents/child/${encodeURIComponent(id)}`;
  ctx.setHeader(`Einstellungen ${p.name}`, back);
  view.innerHTML = `
    <form class="card form">
      <label class="field"><span>Name</span><input name="name" required maxlength="20" value="${esc(p.name)}"></label>
      <div class="field"><span>Tier</span>
        <div class="avatars">${profiles.AVATARS.map((a) => `<button type="button" class="avatar${a === p.avatar ? ' on' : ''}" data-a="${a}">${a}</button>`).join('')}</div>
      </div>
      <label class="field"><span>Klasse (z. B. beim Schuljahreswechsel ändern, der Lernfortschritt bleibt)</span>
        <select name="grade">${STAGES.map((s) => `<optgroup label="${s.name}">${s.grades.map((g) => `<option value="${g}"${g === p.grade ? ' selected' : ''}>${classLabel(g)}</option>`).join('')}</optgroup>`).join('')}</select>
      </label>
      <label class="field"><span>Tagesziel (Antworten pro Tag)</span>
        <select name="goal">${[10, 15, 20, 30, 40, 50].map((n) => `<option value="${n}"${n === (p.dailyGoal || profiles.DEFAULT_GOAL) ? ' selected' : ''}>${n} Antworten · ca. ${Math.round(n / 4)} Min.</option>`).join('')}</select>
      </label>
      <button class="btn primary">Speichern</button>
    </form>
    <section class="card danger-zone">
      <h2>Zurücksetzen</h2>
      <div class="stack">
        <button class="btn danger" id="reset">Lernfortschritt löschen</button>
        <button class="btn danger" id="delete">${esc(p.name)} ganz entfernen</button>
      </div>
    </section>`;
  const form = view.querySelector('form');
  let avatar = p.avatar;
  form.querySelectorAll('.avatar').forEach((b) => {
    b.onclick = () => { form.querySelectorAll('.avatar').forEach((x) => x.classList.remove('on')); b.classList.add('on'); avatar = b.dataset.a; };
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    Object.assign(p, { name: form.name.value.trim(), avatar, grade: Number(form.grade.value), dailyGoal: Number(form.goal.value), gradeYear: srs.schoolYear() });
    await profiles.save(p);
    await ctx.refresh();
    location.hash = back;
  };
  view.querySelector('#reset').onclick = async () => {
    if (!confirm(`Den gesamten Lernfortschritt von ${p.name} löschen? Das kann man nicht rückgängig machen.`)) return;
    await profiles.resetProgress(p.id);
    location.hash = back;
  };
  view.querySelector('#delete').onclick = async () => {
    if (!confirm(`${p.name} mit allem Lernfortschritt entfernen?`)) return;
    await profiles.remove(p.id);
    await ctx.refresh();
    location.hash = '#/parents';
  };
}
