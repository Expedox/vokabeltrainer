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
  ['maybe', 'perhaps'], ['shout', 'yell'], ['let', 'allow'], ['answer', 'reply'], ['quiet', 'silent'],
];

const index = new Map();
for (const g of GROUPS) for (const w of g) index.set(w, g);

// Other words with the same meaning, without "to"/articles.
export function synonyms(word) {
  const key = word.toLowerCase().replace(/^(to|a|an|the)\s+/, '').trim();
  return (index.get(key) ?? []).filter((w) => w !== key);
}
