import * as db from './db.js';
import { LANGUAGES, seed } from './seed.js';

export const STAGES = [
  { id: 'vs', name: 'Volksschule', short: 'VS', grades: [1, 2, 3, 4], theme: 'kids' },
  { id: 'us', name: 'Unterstufe', short: 'MS/AHS', grades: [5, 6, 7, 8], theme: 'teen' },
  { id: 'os', name: 'Oberstufe', short: 'AHS', grades: [9, 10, 11, 12], theme: 'adult' },
];

export const THEMES = [
  { id: 'auto', name: 'Automatisch', hint: 'passt sich der Schulstufe an' },
  { id: 'kids', name: 'Kindlich', hint: 'bunt und verspielt' },
  { id: 'teen', name: 'Jugendlich', hint: 'frisch, ohne Kinderkram' },
  { id: 'adult', name: 'Erwachsen', hint: 'ruhig und schlicht' },
];

export const stageOf = (grade) => STAGES.find((s) => s.grades.includes(grade));

// Grade 1–4 count as Volksschule classes 1–4, 5–8 as class 1–4 Unterstufe,
// 9–12 as class 5–8 AHS. Kids know their class, not the Schulstufe.
export function classLabel(grade) {
  if (grade <= 4) return `${grade}. Klasse VS`;
  if (grade <= 8) return `${grade - 4}. Klasse`;
  return `${grade - 4}. Klasse AHS`;
}

const state = { lang: 'en', grade: null, theme: 'auto' };
const view = document.getElementById('view');
const titleEl = document.getElementById('title');
const backBtn = document.getElementById('back-btn');

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

function applyTheme() {
  const t = state.theme === 'auto' ? (stageOf(state.grade ?? 1).theme) : state.theme;
  document.body.dataset.theme = t;
  const color = getComputedStyle(document.body).getPropertyValue('--accent').trim();
  document.querySelector('meta[name=theme-color]').content = color;
}

function setHeader(title, back) {
  titleEl.textContent = title;
  backBtn.hidden = !back;
  backBtn.onclick = () => { location.hash = back; };
}

// ---- Views -----------------------------------------------------------

async function homeView() {
  setHeader('Vokabeltrainer');
  view.innerHTML = `
    <p class="lead">Welche Klasse gehst du?</p>
    ${STAGES.map((s) => `
      <section class="stage stage-${s.id}">
        <h2><span class="badge">${s.short}</span> ${s.name}</h2>
        <div class="grid grades">
          ${s.grades.map((g) => `
            <a class="tile grade-tile${g === state.grade ? ' current' : ''}" href="#/grade/${g}">
              <span class="big">${g <= 4 ? g : g - 4}</span>
              <span class="small">Klasse</span>
            </a>`).join('')}
        </div>
      </section>`).join('')}
  `;
}

async function gradeView(grade) {
  state.grade = grade;
  await db.setMeta('grade', grade);
  applyTheme();
  const stage = stageOf(grade);
  setHeader(classLabel(grade), '#/');
  const topics = (await db.topicsFor(state.lang, grade))
    .sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.title.localeCompare(b.title, 'de'));
  const counts = await Promise.all(topics.map(async (t) => (await db.vocabFor(t.id)).length));
  view.innerHTML = `
    <p class="lead"><span class="badge">${stage.short}</span> ${stage.name} · Schulstufe ${grade}</p>
    ${topics.length ? `
      <div class="grid topics">
        ${topics.map((t, i) => `
          <a class="tile topic-tile" href="#/topic/${encodeURIComponent(t.id)}">
            <span class="emoji" aria-hidden="true">${esc(t.icon || '📘')}</span>
            <span class="name">${esc(t.title)}</span>
            <span class="small">${counts[i]} Wörter${t.builtin ? '' : ' · eigene'}</span>
          </a>`).join('')}
      </div>` : '<p class="empty">Für diese Klasse gibt es noch keine Themen.</p>'}
  `;
}

