"""Builds data/<lang>.json from the per-grade word lists.

Usage: python3 tools/build_vocab.py <source dir with stufe-XX.json> [lang] [sentence dir]

Sentences come from <sentence dir> (default: ../saetze next to the source dir),
one stufe-XX.json per grade, topic ids as in the word lists:
  {"grade": 3, "topics": [{"id": "wohnen-umgebung", "sentences": [
    {"de": "Ich wohne in einem Haus.", "en": "I live in a house.",
     "distractors": ["I life in a house.", "I living in a house.", "I lives in a house."],
     "why": ["life ist das Nomen, wohnen heißt live.", "", ""]}]}]}   # why optional

Source format (one file per grade):
  {"language": "en", "grade": 7, "topics": [
    {"id": "umwelt", "title_de": "Umwelt", "icon": "🌍",            # icon optional
     "words": [{"en": "pollution", "de": "die Verschmutzung",
                "note": "Air pollution is a big problem.",          # note optional
                "icon": "🏭"}]}]}                                    # icon optional
"""
import datetime, glob, json, os, sys

ICONS = {
    'farb': '🎨', 'zahl': '🔢', 'tier': '🐶', 'famil': '👨‍👩‍👧', 'schul': '🏫', 'bildung': '🎓',
    'essen': '🍎', 'trink': '🥤', 'körper': '🖐️', 'kleid': '👕', 'haus': '🏠', 'zimmer': '🛏️',
    'wetter': '☀️', 'hobb': '⚽', 'freizeit': '🎮', 'tagesablauf': '⏰', 'wochentag': '📅',
    'jahreszeit': '🍂', 'stadt': '🏙️', 'städte': '🏙️', 'reise': '✈️', 'sport': '🏅',
    'einkauf': '🛒', 'umwelt': '🌍', 'gesundheit': '🩺', 'beruf': '💼', 'arbeit': '💼',
    'medien': '📱', 'technik': '💻', 'gefühl': '😊', 'gesellschaft': '🤝', 'wissenschaft': '🔬',
    'global': '🌐', 'politik': '🏛️', 'wirtschaft': '📈', 'kultur': '🎭', 'migration': '🧳',
    'zukunft': '🚀', 'diskussion': '💬', 'argument': '💬', 'freund': '🧑‍🤝‍🧑',
    'mein tag': '🌞', 'alltag': '🗓️', 'routine': '🗓️', 'wohnen': '🏡', 'umgebung': '🏡', 'fest': '🎉',
    'feier': '🎉', 'jahresablauf': '🎄', 'wochenende': '🏖️', 'ferien': '🏖️', 'tagesaktiv': '🌞',
    'zeit': '⏰', 'termin': '📆', 'orte': '📍', 'verben': '🏃', 'menschen': '🧑', 'eigenschaft': '🧑',
    'verkehr': '🚌', 'jugend': '🧑‍🎤', 'kommunikation': '💬', 'erlebnis': '🌟', 'soziales': '🤝',
    'konsum': '🛍️', 'geld': '💶', 'finanz': '💶', 'beziehung': '❤️', 'film': '🎬', 'musik': '🎵',
    'tradition': '🎎', 'geschichte': '📜', 'religion': '🕊️', 'werte': '🕊️', 'krieg': '🕊️', 'frieden': '🕊️',
    'hilfe': '🤲', 'engagement': '🤲', 'katastroph': '🌪️', 'sprache': '🗣️', 'mobilität': '🚲',
    'lebenswelt': '🧑‍🎤', 'recht': '⚖️', 'gerechtigkeit': '⚖️', 'klima': '🌡️', 'natur': '🌳',
    'literatur': '📖', 'kunst': '🎨', 'gefühl': '😊', 'körper': '🖐️', 'tiere': '🐶', 'schule': '🏫',
    'freizeit': '🎮', 'reise': '✈️', 'urlaub': '✈️', 'essen': '🍎', 'kleidung': '👕', 'wetter': '☀️',
    'stadt': '🏙️', 'land': '🌄', 'demokratie': '🏛️', 'staat': '🏛️', 'medizin': '🩺', 'ernährung': '🥗',
    'digital': '💻', 'internet': '🌐', 'computer': '💻', 'energie': '⚡', 'ressourcen': '♻️', 'nachhaltig': '♻️',
    'identität': '🪞', 'liebe': '❤️', 'ethik': '🤔', 'philosoph': '🤔', 'psycholog': '🧠', 'gesundh': '🩺',
    'farbe': '🎨', 'zahl': '🔢', 'spielzeug': '🧸', 'spiel': '🎲', 'obst': '🍓', 'gemüse': '🥕',
}

