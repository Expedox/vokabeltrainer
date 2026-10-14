"""Builds data/<lang>.json from the per-grade word lists.

Usage: python3 tools/build_vocab.py <source dir with stufe-XX.json> [lang]

Source format (one file per grade):
  {"language": "en", "grade": 7, "topics": [
    {"id": "umwelt", "title_de": "Umwelt", "icon": "🌍",            # icon optional
     "words": [{"en": "pollution", "de": "die Verschmutzung",
                "note": "Air pollution is a big problem."}]}]}     # note optional
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

def main():
    src = sys.argv[1]
    lang = sys.argv[2] if len(sys.argv) > 2 else 'en'
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
                words.append([term, trans, note] if note else [term, trans])
            key = (grade, t['title_de'].strip().lower())
            if key in by_key:  # same title twice in one grade: merge
                have = {w[0].lower() for w in by_key[key]['words']}
                by_key[key]['words'] += [w for w in words if w[0].lower() not in have]
                continue
            by_key[key] = {'grade': grade, 'title': t['title_de'].strip(), 'icon': icon_for(t), 'words': words}
            topics.append(by_key[key])
    out = {'version': datetime.datetime.now().strftime('%Y-%m-%d.%H%M'), 'lang': lang, 'topics': topics}
    dest = os.path.join(os.path.dirname(__file__), '..', 'data', f'{lang}.json')
    with open(dest, 'w', encoding='utf-8') as f:
        # One topic per line keeps diffs readable and the file small.
        head = {k: v for k, v in out.items() if k != 'topics'}
        f.write(json.dumps(head, ensure_ascii=False)[:-1] + ', "topics": [\n')
        f.write(',\n'.join(json.dumps(t, ensure_ascii=False) for t in topics))
        f.write('\n]}\n')
    print(f'{len(topics)} topics, {sum(len(t["words"]) for t in topics)} words -> data/{lang}.json')

main()
