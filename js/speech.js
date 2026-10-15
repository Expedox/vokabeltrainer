// Pronunciation via the device's built-in voices (works offline on iOS/Android).

let voice;

function pickVoice(lang) {
  const voices = speechSynthesis.getVoices();
  const base = lang.split('-')[0];
  return voices.find((v) => v.lang === lang && v.localService)
    || voices.find((v) => v.lang === lang)
    || voices.find((v) => v.lang.startsWith(base));
}

// Word entries like "dog / bitch" or "car; automobile" → first variant only.
// Whole sentences are read completely; ; and dashes become a short pause.
export function speechText(text) {
  const t = String(text).trim();
  const isSentence = /[.!?]["')]?$/.test(t) || (!t.includes('/') && t.split(/\s+/).length > 6);
  const first = isSentence ? t : t.split(/\s[/]\s|[/;]/)[0].trim();
  return first.replace(/\s*[;:]\s*/g, ', ').replace(/\s+[–—-]\s+/g, ', ').replace(/[„“”"«»()\[\]]/g, '');
}

export const canSpeak = () => 'speechSynthesis' in window;

// The utterance that ends the current output, to wait for it.
// A rough end time guards against devices that never fire "end".
let last = null;
let until = 0;
const track = (u) => {
  last = u;
  until = Math.max(until, Date.now()) + (u.text.length * 85) / (u.rate || 1) + 800;
  u.onend = u.onerror = () => { if (last === u) last = null; };
};

export function stop() {
  last = null;
  until = 0;
  if (canSpeak()) speechSynthesis.cancel();
}

// Resolves when the current output is finished (or after maxMs at the latest).
export function whenDone(maxMs = 10000) {
  if (!canSpeak() || !last) return Promise.resolve();
  const u = last;
  return new Promise((resolve) => {
    const t = setTimeout(resolve, Math.min(maxMs, Math.max(0, until - Date.now()) + 1500));
    const done = () => { clearTimeout(t); resolve(); };
    const prev = u.onend;
    u.onend = u.onerror = (e) => { prev?.(e); done(); };
  });
}

// rate: 0.9 normal, about 0.6 for "slower please".
export function speak(text, lang = 'en-GB', rate = 0.9) {
  if (!canSpeak() || !text) return;
  speechSynthesis.cancel();
  until = 0;
  const u = new SpeechSynthesisUtterance(speechText(text));
  voice = pickVoice(lang) ?? voice;
  if (voice) u.voice = voice;
  u.lang = lang;
  u.rate = rate;
  track(u);
  speechSynthesis.speak(u);
}

if (canSpeak()) speechSynthesis.onvoiceschanged = () => { voice = undefined; };

// Several texts in a row (word, sentence, word) with a short pause between.
export function speakAll(texts, lang = 'en-GB', rate) {
  if (!canSpeak()) return;
  speechSynthesis.cancel();
  until = 0;
  voice = pickVoice(lang) ?? voice;
  texts.filter(Boolean).forEach((text, i) => {
    const u = new SpeechSynthesisUtterance(speechText(text));
    if (voice) u.voice = voice;
    u.lang = lang;
    u.rate = rate ?? (i === 1 ? 0.85 : 0.8);
    track(u);
    speechSynthesis.speak(u);
  });
}
