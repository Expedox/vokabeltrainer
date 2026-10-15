// English words that mean the same in everyday use, so either answer counts
// ("beginnen": start or begin). British and American words are listed too.
const GROUPS = [
  ['start', 'begin'], ['finish', 'end'], ['big', 'large'], ['small', 'little'], ['fast', 'quick'],
  ['close', 'shut'], ['hurry', 'hurry up'], ['choose', 'pick'], ['present', 'gift'], ['ill', 'sick'],
  ['shop', 'store'], ['film', 'movie'], ['autumn', 'fall'], ['holiday', 'holidays', 'vacation'],
  ['rubbish', 'garbage', 'trash'], ['flat', 'apartment'], ['lift', 'elevator'], ['mobile', 'mobile phone', 'cell phone', 'cellphone'],
  ['biscuit', 'cookie'], ['sweets', 'candy'], ['football', 'soccer'], ['chips', 'fries', 'french fries'], ['maths', 'math'],
  ['pavement', 'sidewalk'], ['queue', 'line'], ['motorway', 'highway'], ['petrol', 'gas', 'gasoline'],
  ['underground', 'subway', 'tube'], ['timetable', 'schedule'], ['trousers', 'pants'], ['jumper', 'sweater', 'pullover'],
  ['postman', 'mailman'], ['post', 'mail'], ['taxi', 'cab'], ['toilet', 'bathroom', 'restroom'], ['cinema', 'movies', 'movie theater'],
  ['nappy', 'diaper'], ['torch', 'flashlight'], ['wardrobe', 'closet'], ['tap', 'faucet'], ['bill', 'check'],
  ['luggage', 'baggage'], ['car park', 'parking lot'], ['crossroads', 'intersection'], ['zebra crossing', 'crosswalk'],
  ['mum', 'mom', 'mummy', 'mommy'], ['rucksack', 'backpack'], ['dustbin', 'bin', 'trash can'], ['fridge', 'refrigerator'],
  ['tv', 'television'], ['bike', 'bicycle'], ['phone', 'telephone'], ['photo', 'photograph', 'picture'],
  ['plane', 'airplane', 'aeroplane'], ['kid', 'child'], ['kids', 'children'], ['hi', 'hello'], ['bye', 'goodbye'],
  ['to ship', 'to send', 'to post', 'to mail'], ['to book', 'to reserve'], ['to phone', 'to call', 'to ring'], ['to fix', 'to repair', 'to mend'],
  ['maybe', 'perhaps'], ['shout', 'yell'], ['let', 'allow'], ['answer', 'reply'], ['quiet', 'silent'],
];

const index = new Map();
for (const g of GROUPS) for (const w of g) index.set(w, g);

// Other words with the same meaning, without "to"/articles.
// Entries with "to" only match verbs ("to ship" = send, but not "ship" = Schiff).
export function synonyms(word) {
  const full = word.toLowerCase().trim();
  const key = full.replace(/^(to|a|an|the)\s+/, '');
  const strip = (w) => w.replace(/^to\s+/, '');
  return (index.get(full) ?? index.get(key) ?? []).map(strip).filter((w) => w !== key);
}

// Close meanings: never shown together as answer and wrong option, because
// both could be meant ("to stop": aufhören, not beenden next to it).
const RELATED_EN = [
  ['stop', 'finish', 'end', 'quit', 'close', 'complete'], ['start', 'begin', 'open'], ['big', 'large', 'huge', 'great', 'tall'],
  ['small', 'little', 'tiny', 'short'], ['say', 'tell', 'speak', 'talk'], ['look', 'see', 'watch', 'look at'], ['hear', 'listen', 'listen to'],
  ['make', 'do'], ['get', 'receive', 'become', 'fetch'], ['happy', 'glad', 'cheerful'], ['angry', 'mad', 'cross', 'furious'],
  ['pretty', 'beautiful', 'nice', 'lovely', 'cute'], ['easy', 'simple', 'light'], ['difficult', 'hard', 'heavy'], ['fast', 'quick'],
  ['run', 'walk', 'go', 'race'], ['think', 'believe', 'mean'], ['like', 'love', 'enjoy'], ['learn', 'study'], ['need', 'want', 'must'],
  ['bring', 'take', 'carry', 'fetch'], ['clean', 'tidy', 'tidy up', 'wash'], ['travel', 'drive', 'ride', 'go'], ['know', 'can'],
  ['buy', 'shop', 'go shopping'], ['give', 'present'], ['sad', 'unhappy'], ['ready', 'finished', 'done'], ['shout', 'call', 'scream', 'yell'],
  ['stay', 'remain', 'wait'], ['answer', 'reply'], ['afraid', 'scared', 'frightened'], ['ill', 'sick'], ['road', 'street', 'way'],
];
const RELATED_DE = [
  ['beenden', 'aufhören', 'stoppen', 'abschließen', 'fertig machen', 'schließen', 'anhalten'], ['anfangen', 'beginnen', 'starten'],
  ['groß', 'riesig'], ['klein', 'winzig', 'kurz'], ['sagen', 'sprechen', 'reden', 'erzählen'], ['sehen', 'schauen', 'anschauen', 'ansehen', 'zusehen'],
  ['hören', 'zuhören'], ['machen', 'tun'], ['bekommen', 'erhalten', 'kriegen', 'holen'], ['froh', 'fröhlich', 'glücklich'],
  ['böse', 'wütend', 'sauer', 'verärgert'], ['hübsch', 'schön', 'nett', 'süß'], ['leicht', 'einfach'], ['schwer', 'schwierig'],
  ['schnell', 'rasch'], ['laufen', 'rennen', 'gehen'], ['denken', 'glauben', 'meinen'], ['mögen', 'lieben', 'gern haben'],
  ['lernen', 'studieren', 'üben'], ['brauchen', 'benötigen', 'wollen'], ['bringen', 'nehmen', 'tragen', 'holen'],
  ['aufräumen', 'putzen', 'sauber machen', 'waschen'], ['reisen', 'fahren'], ['wissen', 'kennen', 'können'], ['kaufen', 'einkaufen'],
  ['geben', 'schenken'], ['traurig', 'unglücklich'], ['fertig', 'bereit'], ['rufen', 'schreien'], ['bleiben', 'warten'],
  ['antworten', 'beantworten'], ['ängstlich', 'erschrocken'], ['krank', 'übel'], ['straße', 'weg'], ['geschenk', 'präsent'],
  ['auto', 'wagen'], ['junge', 'bub'], ['fahrrad', 'rad'], ['handy', 'mobiltelefon'],
];
const relIndex = (groups) => {
  const m = new Map();
  for (const g of groups) for (const w of g.map((x) => x.replace(/^to\s+/, ''))) m.set(w, [...(m.get(w) ?? []), g.map((x) => x.replace(/^to\s+/, ''))]);
  return m;
};
const relEn = relIndex([...GROUPS, ...RELATED_EN]);
const relDe = relIndex(RELATED_DE);

// True if the two words (already normalized, without articles/"to") are close in meaning.
export function related(a, b, lang = 'en') {
  if (a === b) return true;
  const groups = (lang === 'de' ? relDe : relEn).get(a) ?? [];
  return groups.some((g) => g.includes(b));
}
