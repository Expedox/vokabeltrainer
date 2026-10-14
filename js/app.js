import * as db from './db.js';
import * as srs from './srs.js';
import * as profiles from './profiles.js';
import { LANGUAGES, seed } from './seed.js';
import { esc, plain, STAGES, THEMES, stageOf, classLabel, isAdult, LEVELS, levelGrade, gradesOf, gradesBelow } from './util.js';
import { parentsRoute, lock } from './parents.js';
import { runSession, MODES } from './learn.js';
import { isSentence } from './sentences.js';
import * as exams from './exams.js';
import { placementView } from './placement.js';
import { grammarListView, grammarChapterView } from './grammar.js';
import { dialogListView, dialogView } from './dialogs.js';
import { selfStatsView } from './child.js';

const state = { lang: 'en', profile: null };

// Topics of a class, or of a level (its own topics plus the school words of that level).
async function topicsForGrade(grade) {
  return (await Promise.all(gradesOf(grade).map((g) => db.topicsFor(state.lang, g)))).flat();
}
const KID_STAGES = STAGES.filter((s) => s.id !== 'er');
const ADULT_STAGE = STAGES.find((s) => s.id === 'er');
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
    const items = await db.vocabFor(t.id, 'all');
    const words = items.filter((v) => !isSentence(v));
    const progress = await srs.progressMap(state.profile.id, words);
    return { t, count: words.length, sentences: items.length - words.length, stars: srs.stars(words, progress) };
  }));
  return `
    <div class="grid topics">
      ${rows.map(({ t, count, sentences, stars }) => `
        <a class="tile topic-tile" href="#/topic/${encodeURIComponent(t.id)}">
          <span class="emoji" aria-hidden="true">${esc(t.icon || '📘')}</span>
          <span class="name">${esc(t.title)}</span>
          ${starStr(stars)}
          <span class="small">${count} Wörter${sentences ? ` · ${sentences} Sätze` : ''}${t.builtin ? '' : ' · eigene'}</span>
        </a>`).join('')}
    </div>`;
}

const sortTopics = (list) => list.sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.title.localeCompare(b.title, 'de'));

