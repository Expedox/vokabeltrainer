// Import/export of word lists.
//
// CSV: one word per line: englisch;deutsch[;notiz][;stufe][;thema]
//      Separator ; , or tab. An optional header line is detected and skipped.
//      With stufe+thema columns the words go to that topic, otherwise to the
//      topic picked in the import dialog.
// JSON: { "format": "vokabeltrainer", "lang": "en",
//         "topics": [{ "grade": 3, "title": "...", "icon": "🐶",
//                      "words": [["term", "translation", "note"], ...] }] }
//       Also accepted: a bare array of {term, translation, note} objects.

import * as db from './db.js';
import { slug } from './seed.js';

const HEADER_WORDS = /^(englisch|english|term|wort|word|vokabel|begriff|en)$/i;

function splitCsvLine(line, sep) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const first = lines[0];
  const sep = ['\t', ';', ','].map((s) => [s, first.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = lines.map((l) => splitCsvLine(l, sep));
  if (HEADER_WORDS.test(rows[0][0])) rows.shift();
  return rows
    .filter((r) => r[0] && r[1])
    .map(([term, translation, note = '', grade = '', topic = '']) => ({
      term, translation, note, grade: Number(grade) || null, topic: topic || null,
    }));
}

export function parseJson(text) {
  const data = JSON.parse(text.replace(/^﻿/, ''));
  const rows = [];
  if (Array.isArray(data)) {
    for (const w of data) {
      if (w && w.term && w.translation) rows.push({ term: w.term, translation: w.translation, note: w.note || '', grade: null, topic: null });
    }
    return rows;
  }
  for (const t of data.topics || []) {
    for (const w of t.words || []) {
      const [term, translation, note = ''] = Array.isArray(w) ? w : [w.term, w.translation, w.note];
      if (term && translation) rows.push({ term, translation, note: note || '', grade: Number(t.grade) || null, topic: t.title || null, icon: t.icon });
    }
  }
  return rows;
}

export function parseFile(name, text) {
  return /\.json$/i.test(name) || text.trim().startsWith('{') || text.trim().startsWith('[')
    ? parseJson(text) : parseCsv(text);
}

export function newId(prefix) {
  const rnd = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${rnd}`;
}

export async function createTopic(lang, grade, title, icon = '📝') {
  const topic = { id: newId(`${lang}-${grade}-custom`), lang, grade, title, icon, builtin: false };
  await db.put('topics', topic);
  return topic;
}

// Adds a word unless the same term already exists in the topic.
// Returns true when something was added.
export async function addWord(topicId, { term, translation, note = '' }, existing) {
  const key = slug(term);
  existing ??= new Set((await db.vocabFor(topicId)).map((w) => slug(w.term)));
  if (!key || existing.has(key)) return false;
  existing.add(key);
  await db.put('vocab', { id: newId(`${topicId}:u`), topicId, term: term.trim(), translation: translation.trim(), note: note.trim(), builtin: false });
  return true;
}

// rows: parsed rows. fallbackTopicId: where rows without stufe/thema go.
export async function importRows(lang, rows, fallbackTopicId) {
  const topics = await db.all('topics');
  const byKey = new Map(topics.filter((t) => t.lang === lang).map((t) => [`${t.grade}|${t.title.toLowerCase()}`, t]));
  const existing = new Map();
  let added = 0;
  let skipped = 0;
  for (const r of rows) {
    let topicId = fallbackTopicId;
    if (r.grade && r.topic) {
      const key = `${r.grade}|${r.topic.toLowerCase()}`;
      let t = byKey.get(key);
      if (!t) { t = await createTopic(lang, r.grade, r.topic, r.icon || '📝'); byKey.set(key, t); }
      topicId = t.id;
    }
    if (!topicId) { skipped++; continue; }
    if (!existing.has(topicId)) existing.set(topicId, new Set((await db.vocabFor(topicId)).map((w) => slug(w.term))));
    if (await addWord(topicId, r, existing.get(topicId))) added++; else skipped++;
  }
  return { added, skipped };
}

// Everything parents added: custom topics with all their words, plus custom
// words inside built-in topics.
export async function collectCustom(lang, onlyTopicId) {
  const topics = (await db.all('topics')).filter((t) => t.lang === lang && (!onlyTopicId || t.id === onlyTopicId));
  const out = [];
  for (const t of topics) {
    const words = (await db.vocabFor(t.id)).filter((w) => !w.builtin || onlyTopicId);
    if (!words.length) continue;
    out.push({ grade: t.grade, title: t.title, icon: t.icon, words: words.map((w) => (w.note ? [w.term, w.translation, w.note] : [w.term, w.translation])) });
  }
  return { format: 'vokabeltrainer', version: 1, lang, exported: new Date().toISOString(), topics: out };
}

const csvCell = (s) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function toCsv(pack) {
  const lines = ['englisch;deutsch;notiz;stufe;thema'];
  for (const t of pack.topics) {
    for (const [term, translation, note = ''] of t.words) {
      lines.push([term, translation, note, String(t.grade), t.title].map(csvCell).join(';'));
    }
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// iOS: share sheet (save to Files, AirDrop, mail). Elsewhere: download.
export async function saveFile(name, text, type) {
  const file = new File([text], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- Full backup (children, progress, own words, settings) ------------

export async function makeBackup() {
  const custom = (rows) => rows.filter((r) => !r.builtin);
  return {
    format: 'vokabeltrainer-backup', version: 1, created: new Date().toISOString(),
    topics: custom(await db.all('topics')),
    vocab: custom(await db.all('vocab')),
    profiles: await db.all('profiles'),
    progress: await db.all('progress'),
    sessions: await db.all('sessions'),
    meta: (await db.all('meta')).filter((m) => !m.key.startsWith('seed:')),
  };
}

export async function restoreBackup(text) {
  const data = JSON.parse(text.replace(/^﻿/, ''));
  if (data.format !== 'vokabeltrainer-backup') throw new Error('Das ist keine Sicherungsdatei des Vokabeltrainers.');
  for (const name of ['profiles', 'progress', 'sessions']) await db.clear(name);
  for (const t of (await db.all('topics')).filter((r) => !r.builtin)) await db.del('topics', t.id);
  for (const v of (await db.all('vocab')).filter((r) => !r.builtin)) await db.del('vocab', v.id);
  for (const name of ['topics', 'vocab', 'profiles', 'progress', 'sessions', 'meta']) {
    if (Array.isArray(data[name])) await db.putMany(name, data[name]);
  }
  return { profiles: data.profiles?.length ?? 0, words: data.vocab?.length ?? 0 };
}
