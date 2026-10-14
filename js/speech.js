// Pronunciation via the device's built-in voices (works offline on iOS/Android).

let voice;

function pickVoice(lang) {
  const voices = speechSynthesis.getVoices();
  const base = lang.split('-')[0];
  return voices.find((v) => v.lang === lang && v.localService)
    || voices.find((v) => v.lang === lang)
    || voices.find((v) => v.lang.startsWith(base));
}

export const canSpeak = () => 'speechSynthesis' in window;

export function speak(text, lang = 'en-GB') {
  if (!canSpeak() || !text) return;
  speechSynthesis.cancel();
  // "der Hund / die Hündin" → read the first variant only.
  const u = new SpeechSynthesisUtterance(text.split(/[/;]/)[0].trim());
  voice = pickVoice(lang) ?? voice;
  if (voice) u.voice = voice;
  u.lang = lang;
  u.rate = 0.9;
  speechSynthesis.speak(u);
}

if (canSpeak()) speechSynthesis.onvoiceschanged = () => { voice = undefined; };

// Several texts in a row (word, sentence, word) with a short pause between.
export function speakAll(texts, lang = 'en-GB') {
  if (!canSpeak()) return;
  speechSynthesis.cancel();
  voice = pickVoice(lang) ?? voice;
  texts.filter(Boolean).forEach((text, i) => {
    const u = new SpeechSynthesisUtterance(i === 1 ? text : text.split(/[/;]/)[0].trim());
    if (voice) u.voice = voice;
    u.lang = lang;
    u.rate = i === 1 ? 0.85 : 0.8;
    speechSynthesis.speak(u);
  });
}

// ---- Speech recognition (pronunciation practice) ----
// Safari and Chrome ship it prefixed; it usually needs the internet.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = () => Boolean(Recognition) && navigator.onLine !== false;

// Resolves with the heard alternatives (lower case), or rejects with an error code
// ('not-allowed', 'network', 'no-speech', …).
export function listen(lang = 'en-GB') {
  return new Promise((resolve, reject) => {
    if (canSpeak()) speechSynthesis.cancel();
    const r = new Recognition();
    r.lang = lang;
    r.interimResults = false;
    r.maxAlternatives = 5;
    let done = false;
    r.onresult = (e) => {
      done = true;
      resolve([...e.results[0]].map((a) => a.transcript.toLowerCase().trim()));
    };
    r.onerror = (e) => { done = true; reject(e.error || 'error'); };
    r.onend = () => { if (!done) reject('no-speech'); };
    try { r.start(); } catch { reject('error'); }
    setTimeout(() => { if (!done) r.stop(); }, 6000);
  });
}