async function todayStats(profile) {
  const days = srs.perDay(await srs.sessionsFor(profile.id));
  const row = days.get(srs.dayKey(Date.now()));
  const today = row?.answers ?? 0;
  const minutes = Math.round((row?.ms ?? 0) / 60000);
  // Adults set their daily goal in minutes, children in answers.
  const goal = isAdult(profile.grade) ? profile.dailyMinutes || profiles.DEFAULT_MINUTES : profile.dailyGoal || profiles.DEFAULT_GOAL;
  return { today, minutes, streak: srs.streak(days), goal };
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
  setHeader(first ? 'Willkommen!' : 'Neues Profil', first ? null : '#/profiles');
  let avatar = profiles.AVATARS[0];
  view.innerHTML = `
    <form class="card form welcome" autocomplete="off">
      ${first ? '<p class="lead">Schön, dass du da bist! Wer lernt hier?</p>' : ''}
      <label class="field"><span>Vorname</span><input name="name" required maxlength="20" placeholder="z. B. Lena"></label>
      <div class="field"><span>Wähle dein Bild</span>
        <div class="avatars">${profiles.AVATARS.map((a, i) => `<button type="button" class="avatar${i ? '' : ' on'}" data-a="${a}" aria-label="${a}">${a}</button>`).join('')}</div>
      </div>
      <div class="segmented" role="radiogroup" aria-label="Wer lernt?">
        <label><input type="radio" name="who" value="kid" checked><span>Kind oder Schüler/in</span></label>
        <label><input type="radio" name="who" value="adult"><span>Erwachsene/r</span></label>
      </div>
      <label class="field"><span id="grade-label">Deine Klasse</span>
        <select name="grade"></select>
      </label>
      <button class="btn primary">Los geht's</button>
    </form>`;
  const form = view.querySelector('form');
  const fillGrades = () => {
    const adult = form.who.value === 'adult';
    form.querySelector('#grade-label').textContent = adult ? 'Dein Englisch-Niveau' : 'Deine Klasse';
    form.grade.innerHTML = adult
      ? `<option value="test">Weiß ich nicht: kurzer Einstufungstest</option>${ADULT_STAGE.grades.map((g) => `<option value="${g}">${LEVELS[g]} ${['Anfänger', 'Grundkenntnisse', 'Mittelstufe', 'Gute Mittelstufe, UNIcert II'][g - 21]}</option>`).join('')}`
      : KID_STAGES.map((s) => `<optgroup label="${s.name}">${s.grades.map((g) => `<option value="${g}">${classLabel(g)}</option>`).join('')}</optgroup>`).join('');
  };
  fillGrades();
  form.querySelectorAll('input[name=who]').forEach((el) => el.addEventListener('change', fillGrades));
  form.querySelectorAll('.avatar').forEach((b) => {
    b.onclick = () => {
      form.querySelectorAll('.avatar').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      avatar = b.dataset.a;
    };
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const test = form.grade.value === 'test';
    state.profile = await profiles.create({ name: form.name.value, avatar, grade: test ? 21 : Number(form.grade.value) });
    applyTheme();
    location.hash = test ? '#/placement' : '#/';
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
      <a class="tile profile-tile add" href="#/welcome"><span class="big-emoji">➕</span><span class="name">Neues Profil</span></a>
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
  const { today, streak, goal, minutes } = await todayStats(p);
  const adult = isAdult(p.grade);
  const due = await srs.dueWords(p.id, state.lang, 200);
  const learned = (await srs.allProgress(p.id)).filter(srs.isLearned).length;
  const tasks = (await Promise.all((p.tasks || []).map((id) => db.get('topics', id)))).filter(Boolean);
  const mine = sortTopics(await topicsForGrade(p.grade));
  const weak = srs.weakestMode(srs.modeStats(await srs.sessionsFor(p.id)));
  const weakMode = weak && weak.mode !== p.mode && !p.taskMode ? MODES.find((m) => m.id === weak.mode) : null;
  const taskMode = p.taskMode && MODES.find((m) => m.id === p.taskMode);
  const hello = p.grade <= 4 ? `Hallo ${esc(p.name)}! 👋` : adult ? `Hallo ${esc(p.name)}` : `Hi ${esc(p.name)}!`;
  const goalDone = adult ? minutes : today;
  view.innerHTML = `
    <div class="hello">
      <a class="me" href="#/profiles" aria-label="Benutzer wechseln">${esc(p.avatar)}</a>
      <div>
        <h2>${hello}</h2>
        <p class="hint">${goalDone >= goal ? `Tagesziel geschafft!${adult ? '' : ' 🎉'}` : goalDone ? `Noch ${goal - goalDone} ${adult ? 'Minuten' : 'Antworten'} bis zum Tagesziel.` : 'Bereit für heute?'}</p>
      </div>
    </div>
    <div class="stats-row">
      <div class="stat">${goalRing(goalDone, goal)}<span>Tagesziel<br><b>${Math.min(goalDone, goal)}/${goal}${adult ? ' Min.' : ''}</b></span></div>
      <div class="stat"><span class="stat-big">🔥 ${streak}</span><span>${streak === 1 ? 'Tag' : 'Tage'} in Folge</span></div>
      <div class="stat"><span class="stat-big">📚 ${learned}</span><span>Wörter gelernt</span></div>
    </div>
    ${taskMode ? `<p class="card nudge">📌 Aufgabe: Übe mit <b>${taskMode.icon} ${taskMode.name}</b>.</p>` : ''}
    ${weakMode ? `<div class="card nudge">
      <span>${weakMode.icon} <b>${weakMode.name}</b> klappt erst zu ${weak.rate} %. Heute ${weakMode.name} üben?</span>
      <button class="btn primary" id="take-weak" data-mode="${weakMode.id}">Ja, ${weakMode.name}</button>
    </div>` : ''}
    <h3 class="section">So übe ich</h3>
    ${modePicker(p)}
    ${(await Promise.all(exams.upcoming(p).map(async (e) => {
      const st = await exams.status(p, e, state.lang);
      const d = srs.daysUntil(e.date);
      return `<a class="card exam-card" href="#/exam/${encodeURIComponent(e.id)}">
        <span class="exam-count"><b>${d > 0 ? d : d === 0 ? '!' : '✓'}</b><small>${d > 1 ? 'Tage' : d === 1 ? 'Tag' : d === 0 ? 'heute' : 'vorbei'}</small></span>
        <span class="exam-main"><strong>📅 ${esc(e.title)} ${exams.countdown(e)}</strong>
          <small>${st.ready} % sitzen schon${d >= 0 ? ` · heute ${st.portion} Wörter üben` : ''}</small>
          <span class="tp-bar"><span style="width:${st.ready}%"></span></span>
        </span>
        <span class="go" aria-hidden="true">›</span>
      </a>`;
    }))).join('')}
    ${due.length ? `
      <a class="card cta" href="#/review">
        <span class="emoji" aria-hidden="true">🔁</span>
        <span><strong>Heute wiederholen</strong><small>${due.length} ${due.length === 1 ? 'Wort wartet' : 'Wörter warten'} auf dich</small></span>
        <span class="go" aria-hidden="true">›</span>
      </a>` : ''}
    ${tasks.length ? `<h3 class="section">📌 Aufgaben</h3>${await topicTiles(tasks)}` : ''}
    <h3 class="section">${classLabel(p.grade)}</h3>
    ${mine.length > 1 ? `<a class="card cta soft" href="#/mix/${p.grade}">
      <span class="emoji" aria-hidden="true">🎯</span>
      <span><strong>${adult ? 'Ganzes Niveau üben' : 'Ganze Klasse üben'}</strong><small>${adult ? 'Alle Themen gemischt, die unsichersten zuerst' : 'Alle Themen gemischt, z. B. vor einer Schularbeit'}</small></span>
      <span class="go" aria-hidden="true">›</span>
    </a>` : ''}
    ${mine.length ? await topicTiles(mine) : '<p class="empty">Für diese Klasse gibt es noch keine Themen.</p>'}
    ${adult ? `<div class="stack wide">
      <a class="btn primary" href="#/dialogs">✈️ Situationen: Urlaub und Alltag</a>
      <a class="btn" href="#/grammar">📐 Grammatik</a>
      <a class="btn" href="#/stats">📊 Meine Statistik</a>
      <a class="btn" href="#/placement">🧭 Niveau prüfen (Einstufungstest)</a>
    </div>` : ''}
    <a class="btn more-link" href="#/grades">${adult ? 'Anderes Niveau ansehen' : 'Andere Klasse ansehen'}</a>
  `;
  wireModePicker();
  view.querySelector('#take-weak')?.addEventListener('click', async (e) => {
    p.mode = e.target.dataset.mode;
    await profiles.save(p);
    homeView();
  });
}

async function gradesView() {
  const adult = isAdult(state.profile.grade);
  setHeader(adult ? 'Alle Niveaus' : 'Alle Klassen', '#/');
  // Adults see their levels first, then the school classes.
  view.innerHTML = `
    ${(adult ? [ADULT_STAGE, ...KID_STAGES] : KID_STAGES).map((s) => `
      <section class="stage stage-${s.id}">
        <h2><span class="badge">${s.short}</span> ${s.name}</h2>
        <div class="grid grades">
          ${s.grades.map((g) => `
            <a class="tile grade-tile${g === state.profile.grade ? ' current' : ''}" href="#/grade/${g}">
              <span class="big">${isAdult(g) ? LEVELS[g] : g <= 4 ? g : g - 4}</span>
              <span class="small">${isAdult(g) ? 'Niveau' : 'Klasse'}</span>
            </a>`).join('')}
        </div>
      </section>`).join('')}
  `;
}

async function gradeView(grade) {
  const stage = stageOf(grade);
  setHeader(classLabel(grade), '#/grades');
  const topics = sortTopics(await topicsForGrade(grade));
  view.innerHTML = `
    <p class="lead"><span class="badge">${stage.short}</span> ${stage.name} · Schulstufe ${grade}</p>
    ${topics.length > 1 ? `<a class="card cta soft" href="#/mix/${grade}">
      <span class="emoji" aria-hidden="true">🎯</span>
      <span><strong>${isAdult(grade) ? 'Ganzes Niveau üben' : 'Ganze Klasse üben'}</strong><small>Alle oder ausgewählte Themen gemischt</small></span>
      <span class="go" aria-hidden="true">›</span>
    </a>` : ''}
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
    <p class="hint mode-hint" id="mode-hint">${esc(MODES.find((m) => m.id === p.mode)?.hint ?? '')}</p>
    <div class="segmented" id="dir-picker"${MODES.find((m) => m.id === p.mode)?.english ? ' hidden' : ''} role="radiogroup" aria-label="Richtung">
      <label><input type="radio" name="dir" value="en-de"${p.direction !== 'de-en' ? ' checked' : ''}><span>Englisch → Deutsch</span></label>
      <label><input type="radio" name="dir" value="de-en"${p.direction === 'de-en' ? ' checked' : ''}><span>Deutsch → Englisch</span></label>
    </div>`;
}

function wireModePicker() {
  view.querySelectorAll('input[name=mode]').forEach((el) => el.addEventListener('change', () => {
    state.profile.mode = el.value; profiles.save(state.profile);
    const m = MODES.find((x) => x.id === el.value);
    view.querySelector('#mode-hint').textContent = m.hint;
    // Spelling and speaking are always about the English word.
    view.querySelector('#dir-picker').hidden = Boolean(m.english);
  }));
  view.querySelectorAll('input[name=dir]').forEach((el) => el.addEventListener('change', () => {
    state.profile.direction = el.value;
    profiles.save(state.profile);
  }));
}

async function topicView(topicId) {
  const topic = await db.get('topics', topicId);
  if (!topic) { location.hash = '#/'; return; }
  const p = state.profile;
  const words = (await db.vocabFor(topicId)).sort((a, b) => a.term.localeCompare(b.term, 'en'));
  const sentenceCount = (await db.vocabFor(topicId, 'sentence')).length;
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
        <p class="lead">${learned} von ${words.length} Wörtern gelernt${sentenceCount ? `<br>💬 ${sentenceCount} Sätze zum Üben` : ''}</p>
      </div>
    </div>
    ${modePicker(p)}
    <div class="stack wide">
      ${words.length ? `<a class="btn primary big" href="#/learn/${encodeURIComponent(topicId)}">Los geht's!</a>` : ''}
      ${repeat ? `<a class="btn" href="#/learn/${encodeURIComponent(topicId)}/repeat">↺ ${repeat} ${repeat === 1 ? 'Fehler' : 'Fehler'} wiederholen</a>` : ''}
    </div>
    <ul class="wordlist" id="words"></ul>
    <p class="hint legend"><span class="dot right"></span> gelernt <span class="dot wrong"></span> wiederholen <span class="dot"></span> neu</p>
  `;
  wireModePicker();
  // The list follows the chosen direction, so it previews what the cards will ask.
  const list = view.querySelector('#words');
  const drawList = () => {
    const deEn = state.profile.direction === 'de-en';
    const sorted = words.slice().sort((a, b) => (deEn ? plain(a.translation, 'de').localeCompare(plain(b.translation, 'de'), 'de') : plain(a.term, 'en').localeCompare(plain(b.term, 'en'), 'en')));
    list.innerHTML = sorted.map((w) => {
      const pr = progress.get(w.id);
      const mark = srs.needsRepeat(pr) ? '<span class="dot wrong" title="wiederholen"></span>'
        : srs.isLearned(pr) ? '<span class="dot right" title="gelernt"></span>' : '<span class="dot"></span>';
      const [a, b] = deEn ? [plain(w.translation, 'de'), plain(w.term, 'en')] : [plain(w.term, 'en'), plain(w.translation, 'de')];
      return `<li>${mark}<span class="term">${w.icon ? `${esc(w.icon)} ` : ''}${esc(a)}</span><span class="trans">${esc(b)}</span></li>`;
    }).join('');
  };
  drawList();
  view.querySelectorAll('input[name=dir]').forEach((el) => el.addEventListener('change', drawList));
}

// Exam practice: several (by default all) topics of one class in one round.
const MIX_SIZES = [20, 50, 100, 0];

async function mixView(grade) {
  const p = state.profile;
  const back = grade === p.grade ? '#/' : `#/grade/${grade}`;
  setHeader(`${classLabel(grade)} üben`, back);
  const topics = sortTopics(await topicsForGrade(grade));
  const counts = await Promise.all(topics.map(async (t) => (await db.vocabFor(t.id)).length));
  const saved = await db.getMeta(`mix:${p.id}:${grade}`, null);
  const chosen = new Set(saved?.topics ?? topics.map((t) => t.id));
  const size = saved?.size ?? 50;
  view.innerHTML = `
    <form class="form mix">
      <section class="card">
        <div class="row between"><h2>Themen</h2><button type="button" class="link-btn" id="toggle-all">Alle an/aus</button></div>
        <div class="choices">
          ${topics.map((t, i) => `<label class="choice"><input type="checkbox" name="t" value="${esc(t.id)}"${chosen.has(t.id) ? ' checked' : ''}><span><strong>${esc(t.icon || '📘')} ${esc(t.title)}</strong><small>${counts[i]} Wörter</small></span></label>`).join('')}
        </div>
      </section>
      ${gradesBelow(grade).length ? `<label class="choice card"><input type="checkbox" name="prev"${saved?.prev ? ' checked' : ''}><span><strong>${isAdult(grade) ? 'Auch alle niedrigeren Niveaus' : 'Auch alle früheren Klassen'}</strong><small>Gesamter Stoff bis ${classLabel(grade)}, die unsichersten Wörter zuerst</small></span></label>` : ''}
      <section class="card">
        <h2>Wie viele Wörter?</h2>
        <div class="segmented">
          ${MIX_SIZES.map((n) => `<label><input type="radio" name="size" value="${n}"${n === size ? ' checked' : ''}><span>${n || 'Alle'}</span></label>`).join('')}
        </div>
        <p class="hint" id="mix-info"></p>
      </section>
      ${modePicker(p)}
      <button class="btn primary big sticky-save">Los geht's!</button>
    </form>`;
  wireModePicker();
  const form = view.querySelector('form');
  const info = view.querySelector('#mix-info');
  const selected = () => [...form.querySelectorAll('input[name=t]:checked')].map((el) => el.value);
  const below = new Set(gradesBelow(grade));
  const earlier = (await db.all('topics')).filter((t) => t.lang === state.lang && below.has(t.grade));
  const earlierCount = (await Promise.all(earlier.map((t) => db.vocabFor(t.id)))).reduce((n, l) => n + l.length, 0);
  const update = () => {
    const ids = new Set(selected());
    const prev = form.prev?.checked;
    const total = topics.reduce((n, t, i) => n + (ids.has(t.id) ? counts[i] : 0), 0) + (prev ? earlierCount : 0);
    const n = Number(new FormData(form).get('size'));
    info.textContent = total
      ? `${ids.size} Themen${prev ? ` + ${earlier.length} aus früheren Klassen` : ''} mit ${total} Wörtern. ${n && n < total ? `Diese Runde: ${n} Wörter, zuerst die, die noch nicht sitzen.` : 'Diese Runde: alle Wörter.'}`
      : 'Bitte mindestens ein Thema wählen.';
  };
  form.addEventListener('change', update);
  update();
  view.querySelector('#toggle-all').onclick = () => {
    const boxes = [...form.querySelectorAll('input[name=t]')];
    const on = !boxes.every((b) => b.checked);
    boxes.forEach((b) => { b.checked = on; });
    update();
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const prev = !!form.prev?.checked;
    const ids = [...selected(), ...(prev ? earlier.map((t) => t.id) : [])];
    if (!ids.length) return;
    const n = Number(new FormData(form).get('size'));
    await db.setMeta(`mix:${p.id}:${grade}`, { topics: selected(), size: n, prev });
    let words = (await Promise.all(ids.map((id) => db.vocabFor(id, p.mode === 'sentences' ? 'sentence' : 'word')))).flat();
    const progress = await srs.progressMap(p.id, words);
    words = srs.byNeed(words, progress);
    if (n) words = words.slice(0, n);
    const label = `🎯 ${classLabel(grade)} (${prev ? 'mit früheren Klassen' : selected().length === topics.length ? 'alle Themen' : `${selected().length} Themen`})`;
    await runSession(view, {
      profile: p, words, mode: p.mode, direction: p.direction, autoSpeak: p.autoSpeak, label,
      onExit: () => { location.hash = back; },
      onFinish: () => finishExtra(null),
    });
  };
}

async function examView(id) {
  const p = state.profile;
  const exam = (p.exams || []).find((e) => e.id === id);
  if (!exam) { location.hash = '#/'; return; }
  setHeader(exam.title, '#/');
  const st = await exams.status(p, exam, state.lang);
  const d = srs.daysUntil(exam.date);
  const last = exam.results?.at(-1);
  view.innerHTML = `
    <div class="exam-hero">
      <div class="exam-big">${d > 0 ? d : d === 0 ? '🎯' : '✓'}</div>
      <p class="lead">${d > 1 ? 'Tage bis' : d === 1 ? 'Tag bis' : ''} ${esc(exam.title)} ${d <= 0 ? exams.countdown(exam) : ''}</p>
    </div>
    <section class="card">
      <h2>So gut sitzt der Stoff</h2>
      <div class="tp-bar big-bar"><span style="width:${st.ready}%"></span></div>
      <p class="hint">${st.ready} % geschafft · ${st.solid} von ${st.total} Wörtern sitzen schon sicher.${last ? ` Letzte Probe-Prüfung: ${last.right}/${last.total} richtig.` : ''}</p>
    </section>
    <div class="stack wide">
      <a class="btn primary big" href="#/exam/${encodeURIComponent(id)}/prep">💪 Heute üben: ${st.portion} Wörter</a>
      <a class="btn big" href="#/exam/${encodeURIComponent(id)}/test">📝 Probe-Prüfung (${exam.size || st.total} Fragen)</a>
    </div>
    <p class="hint">Beim Üben kommen zuerst die Wörter, die noch nicht sitzen. Die Probe-Prüfung fragt zufällig, wie bei der echten Prüfung, und jedes Wort nur einmal.</p>
  `;
}

async function examRunView(id, kind) {
  const p = state.profile;
  const exam = (p.exams || []).find((e) => e.id === id);
  if (!exam) { location.hash = '#/'; return; }
  const back = `#/exam/${encodeURIComponent(id)}`;
  setHeader(kind === 'test' ? `Probe: ${exam.title}` : exam.title, back);
  const st = await exams.status(p, exam, state.lang);
  let words;
  if (kind === 'test') {
    words = st.words.map((w) => [w, Math.random()]).sort((a, b) => a[1] - b[1]).map(([w]) => w);
    if (exam.size) words = words.slice(0, exam.size);
  } else {
    words = srs.byNeed(st.words, st.progress).slice(0, st.portion);
  }
  await runSession(view, {
    profile: p, words, pool: st.words, direction: p.direction, autoSpeak: p.autoSpeak,
    mode: kind === 'test' ? exam.mode : p.mode,
    exam: kind === 'test',
    label: `${kind === 'test' ? '📝 Probe' : '📅 Vorbereitung'}: ${exam.title}`,
    onExit: () => { location.hash = back; },
    onFinish: async ({ total, missedIds }) => {
      if (kind === 'test') {
        const fresh = await db.get('profiles', p.id);
        const e = fresh.exams.find((x) => x.id === id);
        e.results = [...(e.results || []), { at: Date.now(), total, right: total - missedIds.length, missed: missedIds }];
        await profiles.save(fresh);
        state.profile = fresh;
        const score = Math.round(((total - missedIds.length) / total) * 100);
        const verdict = score >= 90 ? 'Du bist bestens vorbereitet! 🏆' : score >= 75 ? 'Schon richtig gut! Noch ein bisschen üben.' : score >= 50 ? 'Auf dem Weg. Übe die Fehler noch einmal.' : 'Da geht noch was. Übe jeden Tag ein bisschen.';
        return `<div class="finish-stats"><div class="finish-stat"><b>${score} %</b><span>richtig</span></div></div><p class="hint">${verdict}</p>`;
      }
      return finishExtra(null);
    },
  });
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
  let words = await db.vocabFor(topicId, p.mode === 'sentences' ? 'sentence' : 'word');
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
    ${isAdult(p.grade) ? `<section class="card form">
      <h2>Lernen</h2>
      <label class="field"><span>Niveau</span>
        <select name="level">${ADULT_STAGE.grades.map((g) => `<option value="${g}"${g === p.grade ? ' selected' : ''}>${LEVELS[g]}</option>`).join('')}</select>
      </label>
      <label class="field"><span>Tagesziel in Minuten</span>
        <select name="minutes">${[5, 10, 15, 20, 30, 45, 60].map((n) => `<option value="${n}"${n === (p.dailyMinutes || profiles.DEFAULT_MINUTES) ? ' selected' : ''}>${n} Minuten</option>`).join('')}</select>
      </label>
      <label class="choice">
        <input type="checkbox" name="strict"${p.strict ? ' checked' : ''}>
        <span><strong>Streng prüfen</strong><small>Tippfehler zählen als falsch, und ein Fehler muss zweimal richtig beantwortet werden.</small></span>
      </label>
      <a class="btn" href="#/placement">🧭 Einstufungstest machen</a>
    </section>` : ''}
    <section class="card">
      <h2>Aussprache</h2>
      <label class="choice">
        <input type="checkbox" name="speak"${p.autoSpeak ? ' checked' : ''}>
        <span><strong>Englisch automatisch vorlesen</strong><small>Wörter beim Anzeigen, beim Umdrehen und bei Fehlern auch den Beispielsatz. Mit 🔊 kann man alles selbst anhören.</small></span>
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
    <a class="btn more-link" href="#/profiles">👥 Benutzer wechseln</a>
    ${isAdult(p.grade) ? '' : '<a class="btn more-link parents-link" href="#/parents">🔒 Elternbereich</a>'}
  `;
  view.querySelector('select[name=level]')?.addEventListener('change', async (e) => { p.grade = Number(e.target.value); await profiles.save(p); });
  view.querySelector('select[name=minutes]')?.addEventListener('change', async (e) => { p.dailyMinutes = Number(e.target.value); await profiles.save(p); });
  view.querySelector('input[name=strict]')?.addEventListener('change', async (e) => { p.strict = e.target.checked; await profiles.save(p); });
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
  [/^#\/placement$/, () => placementView({ view, setHeader, lang: state.lang, refresh: refreshProfile }, state.profile)],
  [/^#\/grammar$/, () => grammarListView({ view, setHeader, lang: state.lang }, state.profile)],
  [/^#\/grammar\/(.+)$/, (m) => grammarChapterView({ view, setHeader, lang: state.lang }, state.profile, decodeURIComponent(m[1]))],
  [/^#\/dialogs$/, () => dialogListView({ view, setHeader, lang: state.lang }, state.profile)],
  [/^#\/dialog\/(.+)$/, (m) => dialogView({ view, setHeader, lang: state.lang }, state.profile, decodeURIComponent(m[1]))],
  [/^#\/stats$/, () => selfStatsView({ view, setHeader, lang: state.lang }, state.profile)],
  [/^#\/mix\/(\d+)$/, (m) => mixView(Number(m[1]))],
  [/^#\/exam\/([^/]+)\/(prep|test)$/, (m) => examRunView(decodeURIComponent(m[1]), m[2])],
  [/^#\/exam\/([^/]+)$/, (m) => examView(decodeURIComponent(m[1]))],
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
  // First start or new word lists: loading thousands of entries takes a moment.
  view.innerHTML = '<p class="empty">Wörter werden geladen …</p>';
  await seed(state.lang);
  db.persist();
  window.addEventListener('hashchange', route);
  await route();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

start().catch((err) => {
  view.innerHTML = `<p class="empty">Fehler beim Starten: ${esc(err.message)}</p>`;
});
