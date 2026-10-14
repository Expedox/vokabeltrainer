#!/bin/sh
# Rebuild data/en.json from the word lists, bump the cache version, commit and push.
# Usage: tools/release-vocab.sh <dir with stufe-XX.json>
set -e
cd "$(dirname "$0")/.."
python3 tools/build_vocab.py "${1:-/mnt/project-files/vokabeln}" en
git diff --quiet data/en.json && { echo "no vocab change"; exit 0; }
v=$(grep -oE "VERSION = 'v[0-9]+" sw.js | grep -oE "[0-9]+$")
sed -i "s/const VERSION = 'v$v'/const VERSION = 'v$((v + 1))'/" sw.js
git add data/en.json sw.js
git commit -qm "Wortschatz aktualisiert" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018UtAzsptsACpLX43woAwYq"
git push -q
git log --oneline -1
