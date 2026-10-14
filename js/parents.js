// Parents/teachers area behind a 4-digit PIN.

import * as db from './db.js';
import { esc, STAGES, classLabel } from './util.js';
import * as io from './io.js';

const UNLOCK_MS = 10 * 60 * 1000;
let unlockedUntil = 0;
let pinKey = () => {};

async function hashPin(pin) {
  let salt = await db.getMeta('pinSalt');
  if (!salt) { salt = io.newId('salt'); await db.setMeta('pinSalt', salt); }
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const isUnlocked = () => Date.now() < unlockedUntil;
const touch = () => { unlockedUntil = Date.now() + UNLOCK_MS; };
export const lock = () => { unlockedUntil = 0; };

function gradeOptions(selected) {
  return STAGES.map((s) => `
    <optgroup label="${s.name}">
      ${s.grades.map((g) => `<option value="${g}"${g === selected ? ' selected' : ''}>${classLabel(g)} (Stufe ${g})</option>`).join('')}
    </optgroup>`).join('');
}

async function topicOptions(lang, selectedId) {
  const topics = (await db.all('topics')).filter((t) => t.lang === lang)
    .sort((a, b) => a.grade - b.grade || a.title.localeCompare(b.title, 'de'));
  return STAGES.flatMap((s) => s.grades).map((g) => {
    const list = topics.filter((t) => t.grade === g);
    if (!list.length) return '';
    return `<optgroup label="${classLabel(g)}">${list.map((t) => `
      <option value="${esc(t.id)}"${t.id === selectedId ? ' selected' : ''}>${esc(t.icon || '')} ${esc(t.title)}${t.builtin ? '' : ' (eigenes)'}</option>`).join('')}
    </optgroup>`;
  }).join('');
}

const NEW_TOPIC_FIELDS = (grade) => `
  <div class="new-topic" hidden>
    <label class="field"><span>Name des neuen Themas</span><input name="newTitle" maxlength="60" placeholder="z. B. Schularbeit März"></label>
    <div class="row">
      <label class="field"><span>Klasse</span><select name="newGrade">${gradeOptions(grade)}</select></label>
      <label class="field small-field"><span>Symbol</span><input name="newIcon" maxlength="4" value="📝"></label>
    </div>
  </div>`;

function wireTopicSelect(form) {
  const sel = form.querySelector('select[name=topic]');
  const box = form.querySelector('.new-topic');
  const sync = () => { box.hidden = sel.value !== '__new'; };
  sel.addEventListener('change', sync);
  sync();
}

// Returns the chosen topic id, creating a new topic if asked to.
async function resolveTopic(form, lang) {
  const f = new FormData(form);
  if (f.get('topic') !== '__new') return f.get('topic');
  const title = String(f.get('newTitle') || '').trim();
  if (!title) throw new Error('Bitte gib dem neuen Thema einen Namen.');
  const t = await io.createTopic(lang, Number(f.get('newGrade')), title, String(f.get('newIcon') || '📝').trim() || '📝');
  return t.id;
}

function toast(view, text, kind = 'ok') {
  const el = view.querySelector('.toast');
  if (!el) return;
  el.textContent = text;
  el.className = `toast ${kind}`;
  el.hidden = false;
}

// ---- PIN -------------------------------------------------------------

function pinPad(view, { title, hint, onPin, extra = '' }) {
  let pin = '';
  view.innerHTML = `
    <div class="pin">
      <div class="lock" aria-hidden="true">🔒</div>
      <h2>${title}</h2>
      <p class="hint">${hint}</p>
      <div class="pin-dots" aria-live="polite">${'<span></span>'.repeat(4)}</div>
      <p class="pin-error" hidden></p>
      <div class="keypad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button class="key" data-k="${n}">${n}</button>`).join('')}
        <span></span><button class="key" data-k="0">0</button><button class="key" data-k="del" aria-label="Löschen">⌫</button>
      </div>
      ${extra}
    </div>`;
  const dots = view.querySelectorAll('.pin-dots span');
  const err = view.querySelector('.pin-error');
  const draw = () => dots.forEach((d, i) => d.classList.toggle('on', i < pin.length));
  const press = async (k) => {
    if (k === 'del') pin = pin.slice(0, -1);
    else if (pin.length < 4) pin += k;
    err.hidden = true;
    draw();
    if (pin.length === 4) {
      const msg = await onPin(pin);
      if (msg) { err.textContent = msg; err.hidden = false; pin = ''; setTimeout(draw, 150); }
    }
  };
  view.querySelectorAll('.key').forEach((b) => { b.onclick = () => press(b.dataset.k); });
  document.removeEventListener('keydown', pinKey);
  pinKey = (e) => {
    if (!view.querySelector('.keypad')) return document.removeEventListener('keydown', pinKey);
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('del');
  };
  document.addEventListener('keydown', pinKey);
}

function setupPin(view, done) {
  pinPad(view, {
    title: 'PIN festlegen',
    hint: 'Wähle einen 4-stelligen PIN für den Elternbereich. Kinder sollten ihn nicht kennen.',
    onPin: (first) => {
      pinPad(view, {
        title: 'PIN wiederholen',
        hint: 'Bitte gib den PIN noch einmal ein.',
        onPin: async (second) => {
          if (second !== first) { setupPin(view, done); return null; }
          await db.setMeta('pinHash', await hashPin(first));
          touch();
          done();
          return null;
        },
      });
      return null;
    },
  });
}

function mathReset(view, done) {
  const a = 12 + Math.floor(Math.random() * 30);
  const b = 13 + Math.floor(Math.random() * 20);
  view.innerHTML = `
    <form class="card form pin-reset">
      <h2>PIN vergessen?</h2>
      <p class="hint">Löse die Aufgabe, dann kannst du einen neuen PIN festlegen.</p>
      <label class="field"><span>Wie viel ist ${a} × ${b}?</span><input name="answer" inputmode="numeric" autocomplete="off" required></label>
      <p class="pin-error" hidden>Leider falsch.</p>
      <button class="btn primary">Prüfen</button>
    </form>`;
  const form = view.querySelector('form');
  form.onsubmit = (e) => {
    e.preventDefault();
    if (Number(new FormData(form).get('answer')) === a * b) setupPin(view, done);
    else { view.querySelector('.pin-error').hidden = false; }
  };
}

async function gate(view, done) {
  const stored = await db.getMeta('pinHash');
  if (!stored) { setupPin(view, done); return; }
  pinPad(view, {
    title: 'Elternbereich',
    hint: 'Bitte PIN eingeben.',
    extra: '<button class="link-btn" id="forgot">PIN vergessen?</button>',
    onPin: async (pin) => {
      if (await hashPin(pin) !== stored) return 'Falscher PIN';
      touch();
      done();
      return null;
    },
  });
  view.querySelector('#forgot').onclick = () => mathReset(view, done);
}

// ---- Views -----------------------------------------------------------

async function dashboard(ctx) {
  const { view, lang } = ctx;
  ctx.setHeader('Elternbereich', '#/settings');
  const topics = (await db.all('topics')).filter((t) => t.lang === lang);
  const custom = [];
  for (const t of topics) {
    const words = await db.vocabFor(t.id);
    const own = words.filter((w) => !w.builtin).length;
    if (!t.builtin || own) custom.push({ ...t, own, total: words.length });
  }
  custom.sort((a, b) => a.grade - b.grade || a.title.localeCompare(b.title, 'de'));
  view.innerHTML = `
    <div class="grid actions">
      <a class="tile action" href="#/parents/add"><span class="emoji">✏️</span><span class="name">Vokabeln eingeben</span></a>
      <a class="tile action" href="#/parents/import"><span class="emoji">📥</span><span class="name">Datei importieren</span></a>
      <a class="tile action" href="#/parents/export"><span class="emoji">📤</span><span class="name">Exportieren</span></a>
      <a class="tile action" href="#/parents/pin"><span class="emoji">🔑</span><span class="name">PIN ändern</span></a>
    </div>
    <section class="card">
      <h2>Eigene Vokabeln</h2>
      ${custom.length ? `<ul class="wordlist plain">
        ${custom.map((t) => `
          <li><a href="#/parents/topic/${encodeURIComponent(t.id)}">
            <span class="term">${esc(t.icon || '📝')} ${esc(t.title)}</span>
            <span class="trans">${classLabel(t.grade)} · ${t.builtin ? `${t.own} eigene` : `${t.total} Wörter`}</span>
          </a></li>`).join('')}
      </ul>` : '<p class="hint">Noch keine eigenen Vokabeln. Lege los mit „Vokabeln eingeben“ oder „Datei importieren“.</p>'}
    </section>
    <button class="btn" id="lock">🔒 Elternbereich sperren</button>
  `;
  view.querySelector('#lock').onclick = () => { lock(); location.hash = '#/'; };
}

async function addView(ctx, topicId) {
  const { view, lang, grade } = ctx;
  ctx.setHeader('Vokabeln eingeben', topicId ? `#/parents/topic/${encodeURIComponent(topicId)}` : '#/parents');
  const last = topicId || await db.getMeta('lastAddTopic');
  view.innerHTML = `
    <form class="card form" autocomplete="off">
      <label class="field"><span>Thema</span>
        <select name="topic">
          <option value="__new">➕ Neues Thema …</option>
          ${await topicOptions(lang, last)}
        </select>
      </label>
      ${NEW_TOPIC_FIELDS(grade || 1)}
      <label class="field"><span>Englisch</span><input name="term" required maxlength="120" autocapitalize="off" spellcheck="false"></label>
      <label class="field"><span>Deutsch</span><input name="translation" required maxlength="120"></label>
      <label class="field"><span>Notiz oder Beispielsatz (optional)</span><input name="note" maxlength="240"></label>
      <p class="toast" hidden></p>
      <button class="btn primary">Speichern und nächste</button>
    </form>
    <ul class="wordlist recent"></ul>
  `;
  const form = view.querySelector('form');
  wireTopicSelect(form);
  if (!last) { form.topic.value = '__new'; form.topic.dispatchEvent(new Event('change')); }
  const recent = view.querySelector('.recent');
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const id = await resolveTopic(form, lang);
      if (form.topic.value === '__new') {
        form.topic.insertAdjacentHTML('beforeend', `<option value="${esc(id)}">${esc(form.newTitle.value)} (eigenes)</option>`);
        form.topic.value = id;
        form.topic.dispatchEvent(new Event('change'));
      }
      await db.setMeta('lastAddTopic', id);
      const ok = await io.addWord(id, { term: form.term.value, translation: form.translation.value, note: form.note.value });
      if (!ok) { toast(view, `„${form.term.value}“ gibt es in diesem Thema schon.`, 'warn'); return; }
      recent.insertAdjacentHTML('afterbegin', `<li><span class="term">${esc(form.term.value)}</span><span class="trans">${esc(form.translation.value)}</span></li>`);
      toast(view, `„${form.term.value}“ gespeichert.`);
      form.term.value = ''; form.translation.value = ''; form.note.value = '';
      form.term.focus();
    } catch (err) { toast(view, err.message, 'warn'); }
  };
}

