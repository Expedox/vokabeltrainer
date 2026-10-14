// Planned exams (Schularbeit, Test): parents set date, topics and size; the
// child sees a countdown, gets a daily prep portion and can take a practice test.
//
// profile.exams: [{ id, title, date, grade, topics: [topicId], includePrev,
//                   size, mode, created, results: [{ at, total, right, missed: [vocabId] }] }]

import * as db from './db.js';
import * as srs from './srs.js';
import * as profiles from './profiles.js';
import { esc, plain, STAGES, classLabel } from './util.js';

export const SIZES = [20, 30, 50, 0];
const MIN_PORTION = 10;
const MAX_PORTION = 40;

const fmtDate = (t) => new Date(t).toLocaleDateString('de-AT', { weekday: 'short', day: 'numeric', month: 'numeric' });

export function countdown(exam) {
  const d = srs.daysUntil(exam.date);
  if (d > 1) return `in ${d} Tagen`;
  if (d === 1) return 'morgen';
  if (d === 0) return 'heute';
  return `war am ${fmtDate(exam.date)}`;
}

// Upcoming plus those up to 3 days past, soonest first.
export function upcoming(p) {
  return (p.exams || []).filter((e) => srs.daysUntil(e.date) >= -3).sort((a, b) => a.date - b.date);
}

export async function examTopics(exam, lang) {
  const all = (await db.all('topics')).filter((t) => t.lang === lang);
  const ids = new Set(exam.topics);
  return all.filter((t) => ids.has(t.id) || (exam.includePrev && t.grade < exam.grade));
}

// A sentence exam asks the topics' sentences, every other exam their words.
export async function examWords(exam, lang) {
  const kind = exam.mode === 'sentences' ? 'sentence' : 'word';
  return (await Promise.all((await examTopics(exam, lang)).map((t) => db.vocabFor(t.id, kind)))).flat();
}

// How ready the child is, and today's portion of words to practise.
export async function status(p, exam, lang) {
  const words = await examWords(exam, lang);
  const progress = await srs.progressMap(p.id, words);
  const solid = words.filter((w) => progress.get(w.id).box >= 2).length;
  const open = words.length - solid;
  // Readiness: a word answered right once counts half, twice or more counts full.
  const score = words.reduce((n, w) => n + Math.min(progress.get(w.id).box, 2) / 2, 0);
  const days = Math.max(1, srs.daysUntil(exam.date));
  const portion = Math.min(open || words.length, Math.max(MIN_PORTION, Math.min(MAX_PORTION, Math.ceil(open / days))));
  return { words, progress, solid, total: words.length, ready: words.length ? Math.round((score / words.length) * 100) : 0, portion };
}

export function bestResult(exam) {
  return (exam.results || []).reduce((best, r) => (!best || r.right / r.total > best.right / best.total ? r : best), null);
}

export const pct = (r) => Math.round((r.right / r.total) * 100);

// ---- Parents: plan / edit ----------------------------------------------