def icon_for(topic):
    if topic.get('icon'):
        return topic['icon']
    key = (topic.get('id', '') + ' ' + topic.get('title_de', '')).lower()
    return next((v for k, v in ICONS.items() if k in key), '📘')

def extras(w):
    """Optional per word: German context hint and other accepted English answers."""
    out = {}
    hint = (w.get('hint') or '').strip()
    if hint:
        out['hint'] = hint
    hint_de = (w.get('hint_de') or '').strip()
    if hint_de:
        out['hint_de'] = hint_de
    alt = w.get('alt') or []
    if isinstance(alt, str):
        alt = [a for a in alt.split(';')]
    alt = [a.strip() for a in alt if a and a.strip()]
    if alt:
        out['alt'] = alt
    de_alt = [a.strip() for a in (w.get('de_alt') or []) if a and a.strip()]
    if de_alt:
        out['de_alt'] = de_alt
    return out

def main():
    src = sys.argv[1]
    lang = sys.argv[2] if len(sys.argv) > 2 else 'en'
    sdir = sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.path.dirname(os.path.abspath(src)), 'saetze')
    sentences = {}
    for path in sorted(glob.glob(os.path.join(sdir, 'stufe-*.json'))):
        data = json.load(open(path, encoding='utf-8'))
        for t in data['topics']:
            rows = []
            for x in t.get('sentences', []):
                en, de = (x.get(lang) or x.get('en') or '').strip(), (x.get('de') or '').strip()
                dis = [d.strip() for d in x.get('distractors', []) if d and d.strip() and d.strip() != en][:3]
                if not en or not de or len(dis) < 1:
                    continue
                why = [(w or '').strip() for w in x.get('why', [])][:len(dis)]
                rows.append([en, de, dis, why] if any(why) else [en, de, dis])
            sentences[(int(data['grade']), t['id'])] = rows
    topics = []
    by_key = {}
    for path in sorted(glob.glob(os.path.join(src, 'stufe-*.json'))):
        data = json.load(open(path, encoding='utf-8'))
        grade = int(data['grade'])
        for t in data['topics']:
            seen = set()
            words = []
            for w in t['words']:
                term, trans = w[lang].strip(), w['de'].strip()
                if not term or not trans or term.lower() in seen:
                    continue
                seen.add(term.lower())
                note = (w.get('note') or '').strip()
                icon = (w.get('icon') or '').strip()
                extra = extras(w)
                words.append([term, trans, note, icon, extra] if extra else [term, trans, note, icon] if icon else [term, trans, note] if note else [term, trans])
            sents = sentences.get((grade, t['id']), [])
            key = (grade, t['title_de'].strip().lower())
            if key in by_key:  # same title twice in one grade: merge
                have = {w[0].lower() for w in by_key[key]['words']}
                by_key[key]['words'] += [w for w in words if w[0].lower() not in have]
                if sents:
                    by_key[key].setdefault('sentences', []).extend(sents)
                continue
            by_key[key] = {'grade': grade, 'title': t['title_de'].strip(), 'icon': icon_for(t), 'words': words}
            if sents:
                by_key[key]['sentences'] = sents
            topics.append(by_key[key])
    # Adult content: erwachsene/niveau-A1.json … (same shape, "level" instead of
    # "grade"); levels are stored as grades 21–24.
    adir = os.path.join(os.path.dirname(os.path.abspath(src)), 'erwachsene')
    levels = {'A1': 21, 'A2': 22, 'B1': 23, 'B2': 24}
    # Sentences may also come separately: saetze-A1.json, topics by id.
    adult_sents = {}
    for path in sorted(glob.glob(os.path.join(adir, 'saetze-*.json'))):
        data = json.load(open(path, encoding='utf-8'))
        for t in data['topics']:
            adult_sents[(data['level'].upper(), t['id'])] = t.get('sentences', [])
    for path in sorted(glob.glob(os.path.join(adir, 'niveau-*.json'))):
        data = json.load(open(path, encoding='utf-8'))
        level = data['level'].upper()
        grade = levels[level]
        for t in data['topics']:
            words = []
            seen = set()
            for w in t.get('words', []):
                term, trans = (w.get(lang) or '').strip(), (w.get('de') or '').strip()
                if not term or not trans or term.lower() in seen:
                    continue
                seen.add(term.lower())
                note = (w.get('note') or '').strip()
                extra = extras(w)
                words.append([term, trans, note, '', extra] if extra else [term, trans, note] if note else [term, trans])
            sents = []
            for x in t.get('sentences', []) + adult_sents.get((level, t['id']), []):
                en, de = (x.get(lang) or '').strip(), (x.get('de') or '').strip()
                dis = [d.strip() for d in x.get('distractors', []) if d and d.strip() and d.strip() != en][:3]
                if en and de and dis:
                    why = [(w or '').strip() for w in x.get('why', [])][:len(dis)]
                    sents.append([en, de, dis, why] if any(why) else [en, de, dis])
            topic = {'grade': grade, 'title': t['title_de'].strip(), 'icon': icon_for(t), 'words': words}
            if sents:
                topic['sentences'] = sents
            topics.append(topic)
    # Grammar chapters for adults: grammatik-A1.json … → data/grammar-<lang>.json
    chapters = []
    for path in sorted(glob.glob(os.path.join(adir, 'grammatik-*.json'))):
        data = json.load(open(path, encoding='utf-8'))
        for c in data['chapters']:
            chapters.append({**c, 'level': data['level'].upper()})
    order = list(levels)
    chapters.sort(key=lambda c: order.index(c['level']))
    with open(os.path.join(os.path.dirname(__file__), '..', 'data', f'grammar-{lang}.json'), 'w', encoding='utf-8') as f:
        json.dump({'chapters': chapters}, f, ensure_ascii=False)
    # Situation dialogues: dialoge-A1.json … → data/dialogs-<lang>.json
    situations = []
    for path in sorted(glob.glob(os.path.join(adir, 'dialoge-*.json'))):
        data = json.load(open(path, encoding='utf-8'))
        situations += [{**x, 'level': data['level'].upper()} for x in data['situations']]
    situations.sort(key=lambda x: order.index(x['level']))
    with open(os.path.join(os.path.dirname(__file__), '..', 'data', f'dialogs-{lang}.json'), 'w', encoding='utf-8') as f:
        json.dump({'situations': situations}, f, ensure_ascii=False)
    test = os.path.join(adir, 'einstufungstest.json')
    if os.path.exists(test):
        q = json.load(open(test, encoding='utf-8'))['questions']
        with open(os.path.join(os.path.dirname(__file__), '..', 'data', f'placement-{lang}.json'), 'w', encoding='utf-8') as f:
            json.dump({'questions': q}, f, ensure_ascii=False)

    out = {'version': datetime.datetime.now().strftime('%Y-%m-%d.%H%M'), 'lang': lang, 'topics': topics}
    dest = os.path.join(os.path.dirname(__file__), '..', 'data', f'{lang}.json')
    with open(dest, 'w', encoding='utf-8') as f:
        # One topic per line keeps diffs readable and the file small.
        head = {k: v for k, v in out.items() if k != 'topics'}
        f.write(json.dumps(head, ensure_ascii=False)[:-1] + ', "topics": [\n')
        f.write(',\n'.join(json.dumps(t, ensure_ascii=False) for t in topics))
        f.write('\n]}\n')
    print(f'{len(topics)} topics, {sum(len(t["words"]) for t in topics)} words, '
          f'{sum(len(t.get("sentences", [])) for t in topics)} sentences -> data/{lang}.json')

main()