async function topicEditor(ctx, topicId) {
  const { view } = ctx;
  const topic = await db.get('topics', topicId);
  if (!topic) { location.hash = '#/parents'; return; }
  ctx.setHeader(topic.title, '#/parents');
  const words = (await db.vocabFor(topicId)).sort((a, b) => a.term.localeCompare(b.term, 'en'));
  view.innerHTML = `
    <p class="lead">${classLabel(topic.grade)} · ${words.length} Wörter${topic.builtin ? ' · Standard-Thema' : ''}</p>
    <div class="row wrap">
      <a class="btn primary" href="#/parents/add/${encodeURIComponent(topicId)}">➕ Vokabel hinzufügen</a>
      <button class="btn" id="export">📤 Exportieren</button>
      ${topic.builtin ? '' : '<button class="btn danger" id="delete-topic">Thema löschen</button>'}
    </div>
    <ul class="wordlist edit">
      ${words.map((w) => `
        <li>
          <span class="term">${esc(w.term)}${w.note ? `<small>${esc(w.note)}</small>` : ''}</span>
          <span class="trans">${esc(w.translation)}</span>
          ${w.builtin ? '<span class="lockmark" title="Standard-Wort">·</span>' : `<button class="icon-btn small del" data-id="${esc(w.id)}" aria-label="${esc(w.term)} löschen">🗑</button>`}
        </li>`).join('')}
    </ul>
  `;
  view.querySelectorAll('.del').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Dieses Wort löschen?')) return;
      await db.del('vocab', b.dataset.id);
      await db.del('progress', b.dataset.id);
      topicEditor(ctx, topicId);
    };
  });
  view.querySelector('#export').onclick = async () => {
    const pack = await io.collectCustom(topic.lang, topicId);
    await io.saveFile(`vokabeln-${topic.title.replace(/[^\wäöüÄÖÜß-]+/g, '_')}.json`, JSON.stringify(pack, null, 2), 'application/json');
  };
  view.querySelector('#delete-topic')?.addEventListener('click', async () => {
    if (!confirm(`Thema „${topic.title}“ mit allen Wörtern löschen?`)) return;
    for (const w of words) { await db.del('vocab', w.id); await db.del('progress', w.id); }
    await db.del('topics', topicId);
    location.hash = '#/parents';
  });
}