export async function examFormView(ctx, childId, examId) {
  const { view, lang } = ctx;
  const p = await db.get('profiles', childId);
  if (!p) { location.hash = '#/parents'; return; }
  const back = `#/parents/child/${encodeURIComponent(childId)}`;
  const existing = (p.exams || []).find((e) => e.id === examId);
  const exam = existing ?? {
    title: 'Schularbeit', date: srs.startOfDay(Date.now()) + 7 * 864e5, grade: p.grade,
    topics: null, includePrev: false, size: 30, mode: p.grade <= 4 ? 'choice' : 'write',
  };
  ctx.setHeader(existing ? 'Prüfung bearbeiten' : 'Prüfung planen', back);
  const toInput = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  view.innerHTML = `
    <form class="form">
      <section class="card form">
        <label class="field"><span>Was steht an?</span><input name="title" required maxlength="40" value="${esc(exam.title)}" placeholder="z. B. Schularbeit, Vokabeltest"></label>
        <label class="field"><span>Datum</span><input type="date" name="date" required value="${toInput(exam.date)}"></label>
        <label class="field"><span>Stoff aus Klasse</span>
          <select name="grade">${STAGES.map((s) => `<optgroup label="${s.name}">${s.grades.map((g) => `<option value="${g}"${g === exam.grade ? ' selected' : ''}>${classLabel(g)}</option>`).join('')}</optgroup>`).join('')}</select>
        </label>
        <label class="choice"><input type="checkbox" name="prev"${exam.includePrev ? ' checked' : ''}><span><strong>Auch alle früheren Klassen</strong><small>Für Prüfungen, bei denen alter Stoff dazukommt</small></span></label>
      </section>
      <section class="card">
        <div class="row between"><h2>Themen</h2><button type="button" class="link-btn" id="toggle-all">Alle an/aus</button></div>
        <div class="choices" id="topics"></div>
      </section>
      <section class="card form">
        <label class="field"><span>Fragen in der Probe-Prüfung</span>
          <select name="size">${SIZES.map((n) => `<option value="${n}"${n === exam.size ? ' selected' : ''}>${n || 'Alle Wörter'}</option>`).join('')}</select>
        </label>
        <label class="field"><span>Art der Prüfung</span>
          <select name="mode">
            <option value="write"${exam.mode === 'write' ? ' selected' : ''}>Schreiben (wie bei der Schularbeit)</option>
            <option value="choice"${exam.mode === 'choice' ? ' selected' : ''}>Auswählen</option>
            <option value="sentences"${exam.mode === 'sentences' ? ' selected' : ''}>Sätze (richtigen Satz finden und bauen)</option>
          </select>
        </label>
        <p class="hint" id="exam-info"></p>
      </section>
      <button class="btn primary big sticky-save">${existing ? 'Speichern' : 'Prüfung planen'}</button>
      ${existing ? '<button type="button" class="btn danger" id="delete">Prüfung löschen</button>' : ''}
    </form>`;

  const form = view.querySelector('form');
  const box = view.querySelector('#topics');
  const info = view.querySelector('#exam-info');
  let counts = new Map();

  async function drawTopics(keepChecked) {
    const grade = Number(form.grade.value);
    const list = (await db.topicsFor(lang, grade)).sort((a, b) => a.title.localeCompare(b.title, 'de'));
    counts = new Map(await Promise.all(list.map(async (t) => [t.id, (await db.vocabFor(t.id)).length])));
    const chosen = keepChecked ?? new Set(list.map((t) => t.id));
    box.innerHTML = list.map((t) => `<label class="choice"><input type="checkbox" name="t" value="${esc(t.id)}"${chosen.has(t.id) ? ' checked' : ''}><span><strong>${esc(t.icon || '📘')} ${esc(t.title)}</strong><small>${counts.get(t.id)} Wörter</small></span></label>`).join('');
    await updateInfo();
  }

  async function updateInfo() {
    const draft = { ...exam, mode: form.mode.value, grade: Number(form.grade.value), includePrev: form.prev.checked, topics: [...form.querySelectorAll('input[name=t]:checked')].map((el) => el.value) };
    const words = await examWords(draft, lang);
    const days = srs.daysUntil(new Date(form.date.value).getTime());
    info.textContent = words.length
      ? `${words.length} ${form.mode.value === 'sentences' ? 'Sätze' : 'Wörter'} Prüfungsstoff${days > 0 ? `, ${days} Tage Zeit: etwa ${Math.max(MIN_PORTION, Math.min(MAX_PORTION, Math.ceil(words.length / days)))} Wörter pro Tag.` : '.'}`
      : 'Bitte mindestens ein Thema wählen.';
  }

  form.grade.addEventListener('change', () => drawTopics());
  form.addEventListener('change', (e) => { if (e.target.name !== 'grade') updateInfo(); });
  view.querySelector('#toggle-all').onclick = () => {
    const boxes = [...box.querySelectorAll('input')];
    const on = !boxes.every((b) => b.checked);
    boxes.forEach((b) => { b.checked = on; });
    updateInfo();
  };
  await drawTopics(exam.topics ? new Set(exam.topics) : null);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const topics = [...form.querySelectorAll('input[name=t]:checked')].map((el) => el.value);
    if (!topics.length && !form.prev.checked) { info.textContent = 'Bitte mindestens ein Thema wählen.'; return; }
    const [y, m, d] = form.date.value.split('-').map(Number);
    const next = {
      ...exam,
      id: existing?.id ?? `x-${Date.now().toString(36)}`,
      title: form.title.value.trim(), date: new Date(y, m - 1, d).getTime(),
      grade: Number(form.grade.value), topics, includePrev: form.prev.checked,
      size: Number(form.size.value), mode: form.mode.value,
      created: existing?.created ?? Date.now(), results: existing?.results ?? [],
    };
    p.exams = [...(p.exams || []).filter((x) => x.id !== next.id), next];
    await profiles.save(p);
    await ctx.refresh();
    location.hash = back;
  };
  view.querySelector('#delete')?.addEventListener('click', async () => {
    if (!confirm(`„${exam.title}“ löschen?`)) return;
    p.exams = (p.exams || []).filter((x) => x.id !== exam.id);
    await profiles.save(p);
    await ctx.refresh();
    location.hash = back;
  });
}

