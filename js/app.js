import * as db from './db.js';
import * as srs from './srs.js';
import * as profiles from './profiles.js';
import { LANGUAGES, seed } from './seed.js';
import { esc, STAGES, THEMES, stageOf, classLabel } from './util.js';
import { parentsRoute, lock } from './parents.js';
import { runSession, MODES } from './learn.js';

const state = { lang: 'en', profile: null };
const view = document.getElementById('view');
const titleEl = document.getElementById('title');
const backBtn = document.getElementById('back-btn');

export function applyTheme(profile = state.profile) {
  const pref = profile?.theme ?? 'auto';
  const t = pref === 'auto' ? stageOf(profile?.grade ?? 1).theme : pref;
  document.body.dataset.theme = t;
  const color = getComputedStyle(document.body).getPropertyValue('--accent').trim();
  document.querySelector('meta[name=theme-color]').content = color;
}

function setHeader(title, back) {
  titleEl.textContent = title;
  backBtn.hidden = !back;
  backBtn.onclick = () => { location.hash = back; };
}

const starStr = (n) => `<span class="stars" aria-label="${n} von 3 Sternen">${'★'.repeat(n)}<span class="off">${'★'.repeat(3 - n)}</span></span>`;

async function topicTiles(topics) {
  const rows = await Promise.all(topics.map(async (t) => {
    const words = await db.vocabFor(t.id);
    const progress = await srs.progressMap(state.profile.id, words);
    return { t, count: words.length, stars: srs.stars(words, progress) };
  }));
  return `
    <div class="grid topics">
      ${rows.map(({ t, count, stars }) => `
        <a class="tile topic-tile" href="#/topic/${encodeURIComponent(t.id)}">
          <span class="emoji" aria-hidden="true">${esc(t.icon || '📘')}</span>
          <span class="name">${esc(t.title)}</span>
          ${starStr(stars)}
          <span class="small">${count} Wörter${t.builtin ? '' : ' · eigene'}</span>
        </a>`).join('')}
    </div>`;
}

const sortTopics = (list) => list.sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.title.localeCompare(b.title, 'de'));

async function todayStats(profile) {
  const days = srs.perDay(await srs.sessionsFor(profile.id));
  const today = days.get(srs.dayKey(Date.now()))?.answers ?? 0;
  return { today, streak: srs.streak(days), goal: profile.dailyGoal || profiles.DEFAULT_GOAL };
}

function goalRing(done, goal) {
  const pct = Math.min(1, done / goal);
  const r = 26; const c = 2 * Math.PI * r;
  return `
    <svg class="ring" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="${r}" class="ring-bg"/>
      <circle cx="32" cy="32" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"/>
      <text x="32" y="37" text-anchor="middle">${pct >= 1 ? '✓' : Math.round(pct * 100) + '%'}</text>
    </svg>`;
}

// ---- Views -----------------------------------------------------------

