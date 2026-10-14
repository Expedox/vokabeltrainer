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