// Section for the parents' child page.
export async function examsSection(p, lang) {
  const list = (p.exams || []).slice().sort((a, b) => b.date - a.date);
  const rows = await Promise.all(list.map(async (e) => ({ e, s: await status(p, e, lang) })));
  const base = `#/parents/child/${encodeURIComponent(p.id)}`;
  return `
    <section class="card">
      <h2>Prüfungen</h2>
      ${rows.length ? `<ul class="exam-list">
        ${rows.map(({ e, s }) => {
          const best = bestResult(e);
          const last = e.results?.at(-1);
          return `<li>
            <a href="${base}/exam/${encodeURIComponent(e.id)}">
              <span class="exam-main"><strong>${esc(e.title)}</strong><small>${fmtDate(e.date)} · ${countdown(e)} · ${s.total} Wörter</small></span>
              <span class="exam-side">${s.ready} % bereit${last ? `<small>Probe: ${pct(last)} %${best !== last ? ` (best ${pct(best)} %)` : ''}</small>` : '<small>noch keine Probe</small>'}</span>
            </a>
            <span class="tp-bar"><span style="width:${s.ready}%"></span></span>
            ${e.results?.length ? `<button class="link-btn share-exam" data-id="${esc(e.id)}">📤 Ergebnis teilen</button>` : ''}
          </li>`;
        }).join('')}
      </ul>` : '<p class="hint">Plane eine Schularbeit oder einen Test: Das Kind sieht dann einen Countdown und bekommt jeden Tag eine passende Portion zum Üben.</p>'}
      <a class="btn" href="${base}/exam/new">📅 Prüfung planen</a>
    </section>`;
}

export async function examReport(p, exam, lang) {
  const s = await status(p, exam, lang);
  const lines = [`${exam.title} von ${p.name} am ${new Date(exam.date).toLocaleDateString('de-AT')}`, `Stoff: ${s.total} Wörter, davon ${s.solid} sicher (${s.ready} %).`];
  for (const r of (exam.results || []).slice(-5)) {
    lines.push(`Probe-Prüfung ${new Date(r.at).toLocaleDateString('de-AT')}: ${r.right}/${r.total} richtig (${pct(r)} %)`);
  }
  const last = exam.results?.at(-1);
  if (last?.missed.length) {
    const words = (await Promise.all(last.missed.map((id) => db.get('vocab', id)))).filter(Boolean);
    lines.push('', 'Noch unsicher:', ...words.map((w) => `- ${plain(w.term, 'en')} = ${plain(w.translation, 'de')}`));
  }
  return lines.join('\n');
}
