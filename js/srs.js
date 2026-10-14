// Spaced repetition (Leitner boxes) and the learning log, per child profile.
//
// box 0 = new or answered wrong last time, 1–5 = known with growing confidence.
// After a right answer the word is due again after INTERVAL_DAYS[box].

import * as db from './db.js';

const DAY = 24 * 60 * 60 * 1000;
export const INTERVAL_DAYS = [0, 1, 3, 7, 14, 30];
export const MAX_BOX = 5;

const key = (profileId, vocabId) => `${profileId}|${vocabId}`;

export function blank(profileId, vocabId) {
  return { key: key(profileId, vocabId), profileId, vocabId, box: 0, due: 0, right: 0, wrong: 0, seen: 0 };
}

export async function progressMap(profileId, words) {
  const rows = await Promise.all(words.map((w) => db.get('progress', key(profileId, w.id))));
  return new Map(words.map((w, i) => [w.id, rows[i] ?? blank(profileId, w.id)]));
}

export async function allProgress(profileId) {
  return db.all('progress', 'profileId', profileId);
}

export const isNew = (p) => !p.seen;
export const needsRepeat = (p) => p.seen > 0 && p.box === 0;
export const isDue = (p, now = Date.now()) => p.seen > 0 && p.due <= now;
export const isLearned = (p) => p.box >= 1;

// 0–3 stars for a topic: how firmly its words sit (box 3+ counts as solid).
export function stars(words, progress) {
  if (!words.length) return 0;
  const score = words.reduce((s, w) => s + Math.min(progress.get(w.id)?.box ?? 0, 3) / 3, 0) / words.length;
  return score >= 0.95 ? 3 : score >= 0.65 ? 2 : score >= 0.3 ? 1 : 0;
}

// keepInBox0: the word was missed earlier in the same session.
export function applyAnswer(p, ok, keepInBox0 = false) {
  const now = Date.now();
  p.seen = now;
  if (ok) {
    p.right++;
    if (!keepInBox0) p.box = Math.min(MAX_BOX, p.box + 1);
  } else {
    p.wrong++;
    p.box = 0;
  }
  // Start of the due day, so "due in 1 day" means tomorrow morning, not in 24 h.
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  p.due = p.box === 0 ? now : start.getTime() + INTERVAL_DAYS[p.box] * DAY;
  return p;
}

// ---- Sessions log ----------------------------------------------------

export function newSession(profileId, topicId, mode) {
  const id = `${profileId}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
  return { id, profileId, topicId, mode, start: Date.now(), end: Date.now(), answers: 0, right: 0, wrong: 0, words: [] };
}

export function logAnswer(session, vocabId, ok) {
  session.end = Date.now();
  session.answers++;
  if (ok) session.right++; else session.wrong++;
  if (!session.words.includes(vocabId)) session.words.push(vocabId);
  return db.put('sessions', session);
}

export async function sessionsFor(profileId) {
  return (await db.all('sessions', 'profileId', profileId)).sort((a, b) => a.start - b.start);
}

export const dayKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Answers per local day.
export function perDay(sessions) {
  const map = new Map();
  for (const s of sessions) {
    const k = dayKey(s.start);
    const row = map.get(k) ?? { answers: 0, right: 0, wrong: 0, ms: 0 };
    row.answers += s.answers; row.right += s.right; row.wrong += s.wrong;
    row.ms += Math.min(s.end - s.start, 60 * 60 * 1000);
    map.set(k, row);
  }
  return map;
}

// Consecutive learning days ending today (or yesterday, so the streak isn't
// shown as broken before the child has practised today).
export function streak(days) {
  let n = 0;
  const d = new Date();
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  while (days.get(dayKey(d))?.answers) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

export function lastDays(days, count) {
  const out = [];
  const d = new Date();
  d.setDate(d.getDate() - (count - 1));
  for (let i = 0; i < count; i++) {
    const k = dayKey(d);
    out.push({ key: k, date: new Date(d), ...(days.get(k) ?? { answers: 0, right: 0, wrong: 0, ms: 0 }) });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// Words due for review across all topics, for the "Heute wiederholen" round.
export async function dueWords(profileId, lang, limit = 30) {
  const now = Date.now();
  const due = (await allProgress(profileId)).filter((p) => isDue(p, now));
  const words = (await Promise.all(due.map((p) => db.get('vocab', p.vocabId)))).filter(Boolean);
  const topics = new Map((await db.all('topics')).map((t) => [t.id, t]));
  const byId = new Map(due.map((p) => [p.vocabId, p]));
  return words
    .filter((w) => topics.get(w.topicId)?.lang === lang)
    .sort((a, b) => byId.get(a.id).box - byId.get(b.id).box || byId.get(a.id).due - byId.get(b.id).due)
    .slice(0, limit);
}

// Most urgent first: wrong last time, then due, then new, then the rest by box.
export function byNeed(words, progress) {
  const rank = (w) => {
    const p = progress.get(w.id);
    if (needsRepeat(p)) return 0;
    if (isDue(p)) return 1;
    if (isNew(p)) return 2;
    return 3 + p.box;
  };
  return words.map((w) => [w, rank(w), Math.random()]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map(([w]) => w);
}

export const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const daysUntil = (t) => Math.round((startOfDay(t) - startOfDay(Date.now())) / DAY);

// School year starts in September: Oct 2026 → 2026, March 2027 → 2026.
export const schoolYear = (t = Date.now()) => { const d = new Date(t); return d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1; };
