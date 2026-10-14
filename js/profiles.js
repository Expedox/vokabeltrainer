// Child profiles. Each child has its own class, design, goal and progress.

import * as db from './db.js';
import { schoolYear } from './srs.js';

export const AVATARS = ['🦊', '🐼', '🐯', '🐸', '🦄', '🐙', '🐨', '🦁', '🐵', '🐧', '🐶', '🐱', '🐰', '🐢', '🦖', '🚀', '⚽', '🎸'];
export const DEFAULT_GOAL = 20;
export const DEFAULT_MINUTES = 15;

export async function list() {
  return (await db.all('profiles')).sort((a, b) => a.created - b.created);
}

export async function current() {
  const id = await db.getMeta('profileId');
  const p = id && await db.get('profiles', id);
  // The pronunciation mode was removed; children who had it chosen get the default.
  if (p?.mode === 'speak') { p.mode = p.grade <= 4 ? 'choice' : 'cards'; await save(p); }
  if (p) return p;
  const [first] = await list();
  if (first) await db.setMeta('profileId', first.id);
  return first ?? null;
}

export function select(id) {
  return db.setMeta('profileId', id);
}

export async function create({ name, avatar, grade }) {
  const p = {
    id: `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim(), avatar, grade, theme: 'auto', dailyGoal: DEFAULT_GOAL,
    mode: grade <= 4 ? 'choice' : 'cards', direction: 'en-de', autoSpeak: true,
    tasks: [], exams: [], created: Date.now(), gradeYear: schoolYear(),
  };
  // Adults (levels 21–24): typing by default, no typo tolerance, goal in minutes.
  if (grade > 20) Object.assign(p, { mode: 'write', strict: true, dailyMinutes: DEFAULT_MINUTES });
  await db.put('profiles', p);
  await select(p.id);
  return p;
}

export function save(p) {
  return db.put('profiles', p);
}

export async function remove(id) {
  for (const row of await db.all('progress', 'profileId', id)) await db.del('progress', row.key);
  for (const row of await db.all('sessions', 'profileId', id)) await db.del('sessions', row.id);
  await db.del('profiles', id);
  if (await db.getMeta('profileId') === id) await db.setMeta('profileId', null);
}

export async function resetProgress(id) {
  for (const row of await db.all('progress', 'profileId', id)) await db.del('progress', row.key);
  for (const row of await db.all('sessions', 'profileId', id)) await db.del('sessions', row.id);
}
