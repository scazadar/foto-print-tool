# Mitwirken

Beiträge sind willkommen: Fehlerberichte, Ideen, Übersetzungen, Code. Für größere Änderungen bitte zuerst ein Issue eröffnen und den Ansatz besprechen.

- [Entwicklungsumgebung](#entwicklungsumgebung)
- [Tests und Prüfungen](#tests-und-prüfungen)
- [Aufbau](#aufbau)
- [Regeln](#regeln)
- [Releases und Images](#releases-und-images)

## Entwicklungsumgebung

Voraussetzung: Node.js 22.

```bash
cd server && npm ci
```

```bash
cd web && npm ci
```

Drei Terminals:

```bash
# 1: Immich-Attrappe mit zwei Testnutzern und OAuth
#    anna@example.org / anna-pass (API-Key key-anna), ben@example.org / ben-pass (key-ben)
cd server && MOCK_IMMICH_PORT=2283 npx tsx test/mock-immich.ts
```

```bash
# 2: Backend auf http://localhost:8080
cd server && SESSION_SECRET=dev-secret-dev-secret-dev-secret-0123 DATA_DIR=./.data IMMICH_URL=http://127.0.0.1:2283 npm run dev
```

```bash
# 3: Oberfläche mit Hot Reload auf http://localhost:5173
cd web && npm run dev
```

Ohne Terminal 1 und `IMMICH_URL` läuft alles ohne Immich.

## Tests und Prüfungen

Vor jedem Pull Request:

```bash
cd server && npm test && npm run typecheck
```

```bash
cd web && npm run check && npm run build
```

```bash
node scripts/check-spdx.mjs && node scripts/check-licenses.mjs --check
```

Die Tests in `server/test/` und `shared/*.test.ts` laufen gegen nachgebaute Immich-, OAuth- und CUPS-Server. Der End-to-End-Test gegen ein echtes Immich läuft in der CI (Job `e2e-immich`) und lokal gegen ein frisches Immich mit:

```bash
cd server && IMMICH_URL=http://localhost:2283 node --import tsx test/e2e/immich-e2e.ts
```

## Aufbau

| Ordner | Inhalt |
| --- | --- |
| `shared/` | Formate (`formats.json`), Geometrie, Bildkorrekturen, Rendering, Bogenlayout, Passbild-Hilfslinien. Wird von Browser-Vorschau und Server-Ausgabe gemeinsam genutzt, damit beide gleich aussehen. |
| `server/` | Fastify-Backend: Anmeldung, Uploads, Immich-Anbindung (`immich.ts`), OAuth (`oauth.ts`), Rendering mit `@napi-rs/canvas` und sharp, PDF, IPP-Client (`ipp.ts`), SQLite |
| `web/` | Svelte-5-Oberfläche mit Vite. Texte in `web/src/locales/de.json` |
| `docs/` | Dokumentation für Betreiber und Nutzer, Screenshots in `docs/images/` |
| `examples/` | Beispiel-Compose-Dateien |
| `scripts/` | SPDX- und Lizenzprüfung |

Die Immich-Anbindung ist gegen die OpenAPI-Spezifikation von Immich geschrieben (`open-api/immich-openapi-specs.json` im Immich-Repo). Neue Endpunkte bitte dort prüfen; Pfade und Felder ändern sich zwischen Versionen.

## Regeln

- **Lizenz:** Mit Ihrem Beitrag stimmen Sie zu, dass er unter der AGPL-3.0-or-later veröffentlicht wird.
- **SPDX-Kopfzeile:** Jede neue Quelldatei beginnt mit `SPDX-License-Identifier: AGPL-3.0-or-later` und einer Copyright-Zeile (siehe bestehende Dateien).
- **Abhängigkeiten:** nur mit AGPL-kompatibler Lizenz (MIT, BSD, Apache-2.0, ISC, LGPL, GPL-3.0 …). Danach `node scripts/check-licenses.mjs` ausführen und `THIRD_PARTY_LICENSES.md` mit einchecken.
- **Keine Telemetrie, keine externen Dienste, keine CDNs oder Web-Fonts.**
- **Texte** gehören in `web/src/locales/de.json`, nicht in den Code. Neue Sprache: Kopie als `<sprache>.json` anlegen und in `web/src/lib/i18n.ts` registrieren.
- **Doku:** Sichtbare Änderungen in `docs/` nachziehen, für Nutzer relevante Änderungen in `CHANGELOG.md` unter „Unreleased“ eintragen.

## Releases und Images

Die CI (`.github/workflows/ci.yml`) baut bei jedem Push auf `main` und jedem Tag `v*` ein Image für amd64 und arm64:

| Ereignis | Tags |
| --- | --- |
| Push auf `main` | `edge`, `sha-<commit>` |
| Tag `v1.2.3` | `1.2.3`, `1.2`, `latest`, `sha-<commit>`, dazu ein GitHub-Release mit dem Abschnitt aus `CHANGELOG.md` |

Release:

1. In `CHANGELOG.md` „Unreleased“ in `## [1.2.3] - JJJJ-MM-TT` umbenennen, Links unten ergänzen; Version in `server/package.json`, `web/package.json` und `package.json` anheben.
2. Auf `main` committen, dann:

   ```bash
   git tag -a v1.2.3 -m "Fotodruck 1.2.3"
   ```

   ```bash
   git push origin v1.2.3
   ```

**Registries:**

- **GHCR** (`ghcr.io/scazadar/foto-print-tool`) braucht keine Einrichtung. Neue Pakete sind zunächst privat: einmalig unter *Package settings → Change visibility* auf „Public“ stellen.
- **Docker Hub** zusätzlich, sobald im Repo unter *Settings → Secrets and variables → Actions* die Secrets `DOCKERHUB_USERNAME` und `DOCKERHUB_TOKEN` (Personal Access Token mit *Read & Write*) gesetzt sind. Image-Name `<DOCKERHUB_USERNAME>/foto-print-tool`, abweichend über die Repository-Variable `DOCKERHUB_IMAGE`. Die Beschreibung auf Docker Hub kommt bei jedem Push auf `main` aus `README.md`.

---

**English:** Contributions are welcome. Please open an issue before large changes, add tests, keep SPDX headers in every source file, only use AGPL-compatible dependencies (run `node scripts/check-licenses.mjs`), and put user-facing texts into the locale files. By contributing you agree that your work is published under AGPL-3.0-or-later.