async function importView(ctx) {
  const { view, lang, grade } = ctx;
  ctx.setHeader('Importieren', '#/parents');
  view.innerHTML = `
    <section class="card">
      <h2>Datei wählen</h2>
      <p class="hint">CSV oder JSON, z. B. aus der Dateien-App, iCloud oder einem Mail-Anhang.</p>
      <label class="btn primary file-btn">Datei auswählen<input type="file" accept=".csv,.json,.txt,text/csv,application/json,text/plain" hidden></label>
      <details class="formats">
        <summary>Wie muss die Datei aussehen?</summary>
        <p><strong>CSV</strong> (z. B. aus Excel „CSV UTF-8“ speichern), eine Vokabel pro Zeile:</p>
        <pre>englisch;deutsch;notiz;stufe;thema
dog;der Hund;;1;Tiere
to borrow;ausleihen;Can I borrow your pen?;6;School</pre>
        <p>Nur die ersten zwei Spalten sind Pflicht. Ohne „stufe“ und „thema“ wählst du das Thema hier beim Import.</p>
        <p><strong>JSON</strong>: das Format, das „Exportieren“ erzeugt.</p>
      </details>
    </section>
    <div class="preview"></div>
  `;
  const input = view.querySelector('input[type=file]');
  const preview = view.querySelector('.preview');
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    let rows;
    try { rows = io.parseFile(file.name, await file.text()); }
    catch { preview.innerHTML = '<p class="toast warn">Die Datei konnte nicht gelesen werden. Ist es wirklich CSV oder JSON?</p>'; return; }
    if (!rows.length) { preview.innerHTML = '<p class="toast warn">In der Datei wurden keine Vokabeln gefunden.</p>'; return; }
    const needTopic = rows.some((r) => !(r.grade && r.topic));
    const named = [...new Set(rows.filter((r) => r.grade && r.topic).map((r) => `${r.topic} (${classLabel(r.grade)})`))];
    preview.innerHTML = `
      <form class="card form">
        <h2>${rows.length} Vokabeln gefunden</h2>
        <p class="hint">Datei: ${esc(file.name)}</p>
        <ul class="wordlist">
          ${rows.slice(0, 5).map((r) => `<li><span class="term">${esc(r.term)}</span><span class="trans">${esc(r.translation)}</span></li>`).join('')}
          ${rows.length > 5 ? `<li class="more">… und ${rows.length - 5} weitere</li>` : ''}
        </ul>
        ${named.length ? `<p>Themen aus der Datei: ${named.map(esc).join(', ')}</p>` : ''}
        ${needTopic ? `
          <label class="field"><span>${named.length ? 'Thema für Zeilen ohne Thema' : 'In welches Thema?'}</span>
            <select name="topic">
              <option value="__new" selected>➕ Neues Thema …</option>
              ${await topicOptions(lang)}
            </select>
          </label>
          ${NEW_TOPIC_FIELDS(grade || 1)}` : ''}
        <p class="toast" hidden></p>
        <button class="btn primary">Importieren</button>
      </form>`;
    const form = preview.querySelector('form');
    if (needTopic) {
      wireTopicSelect(form);
      form.newTitle.value = file.name.replace(/\.(csv|json|txt)$/i, '');
    }
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const fallback = needTopic ? await resolveTopic(form, lang) : null;
        const { added, skipped } = await io.importRows(lang, rows, fallback);
        preview.innerHTML = `<p class="toast ok">${added} Vokabeln importiert${skipped ? `, ${skipped} übersprungen (schon vorhanden)` : ''}.</p>
          <a class="btn" href="#/parents">Zur Übersicht</a>`;
        input.value = '';
      } catch (err) { toast(preview, err.message, 'warn'); }
    };
  };
}

