// Loads the bundled word lists (data/<lang>.json) into IndexedDB.
// Built-in rows are replaced when the bundle version changes; custom rows
// (builtin: false) and learning progress are never touched.

import * as db from './db.js';

export const LANGUAGES = [
  { id: 'en', name: 'Englisch', flag: '🇬🇧' },
];

export function slug(s) {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export async function seed(lang) {
  const res = await fetch(`data/${lang}.json`);
  const bundle = await res.json();
  const key = `seed:${lang}`;
  if (await db.getMeta(key) === bundle.version) return;

  const topics = [];
  const vocab = [];
  for (const t of bundle.topics) {
    const topicId = `${lang}-${t.grade}-${slug(t.title)}`;
    topics.push({ id: topicId, lang, grade: t.grade, title: t.title, icon: t.icon, builtin: true });
    for (const [term, translation, note = '', icon = ''] of t.words) {
      vocab.push({ id: `${topicId}:${slug(term)}`, topicId, term, translation, note, icon, builtin: true });
    }
  }

  // Drop built-in rows that no longer exist in the bundle.
  const keepTopics = new Set(topics.map((t) => t.id));
  const keepVocab = new Set(vocab.map((v) => v.id));
  for (const t of await db.all('topics')) {
    if (t.builtin && t.lang === lang && !keepTopics.has(t.id)) await db.del('topics', t.id);
  }
  for (const v of await db.all('vocab')) {
    if (v.builtin && v.topicId.startsWith(`${lang}-`) && !keepVocab.has(v.id)) await db.del('vocab', v.id);
  }

  await db.putMany('topics', topics);
  await db.putMany('vocab', vocab);
  await db.setMeta(key, bundle.version);
}
