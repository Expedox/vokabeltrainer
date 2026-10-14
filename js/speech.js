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

// Resolves when the word has been read out (or after a few seconds at most).
export function speakWait(text, lang = 'en-GB') {
  return new Promise((resolve) => {
    if (!canSpeak() || !text) { resolve(); return; }
    speak(text, lang);
    const t = setTimeout(resolve, 4000);
    // Give the voice a moment to start before checking whether it has finished.
    setTimeout(() => {
      const poll = setInterval(() => {
        if (!speechSynthesis.speaking) { clearInterval(poll); clearTimeout(t); setTimeout(resolve, 250); }
      }, 150);
    }, 400);
  });
}

// Recording yourself (pronunciation practice); works offline.
export const canRecord = () => Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
