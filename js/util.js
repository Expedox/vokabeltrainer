export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

export const STAGES = [
  { id: 'vs', name: 'Volksschule', short: 'VS', grades: [1, 2, 3, 4], theme: 'kids' },
  { id: 'us', name: 'Unterstufe', short: 'MS/AHS', grades: [5, 6, 7, 8], theme: 'teen' },
  { id: 'os', name: 'Oberstufe', short: 'AHS', grades: [9, 10, 11, 12], theme: 'adult' },
  { id: 'er', name: 'Erwachsene', short: 'GERS', grades: [21, 22, 23, 24], theme: 'adult' },
];

// Adults learn by CEFR level. Internally a level is a "grade" 21–24 so it fits
// everywhere a class fits; it also includes the school words of that level.
export const LEVELS = { 21: 'A1', 22: 'A2', 23: 'B1', 24: 'B2' };
const LEVEL_GRADES = { 21: [1, 2, 3, 4], 22: [5, 6], 23: [7, 8, 9], 24: [10, 11, 12] };
export const isAdult = (grade) => grade > 20;
export const levelGrade = (level) => Number(Object.keys(LEVELS).find((g) => LEVELS[g] === level));
// All grades whose topics belong to `grade` (a level adds its school grades).
export const gradesOf = (grade) => (isAdult(grade) ? [grade, ...LEVEL_GRADES[grade]] : [grade]);
// Everything below: earlier classes, or for a level the lower levels.
export const gradesBelow = (grade) => (isAdult(grade)
  ? Object.keys(LEVELS).map(Number).filter((g) => g < grade).flatMap(gradesOf)
  : Array.from({ length: grade - 1 }, (_, i) => i + 1));

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
  if (isAdult(grade)) return `Niveau ${LEVELS[grade]}`;
  if (grade <= 4) return `${grade}. Klasse VS`;
  if (grade <= 8) return `${grade - 4}. Klasse`;
  return `${grade - 4}. Klasse AHS`;
}

// Display form of a word: no German article, no English "to" before verbs.
// The stored data keeps both; answers are accepted with or without them.
export function plain(text, lang) {
  const re = lang === 'en' ? /^to\s+/i : /^(der|die|das)\s+/;
  return String(text).split(/\s*\/\s*/).map((part) => part.replace(re, '')).join(' / ');
}