async function welcomeView(first) {
  setHeader(first ? 'Willkommen!' : 'Neues Kind', first ? null : '#/profiles');
  let avatar = profiles.AVATARS[0];
  view.innerHTML = `
    <form class="card form welcome" autocomplete="off">
      ${first ? '<p class="lead">Schön, dass du da bist! Wer lernt hier?</p>' : ''}
      <label class="field"><span>Vorname</span><input name="name" required maxlength="20" placeholder="z. B. Lena"></label>
      <div class="field"><span>Wähle dein Tier</span>
        <div class="avatars">${profiles.AVATARS.map((a, i) => `<button type="button" class="avatar${i ? '' : ' on'}" data-a="${a}" aria-label="${a}">${a}</button>`).join('')}</div>
      </div>
      <label class="field"><span>Deine Klasse</span>
        <select name="grade">${STAGES.map((s) => `<optgroup label="${s.name}">${s.grades.map((g) => `<option value="${g}">${classLabel(g)}</option>`).join('')}</optgroup>`).join('')}</select>
      </label>
      <button class="btn primary">Los geht's</button>
    </form>`;
  const form = view.querySelector('form');
  form.querySelectorAll('.avatar').forEach((b) => {
    b.onclick = () => {
      form.querySelectorAll('.avatar').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      avatar = b.dataset.a;
    };
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    state.profile = await profiles.create({ name: form.name.value, avatar, grade: Number(form.grade.value) });
    applyTheme();
    location.hash = '#/';
  };
}

async function profilesView() {
  setHeader('Wer lernt?', state.profile ? '#/' : null);
  const list = await profiles.list();
  view.innerHTML = `
    <div class="grid profiles">
      ${list.map((p) => `
        <button class="tile profile-tile${p.id === state.profile?.id ? ' current' : ''}" data-id="${p.id}">
          <span class="big-emoji">${esc(p.avatar)}</span>
          <span class="name">${esc(p.name)}</span>
          <span class="small">${classLabel(p.grade)}</span>
        </button>`).join('')}
      <a class="tile profile-tile add" href="#/welcome"><span class="big-emoji">➕</span><span class="name">Neues Kind</span></a>
    </div>`;
  view.querySelectorAll('.profile-tile[data-id]').forEach((b) => {
    b.onclick = async () => {
      await profiles.select(b.dataset.id);
      state.profile = await profiles.current();
      applyTheme();
      location.hash = '#/';
    };
  });
}

async function homeView() {
  const p = state.profile;
  setHeader('Vokabeltrainer');
  const { today, streak, goal } = await todayStats(p);
  const due = await srs.dueWords(p.id, state.lang, 200);
  const learned = (await srs.allProgress(p.id)).filter(srs.isLearned).length;
  const tasks = (await Promise.all((p.tasks || []).map((id) => db.get('topics', id)))).filter(Boolean);
  const mine = sortTopics(await db.topicsFor(state.lang, p.grade));
  const hello = p.grade <= 4 ? `Hallo ${esc(p.name)}! 👋` : `Hi ${esc(p.name)}!`;
  view.innerHTML = `
    <div class="hello">
      <a class="me" href="#/profiles" aria-label="Kind wechseln">${esc(p.avatar)}</a>
      <div>
        <h2>${hello}</h2>
        <p class="hint">${today >= goal ? 'Tagesziel geschafft! 🎉' : today ? `Noch ${goal - today} Antworten bis zum Tagesziel.` : 'Bereit für heute?'}</p>
      </div>
    </div>
    <div class="stats-row">
      <div class="stat">${goalRing(today, goal)}<span>Tagesziel<br><b>${Math.min(today, goal)}/${goal}</b></span></div>
      <div class="stat"><span class="stat-big">🔥 ${streak}</span><span>${streak === 1 ? 'Tag' : 'Tage'} in Folge</span></div>
      <div class="stat"><span class="stat-big">📚 ${learned}</span><span>Wörter gelernt</span></div>
    </div>
    ${due.length ? `
      <a class="card cta" href="#/review">
        <span class="emoji" aria-hidden="true">🔁</span>
        <span><strong>Heute wiederholen</strong><small>${due.length} ${due.length === 1 ? 'Wort wartet' : 'Wörter warten'} auf dich</small></span>
        <span class="go" aria-hidden="true">›</span>
      </a>` : ''}
    ${tasks.length ? `<h3 class="section">📌 Aufgaben</h3>${await topicTiles(tasks)}` : ''}
    <h3 class="section">${classLabel(p.grade)}</h3>
    ${mine.length ? await topicTiles(mine) : '<p class="empty">Für diese Klasse gibt es noch keine Themen.</p>'}
    <a class="btn more-link" href="#/grades">Andere Klasse ansehen</a>
  `;
}

async function gradesView() {
  setHeader('Alle Klassen', '#/');
  view.innerHTML = `
    ${STAGES.map((s) => `
      <section class="stage stage-${s.id}">
        <h2><span class="badge">${s.short}</span> ${s.name}</h2>
        <div class="grid grades">
          ${s.grades.map((g) => `
            <a class="tile grade-tile${g === state.profile.grade ? ' current' : ''}" href="#/grade/${g}">
              <span class="big">${g <= 4 ? g : g - 4}</span>
              <span class="small">Klasse</span>
            </a>`).join('')}
        </div>
      </section>`).join('')}
  `;
}

async function gradeView(grade) {
  const stage = stageOf(grade);
  setHeader(classLabel(grade), '#/grades');
  const topics = sortTopics(await db.topicsFor(state.lang, grade));
  view.innerHTML = `
    <p class="lead"><span class="badge">${stage.short}</span> ${stage.name} · Schulstufe ${grade}</p>
    ${topics.length ? await topicTiles(topics) : '<p class="empty">Für diese Klasse gibt es noch keine Themen.</p>'}
  `;
}

function modePicker(p) {
  return `
    <div class="modes" role="radiogroup" aria-label="Übungsart">
      ${MODES.map((m) => `
        <label class="mode">
          <input type="radio" name="mode" value="${m.id}"${m.id === p.mode ? ' checked' : ''}>
          <span><b>${m.icon}</b>${m.name}</span>
        </label>`).join('')}
    </div>
    <div class="segmented" role="radiogroup" aria-label="Richtung">
      <label><input type="radio" name="dir" value="en-de"${p.direction !== 'de-en' ? ' checked' : ''}><span>Englisch → Deutsch</span></label>
      <label><input type="radio" name="dir" value="de-en"${p.direction === 'de-en' ? ' checked' : ''}><span>Deutsch → Englisch</span></label>
    </div>`;
}

function wireModePicker() {
  view.querySelectorAll('input[name=mode]').forEach((el) => el.addEventListener('change', () => {
    state.profile.mode = el.value; profiles.save(state.profile);
  }));
  view.querySelectorAll('input[name=dir]').forEach((el) => el.addEventListener('change', () => {
    state.profile.direction = el.value; profiles.save(state.profile);
  }));
}

async function topicView(topicId) {
  const topic = await db.get('topics', topicId);
  if (!topic) { location.hash = '#/'; return; }
  const p = state.profile;
  const words = (await db.vocabFor(topicId)).sort((a, b) => a.term.localeCompare(b.term, 'en'));
  const progress = await srs.progressMap(p.id, words);
  const repeat = words.filter((w) => srs.needsRepeat(progress.get(w.id))).length;
  const learned = words.filter((w) => srs.isLearned(progress.get(w.id))).length;
  const back = topic.grade === p.grade ? '#/' : `#/grade/${topic.grade}`;
  setHeader(topic.title, back);
  view.innerHTML = `
    <div class="topic-head">
      <span class="emoji big-emoji" aria-hidden="true">${esc(topic.icon || '📘')}</span>
      <div>
        ${starStr(srs.stars(words, progress))}
        <p class="lead">${learned} von ${words.length} Wörtern gelernt</p>
      </div>
    </div>
    ${modePicker(p)}
    <div class="stack wide">
      ${words.length ? `<a class="btn primary big" href="#/learn/${encodeURIComponent(topicId)}">Los geht's!</a>` : ''}
      ${repeat ? `<a class="btn" href="#/learn/${encodeURIComponent(topicId)}/repeat">↺ ${repeat} ${repeat === 1 ? 'Fehler' : 'Fehler'} wiederholen</a>` : ''}
    </div>
    <ul class="wordlist">
      ${words.map((w) => {
        const pr = progress.get(w.id);
        const mark = srs.needsRepeat(pr) ? '<span class="dot wrong" title="wiederholen"></span>'
          : srs.isLearned(pr) ? '<span class="dot right" title="gelernt"></span>' : '<span class="dot"></span>';
        return `<li>${mark}<span class="term">${esc(w.term)}</span><span class="trans">${esc(w.translation)}</span></li>`;
      }).join('')}
    </ul>
    <p class="hint legend"><span class="dot right"></span> gelernt <span class="dot wrong"></span> wiederholen <span class="dot"></span> neu</p>
  `;
  wireModePicker();
}

async function finishExtra(topicId) {
  const p = state.profile;
  const { today, streak, goal } = await todayStats(p);
  let starsHtml = '';
  if (topicId) {
    const words = await db.vocabFor(topicId);
    starsHtml = `<div class="finish-stat">${starStr(srs.stars(words, await srs.progressMap(p.id, words)))}<span>Sterne im Thema</span></div>`;
  }
  return `
    <div class="finish-stats">
      ${starsHtml}
      <div class="finish-stat"><b>🔥 ${streak}</b><span>${streak === 1 ? 'Tag' : 'Tage'} in Folge</span></div>
      <div class="finish-stat"><b>${Math.min(today, goal)}/${goal}</b><span>${today >= goal ? 'Tagesziel geschafft!' : 'Tagesziel'}</span></div>
    </div>`;
}

async function learnView(topicId, onlyRepeat) {
  const topic = await db.get('topics', topicId);
  if (!topic) { location.hash = '#/'; return; }
  const back = `#/topic/${encodeURIComponent(topicId)}`;
  setHeader(topic.title, back);
  const p = state.profile;
  let words = await db.vocabFor(topicId);
  if (onlyRepeat) {
    const progress = await srs.progressMap(p.id, words);
    const missed = words.filter((w) => srs.needsRepeat(progress.get(w.id)));
    if (missed.length) words = missed;
  }
  // Wrong options for "Auswählen" come from the same class if the topic is small.
  const pool = words.length < 8 ? (await Promise.all((await db.topicsFor(topic.lang, topic.grade)).map((t) => db.vocabFor(t.id)))).flat() : [];
  await runSession(view, {
    profile: p, words, pool, mode: p.mode, direction: p.direction, topicId, autoSpeak: p.autoSpeak,
    onExit: () => { location.hash = back; },
    onFinish: () => finishExtra(topicId),
  });
}

async function reviewView() {
  setHeader('Heute wiederholen', '#/');
  const p = state.profile;
  const words = await srs.dueWords(p.id, state.lang, 20);
  if (!words.length) {
    view.innerHTML = '<p class="empty">Heute ist nichts mehr fällig. 🎉<br><a class="btn" href="#/">Zurück</a></p>';
    return;
  }
  const pool = words.length < 8 ? (await Promise.all((await db.topicsFor(state.lang, p.grade)).map((t) => db.vocabFor(t.id)))).flat() : [];
  await runSession(view, {
    profile: p, words, pool, mode: p.mode, direction: p.direction, autoSpeak: p.autoSpeak,
    onExit: () => { location.hash = '#/'; },
    onFinish: () => finishExtra(null),
  });
}

async function settingsView() {
  const p = state.profile;
  setHeader('Einstellungen', '#/');
  view.innerHTML = `
    <section class="card">
      <h2>Design für ${esc(p.name)}</h2>
      <div class="choices">
        ${THEMES.map((t) => `
          <label class="choice">
            <input type="radio" name="theme" value="${t.id}"${t.id === (p.theme || 'auto') ? ' checked' : ''}>
            <span><strong>${t.name}</strong><small>${t.hint}</small></span>
          </label>`).join('')}
      </div>
    </section>
    <section class="card">
      <h2>Aussprache</h2>
      <label class="choice">
        <input type="checkbox" name="speak"${p.autoSpeak ? ' checked' : ''}>
        <span><strong>Englische Wörter automatisch vorlesen</strong><small>Mit 🔊 kann man jedes Wort auch selbst anhören.</small></span>
      </label>
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
    <a class="btn more-link" href="#/profiles">👥 Kind wechseln</a>
    <a class="btn more-link parents-link" href="#/parents">🔒 Elternbereich</a>
  `;
  view.querySelectorAll('input[name=theme]').forEach((el) => el.addEventListener('change', async () => {
    p.theme = el.value; await profiles.save(p); applyTheme();
  }));
  view.querySelector('input[name=speak]').addEventListener('change', async (e) => {
    p.autoSpeak = e.target.checked; await profiles.save(p);
  });
  view.querySelectorAll('input[name=lang]').forEach((el) => el.addEventListener('change', async () => {
    state.lang = el.value;
    await db.setMeta('lang', state.lang);
    await seed(state.lang);
  }));
}

// ---- Router ----------------------------------------------------------

const routes = [
  [/^#\/welcome$/, () => welcomeView(false)],
  [/^#\/profiles$/, () => profilesView()],
  [/^#\/grades$/, () => gradesView()],
  [/^#\/grade\/(\d+)$/, (m) => gradeView(Number(m[1]))],
  [/^#\/topic\/(.+)$/, (m) => topicView(decodeURIComponent(m[1]))],
  [/^#\/learn\/([^/]+)\/repeat$/, (m) => learnView(decodeURIComponent(m[1]), true)],
  [/^#\/learn\/([^/]+)$/, (m) => learnView(decodeURIComponent(m[1]), false)],
  [/^#\/review$/, () => reviewView()],
  [/^#\/settings$/, () => settingsView()],
  [/^#\/parents(.*)$/, (m) => parentsRoute({ view, setHeader, lang: state.lang, grade: state.profile?.grade, refresh: refreshProfile }, m[1])],
];

async function refreshProfile() {
  state.profile = await profiles.current();
  applyTheme();
}

async function route() {
  const hash = location.hash || '#/';
  // Leaving the parents area locks it again, so kids can't just tap back in.
  if (!hash.startsWith('#/parents')) lock();
  document.getElementById('settings-btn').hidden = !state.profile || hash.startsWith('#/parents');
  if (!state.profile && !hash.startsWith('#/parents')) {
    await welcomeView(true);
  } else {
    let matched = false;
    for (const [re, fn] of routes) {
      const m = hash.match(re);
      if (m) { await fn(m); matched = true; break; }
    }
    if (!matched) await homeView();
  }
  document.getElementById('settings-btn').hidden = !state.profile || hash.startsWith('#/parents');
  view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

async function start() {
  state.lang = await db.getMeta('lang', 'en');
  state.profile = await profiles.current();
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
