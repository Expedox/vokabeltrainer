# Vokabeltrainer

Offline-Web-App zum Vokabellernen (Englisch, Schulstufe 1–12, österreichischer Lehrplan).
Läuft im Browser, lässt sich über „Zum Home-Bildschirm“ wie eine App installieren und speichert alle Daten nur auf dem Gerät.

- `data/<sprache>.json` – mitgelieferter Wortschatz pro Sprache
- `js/` – App-Code ohne Build-Schritt
- `sw.js` – Offline-Cache; bei jeder Veröffentlichung `VERSION` erhöhen

## Wortschatz aktualisieren

Die Wortlisten liegen pro Schulstufe als `stufe-XX.json` vor. Daraus wird `data/en.json` gebaut:

    python3 tools/build_vocab.py <ordner-mit-stufe-dateien> en

Danach in `sw.js` die `VERSION` erhöhen und pushen. Lernfortschritt und eigene Vokabeln bleiben auf den Geräten erhalten.
