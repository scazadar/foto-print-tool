# Mitwirken / Contributing

Danke für Ihr Interesse! Beiträge sind willkommen: Fehlerberichte, Ideen, Übersetzungen, Code.

## Ablauf

1. Für größere Änderungen bitte zuerst ein Issue eröffnen und den Ansatz besprechen.
2. Fork anlegen, Branch erstellen, Änderungen mit Tests machen.
3. Vor dem Pull Request lokal prüfen:
   ```bash
   cd server && npm test && npm run typecheck
   cd ../web && npm run check && npm run build
   cd .. && node scripts/check-spdx.mjs && node scripts/check-licenses.mjs --check
   ```
4. Pull Request mit kurzer Beschreibung eröffnen. Bei sichtbaren Änderungen einen Screenshot anhängen.

## Regeln

- **Lizenz:** Mit Ihrem Beitrag stimmen Sie zu, dass er unter der AGPL-3.0-or-later veröffentlicht wird.
- **SPDX-Kopfzeile:** Jede neue Quelldatei beginnt mit `SPDX-License-Identifier: AGPL-3.0-or-later` und einer Copyright-Zeile (siehe bestehende Dateien).
- **Abhängigkeiten:** Nur Pakete mit AGPL-kompatibler Lizenz (MIT, BSD, Apache-2.0, ISC, LGPL, GPL-3.0 …). Nach dem Hinzufügen `node scripts/check-licenses.mjs` ausführen und `THIRD_PARTY_LICENSES.md` mit einchecken.
- **Keine Telemetrie, keine externen Dienste, keine CDNs oder Web-Fonts.**
- **Texte** gehören in `web/src/locales/de.json`, nicht in den Code.
- **Immich-API:** Pfade und Felder gegen die OpenAPI-Spezifikation der aktuellen Immich-Version prüfen.
- Commit-Nachrichten kurz und aussagekräftig; Änderungen für Nutzer in `CHANGELOG.md` unter „Unreleased“ eintragen.

## Übersetzungen

Neue Sprache: `web/src/locales/<sprache>.json` als Kopie von `de.json` anlegen, übersetzen und in `web/src/lib/i18n.ts` registrieren.

---

**English:** Contributions are welcome. Please open an issue before large changes, add tests, keep SPDX headers in every source file, only use AGPL-compatible dependencies (run `node scripts/check-licenses.mjs`), and put user-facing texts into the locale files. By contributing you agree that your work is published under AGPL-3.0-or-later.