async function topicView(topicId) {
  const topic = await db.get('topics', topicId);
  if (!topic) { location.hash = '#/'; return; }
  if (state.grade !== topic.grade) { state.grade = topic.grade; applyTheme(); }
  const words = (await db.vocabFor(topicId)).sort((a, b) => a.term.localeCompare(b.term, 'en'));
  setHeader(topic.title, `#/grade/${topic.grade}`);
  view.innerHTML = `
    <div class="topic-head">
      <span class="emoji big-emoji" aria-hidden="true">${esc(topic.icon || '📘')}</span>
      <div>
        <p class="lead">${words.length} Wörter</p>
        <a class="btn primary" href="#/learn/${encodeURIComponent(topicId)}">Lernen starten</a>
      </div>
    </div>
    <ul class="wordlist">
      ${words.map((w) => `
        <li><span class="term">${esc(w.term)}</span><span class="trans">${esc(w.translation)}</span></li>`).join('')}
    </ul>
  `;
}

async function learnView() {
  // Built in step 2.
  setHeader('Lernen', state.grade ? `#/grade/${state.grade}` : '#/');
  view.innerHTML = '<p class="empty">Der Lernmodus kommt im nächsten Schritt.</p>';
}

async function settingsView() {
  setHeader('Einstellungen', state.grade ? `#/grade/${state.grade}` : '#/');
  view.innerHTML = `
    <section class="card">
      <h2>Design</h2>
      <div class="choices">
        ${THEMES.map((t) => `
          <label class="choice">
            <input type="radio" name="theme" value="${t.id}"${t.id === state.theme ? ' checked' : ''}>
            <span><strong>${t.name}</strong><small>${t.hint}</small></span>
          </label>`).join('')}
      </div>
    </section>
    <section class="card">
      <h2>Sprache</h2>
      <div class="choices">
        ${LANGUAGES.map((l) => `
          <label class="choice">
            <input type="radio" name="lang" value="${l.id}"${l.id === state.lang ? ' checked' : ''}>
            <span><strong>${l.flag} ${l.name}</strong><small>Deutsch ↔ ${l.name}</small></span>
          </label>`).join('')}
      </div>
      <p class="hint">Weitere Sprachen folgen.</p>
    </section>
  `;
  view.querySelectorAll('input[name=theme]').forEach((el) => el.addEventListener('change', async () => {
    state.theme = el.value;
    await db.setMeta('theme', state.theme);
    applyTheme();
  }));
  view.querySelectorAll('input[name=lang]').forEach((el) => el.addEventListener('change', async () => {
    state.lang = el.value;
    await db.setMeta('lang', state.lang);
    await seed(state.lang);
  }));
}

// ---- Router ----------------------------------------------------------

const routes = [
  [/^#\/grade\/(\d+)$/, (m) => gradeView(Number(m[1]))],
  [/^#\/topic\/(.+)$/, (m) => topicView(decodeURIComponent(m[1]))],
  [/^#\/learn\/(.+)$/, (m) => learnView(decodeURIComponent(m[1]))],
  [/^#\/settings$/, () => settingsView()],
];

async function route() {
  const hash = location.hash || '#/';
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) { await fn(m); view.focus({ preventScroll: true }); window.scrollTo(0, 0); return; }
  }
  await homeView();
}

async function start() {
  state.lang = await db.getMeta('lang', 'en');
  state.grade = await db.getMeta('grade', null);
  state.theme = await db.getMeta('theme', 'auto');
  applyTheme();
  document.getElementById('settings-btn').onclick = () => { location.hash = '#/settings'; };
  await seed(state.lang);
  db.persist();
  window.addEventListener('hashchange', route);
  await route();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

start().catch((err) => {
  view.innerHTML = `<p class="empty">Fehler beim Starten: ${esc(err.message)}</p>`;
});