async function exportView(ctx) {
  const { view, lang } = ctx;
  ctx.setHeader('Exportieren', '#/parents');
  const pack = await io.collectCustom(lang);
  const count = pack.topics.reduce((n, t) => n + t.words.length, 0);
  const date = new Date().toISOString().slice(0, 10);
  view.innerHTML = `
    <section class="card">
      <h2>Eigene Vokabeln sichern</h2>
      ${count ? `
        <p>${count} eigene Vokabeln in ${pack.topics.length} Themen.</p>
        <div class="stack">
          <button class="btn primary" id="json">Als JSON (zum Wieder-Importieren)</button>
          <button class="btn" id="csv">Als CSV (für Excel)</button>
        </div>
        <p class="hint">Am iPhone öffnet sich das Teilen-Menü: „In Dateien sichern“, AirDrop oder Mail.</p>`
        : '<p class="hint">Es gibt noch keine eigenen Vokabeln zum Exportieren.</p>'}
    </section>`;
  view.querySelector('#json')?.addEventListener('click', () =>
    io.saveFile(`vokabeln-${date}.json`, JSON.stringify(pack, null, 2), 'application/json'));
  view.querySelector('#csv')?.addEventListener('click', () =>
    io.saveFile(`vokabeln-${date}.csv`, io.toCsv(pack), 'text/csv'));
}

function changePin(ctx) {
  ctx.setHeader('PIN ändern', '#/parents');
  setupPin(ctx.view, () => { location.hash = '#/parents'; });
}

// ---- Router ----------------------------------------------------------

export async function parentsRoute(ctx, rest) {
  const run = async () => {
    touch();
    let m;
    if (rest === '') return dashboard(ctx);
    if (rest === '/add') return addView(ctx);
    if ((m = rest.match(/^\/add\/(.+)$/))) return addView(ctx, decodeURIComponent(m[1]));
    if ((m = rest.match(/^\/topic\/(.+)$/))) return topicEditor(ctx, decodeURIComponent(m[1]));
    if (rest === '/import') return importView(ctx);
    if (rest === '/export') return exportView(ctx);
    if (rest === '/pin') return changePin(ctx);
    return dashboard(ctx);
  };
  if (isUnlocked()) return run();
  ctx.setHeader('Elternbereich', '#/settings');
  return gate(ctx.view, run);
}
