# Fotodruck

**Fotos auf Standardformate einpassen, als neues Bild speichern oder direkt drucken – mit oder ohne eigenen [Immich](https://immich.app)-Server.**

*[English version below](#english)*

> Fotodruck ist ein **unabhängiges Open-Source-Projekt**. Es ist nicht mit dem Immich-Projekt verbunden und wird nicht von ihm unterstützt. „Immich“ wird nur verwendet, um die Kompatibilität zu beschreiben.

Lizenz: [GNU AGPL-3.0-or-later](LICENSE) · Keine Telemetrie, keine Tracker, keine externen Dienste.

## Funktionen

- **Fotoquellen:** Upload per Drag & Drop, Dateiauswahl, Einfügen aus der Zwischenablage, am Smartphone „Foto aufnehmen“ und Galerie. Optional Immich: Alben, Zeitleiste, Freitext- und Metadatensuche (Datum, Ort, Person). Mehrfachauswahl.
- **Formate:** alle gängigen Fotoformate (9 × 13 bis 50 × 70, Quadrat, Panorama, DIN A6–A3, Passbild DE/EU und US), jeweils hoch und quer. Pixelwerte werden aus den Maßen berechnet (px = mm ÷ 25,4 × dpi). Eigene Formate (cm, mm, Zoll), Standardformate ausblendbar, zuletzt benutzte oben.
- **Editor:** Füllen (Zuschnitt), ganzes Bild (Hintergrund Weiß, Schwarz, Farbe oder unscharfes Bild), weißer Rand (auch Polaroid-Look), verschieben, zoomen (Maus, Regler, Pinch), drehen in 90°-Schritten und fein ±45° mit Gitter, spiegeln, Drittel-Gitter, 3-mm-Sicherheitsrand, Passbild-Hilfslinien, „auf Gesicht zentrieren“ (Gesichter aus Immich), Rückgängig/Wiederholen (50 Schritte), Helligkeit, Kontrast, Sättigung, Farbtemperatur, Schärfe, Schwarz-Weiß, Sepia, Auto-Tonwert, Text im Rand. Alles nicht-destruktiv.
- **Qualitätsprüfung:** effektive Auflösung des sichtbaren Ausschnitts in dpi (grün ab 300, gelb ab 150, rot darunter).
- **Ausgabe aus dem Original in voller Auflösung:** JPEG (dpi in JFIF/EXIF, sRGB-ICC-Profil, EXIF des Originals, GPS optional), PNG, PDF mit exakter Seitengröße; mehrere Bilder als ZIP bzw. mehrseitiges PDF.
- **In Immich speichern:** als neues Asset mit dem Aufnahmedatum des Originals (steht in der Zeitleiste daneben), optional im Album „Druck“ und mit Beschreibung „Druckversion 10×15 von IMG_1234“. Das Original bleibt unverändert.
- **Drucken:** Browser-Druck mit exakter Seitengröße in mm, oder Server-Druck über CUPS/IPP mit Papierformat, Papiertyp, Fach, Kopien, Randlos (nur wenn der Drucker es meldet) und Auftragsstatus.
- **Bogenlayout:** mehrere Bilder auf A4, A3, Letter oder 10 × 15 (z. B. 4 × A6 auf A4, 8 Passbilder auf 10 × 15) mit Schnittmarken und einstellbarem Abstand.
- **Mehrere Nutzer:** eigene Konten (Argon2id) oder Anmeldung über Immich (Passwort oder persönlicher API-Key). Jeder sieht nur seine eigenen Uploads, Einstellungen und Druckaufträge; Immich-Anfragen laufen mit den Rechten des jeweiligen Nutzers.

## Schnellstart

```bash
SESSION_SECRET=$(openssl rand -hex 32) docker compose up -d
```

Danach <http://localhost:8080> öffnen und im Einrichtungsassistenten das erste Administratorkonto anlegen (oder vorab `ADMIN_EMAIL` und `ADMIN_PASSWORD` setzen). Ohne `IMMICH_URL` läuft die App vollständig ohne Immich, der Immich-Reiter wird nicht angezeigt.

Das Image gibt es für amd64 und arm64 auf der GitHub Container Registry (`ghcr.io/scazadar/foto-print-tool`) und auf Docker Hub (`docker.io/<docker-hub-nutzer>/foto-print-tool`). Für Docker Hub in der `docker-compose.yml` die Zeile `image:` entsprechend ändern.

Den `SESSION_SECRET` dauerhaft aufbewahren (z. B. in einer `.env`-Datei neben der `docker-compose.yml`): Er signiert die Sitzungen und verschlüsselt gespeicherte Immich-Tokens.

### Neben einem bestehenden Immich-Stack

In der `docker-compose.yml` den Block `networks` einkommentieren (Netzname des Immich-Stacks, meist `immich_default`) und setzen:

```env
SESSION_SECRET=…
IMMICH_URL=http://immich-server:2283
IMMICH_PUBLIC_URL=https://fotos.example.de
```

Mit gesetzter `IMMICH_URL` ist die Anmeldung über Immich der Standard (`AUTH_MODE=immich`). Wer eigene Konten bevorzugt und Immich nur verknüpfen will, setzt `AUTH_MODE=local`; jeder Nutzer kann sein Immich-Konto dann in den Einstellungen verbinden.

Getestet gegen die Immich-API **3.4.0-rc.0** (OpenAPI-Spezifikation aus `immich-app/immich`, Branch `main`, Stand November 2026). Unterstützt wird Immich **ab 2.0.0**; bei älteren Versionen zeigt die App beim Start und in der Oberfläche eine Meldung (`GET /api/server/version`).

## Konfiguration

| Variable | Pflicht | Beispiel | Zweck |
| --- | --- | --- | --- |
| `SESSION_SECRET` | ja | 64 Hex-Zeichen | Signiert Sitzungs-Cookies und verschlüsselt gespeicherte Tokens (mind. 32 Zeichen) |
| `AUTH_MODE` | nein | `local` | `local` = eigene Konten, `immich` = Anmeldung über Immich, `none` = ohne Login (nur Einzelnutzer im Heimnetz). Standard: `immich`, wenn `IMMICH_URL` gesetzt ist, sonst `local` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | nein | – | Erstes Admin-Konto im Modus `local` (sonst Einrichtungsassistent) |
| `IMMICH_URL` | nein | `http://immich-server:2283` | Basis-URL der Immich-Instanz. Leer = ohne Immich |
| `IMMICH_PUBLIC_URL` | nein | `https://fotos.example.de` | Für Links zu Assets in Immich, falls abweichend von `IMMICH_URL` |
| `UPLOAD_MAX_MB` | nein | `100` | Maximale Größe pro hochgeladener Datei |
| `UPLOAD_RETENTION_DAYS` | nein | `7` | Nach wie vielen Tagen Uploads gelöscht werden. `0` = nie |
| `CUPS_URL` | nein | `ipp://cups:631` | CUPS-Server oder IPP-Drucker für Server-Druck |
| `DEFAULT_DPI` | nein | `300` | Ausgabeauflösung |
| `PORT` | nein | `8080` | HTTP-Port |
| `SOURCE_URL` | nein | Link zum Repo | Quellcode-Link in der Oberfläche (AGPL §13). Standard: offizielles Repo |
| `TRUST_PROXY` | nein | `true` | Hinter einem Reverse Proxy setzen, damit HTTPS erkannt wird |
| `DATA_DIR` | nein | `/data` | Datenverzeichnis (SQLite, Uploads, Cache) |

Daten: SQLite (`/data/fotodruck.sqlite`) für Konten, Einstellungen, eigene Formate und Druckaufträge; Uploads unter `/data/uploads/<nutzer>/`; Immich-Originale werden für das Rendern höchstens 24 h unter `/data/cache/<nutzer>/` zwischengespeichert. Gerenderte Ergebnisse werden nicht gespeichert, sondern direkt ausgeliefert.

### HTTPS und Cookies

Das Sitzungscookie ist immer `HttpOnly` und `SameSite=Lax`. Das `Secure`-Flag wird gesetzt, wenn die Anfrage per HTTPS kommt. Hinter einem Reverse Proxy (Caddy, Traefik, nginx) daher `TRUST_PROXY=true` setzen. Bei reinem HTTP im Heimnetz funktioniert die Anmeldung ebenfalls, dann aber ohne `Secure`-Flag.

## Immich: Anmeldung und API-Key

- **Immich-Passwort:** E-Mail und Passwort des Immich-Kontos. Das Backend erhält ein Access-Token von `POST /api/auth/login`; beim Abmelden wird es mit `POST /api/auth/logout` beendet.
- **Persönlicher API-Key** (für Immich-Instanzen mit reiner OAuth/SSO-Anmeldung): In Immich unter *Kontoeinstellungen → API-Schlüssel → Neuer API-Schlüssel* einen Schlüssel erzeugen. Benötigte Rechte:
  `asset.read`, `asset.view`, `asset.download`, `asset.upload`, `asset.update`, `album.read`, `album.create`, `albumAsset.create`, `person.read`, `face.read`, `user.read`, `userProfileImage.read`.

Tokens und Keys liegen nur im Backend, mit AES-256-GCM verschlüsselt (Schlüssel aus `SESSION_SECRET`). Der Browser erhält nur das Sitzungscookie.

## Drucker einrichten

**Browser-Druck** braucht keine Einrichtung. Im Druckdialog **„Skalierung 100 %“ bzw. „Tatsächliche Größe“** und das passende Papierformat wählen. Für randlosen Druck die Randlos-Option im Druckdialog bzw. Treiber aktivieren. Ohne Randlos druckt der Drucker mit seinem kleinsten Rand, die Maße bleiben exakt.

**Server-Druck** (Netzwerkdrucker, Druck vom Handy, Stapel): `CUPS_URL` auf einen CUPS-Server (`ipp://cups:631`, die App liest alle Warteschlangen per CUPS-Get-Printers) oder direkt auf einen IPP-fähigen Drucker (`ipp://192.168.1.50/ipp/print`) setzen. Die App fragt Papierformate, Papiertypen, Fächer und Ränder per IPP ab und bietet Randlos nur an, wenn der Drucker Papierformate mit Rand 0 meldet. Gesendet wird ein PDF in exakter Größe mit `print-scaling=none`. Aufträge tragen den Nutzernamen; jeder sieht nur seine eigenen. Administratoren legen unter *Verwaltung* fest, welche Drucker sichtbar sind.

Beispiel für einen CUPS-Container im selben Compose-Projekt:

```yaml
  cups:
    image: olbat/cupsd   # oder ein anderes CUPS-Image
    restart: unless-stopped
    ports: ["631:631"]   # Weboberfläche zum Einrichten der Drucker
```

## Entwicklung

Voraussetzung: Node.js 22.

```bash
cd server && npm ci
cd ../web && npm ci
```

```bash
# Terminal 1: Immich-Attrappe mit zwei Testnutzern (anna@example.org / anna-pass, ben@example.org / ben-pass)
cd server && MOCK_IMMICH_PORT=2283 npx tsx test/mock-immich.ts
```

```bash
# Terminal 2: Backend
cd server && SESSION_SECRET=dev-secret-dev-secret-dev-secret-0123 DATA_DIR=./.data IMMICH_URL=http://127.0.0.1:2283 npm run dev
```

```bash
# Terminal 3: Frontend mit Hot Reload auf http://localhost:5173
cd web && npm run dev
```

Tests und Prüfungen:

```bash
cd server && npm test && npm run typecheck
```

```bash
cd web && npm run check
```

```bash
node scripts/check-spdx.mjs && node scripts/check-licenses.mjs --check
```

Der End-to-End-Test gegen eine echte Immich-Instanz läuft in der CI (`.github/workflows/ci.yml`, Job `e2e-immich`) und lokal mit `IMMICH_URL=http://localhost:2283 node --import tsx test/e2e/immich-e2e.ts` gegen ein frisches Immich.

Aufbau: `shared/` enthält Formate, Geometrie, Bildkorrekturen und Rendering, die Browser-Vorschau (Canvas) und Server-Ausgabe (`@napi-rs/canvas`) gemeinsam nutzen, damit beide gleich aussehen. `server/` ist das Fastify-Backend, `web/` die Svelte-Oberfläche. Texte stehen in `web/src/locales/de.json`; für weitere Sprachen eine weitere Datei anlegen.

## Images veröffentlichen (für Maintainer)

Die CI baut bei jedem Push auf `main` und bei jedem Tag `v*` ein Multi-Arch-Image (amd64, arm64) und lädt es hoch:

| Ereignis | Tags |
| --- | --- |
| Push auf `main` | `edge`, `sha-<commit>` |
| Tag `v1.2.3` | `1.2.3`, `1.2`, `latest`, `sha-<commit>` |

- **GHCR** (`ghcr.io/scazadar/foto-print-tool`) braucht keine Einrichtung. Neue Pakete sind zunächst privat: einmalig unter *Package settings → Change visibility* auf „Public“ stellen.
- **Docker Hub** wird zusätzlich bedient, sobald im GitHub-Repo unter *Settings → Secrets and variables → Actions* diese Secrets angelegt sind:
  - `DOCKERHUB_USERNAME`: Docker-Hub-Nutzer oder -Organisation
  - `DOCKERHUB_TOKEN`: ein Personal Access Token von Docker Hub (*Account settings → Personal access tokens*) mit dem Recht *Read & Write*
  
  Der Image-Name ist `<DOCKERHUB_USERNAME>/foto-print-tool`; abweichend über die Repository-Variable `DOCKERHUB_IMAGE` (z. B. `meine-org/fotodruck`). Das Repository auf Docker Hub wird beim ersten Push angelegt, die Beschreibung wird bei jedem Push auf `main` aus diesem README übernommen. Fehlen die Secrets, überspringt die CI Docker Hub mit einem Hinweis.

Release: `git tag v0.1.0 && git push origin v0.1.0`.

## Bekannte Grenzen

- RAW-Dateien (CR2, NEF, ARW, DNG) werden beim Upload nicht unterstützt. Aus Immich wird für nicht lesbare Originale das große Vorschaubild verwendet, mit Hinweis auf die geringere Auflösung.
- HEIC/HEIF wird über libheif-js dekodiert (das mitgelieferte libvips kann kein HEVC). Das ist langsamer als JPEG.
- Passbild-Hilfslinien: Gesichtshöhe 32–36 mm nach Passbildschablone; der Augenbereich folgt ICAO 9303. Vor der Abgabe mit der aktuellen amtlichen Schablone prüfen.
- Die Vorschau „in echter Größe“ ist maßstäblich, aber Bildschirme zeigen mm nicht physikalisch exakt an.
- OAuth/SSO-Anmeldung direkt über den Anbieter ist nicht Teil von Version 1 (stattdessen persönlicher API-Key).

## Lizenz

Copyright (C) 2026 Fotodruck contributors. Dieses Programm ist freie Software: Sie können es unter den Bedingungen der GNU Affero General Public License, Version 3 oder (nach Ihrer Wahl) jeder späteren Version, weitergeben und/oder verändern. Siehe [LICENSE](LICENSE) und [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

Wer eine veränderte Version für andere im Netz betreibt, muss ihnen den Quellcode anbieten (AGPL §13). Dafür `SOURCE_URL` auf den eigenen Fork setzen; die Oberfläche verlinkt dann in Fußzeile und „Über“-Dialog dorthin, mit Versionsnummer und Commit.

---

<a id="english"></a>

# Fotodruck (English)

**Fit photos to standard print sizes, save the result as a new image or print it directly, with or without your own [Immich](https://immich.app) server.**

> Fotodruck is an **independent open source project**. It is not affiliated with or endorsed by the Immich project. "Immich" is only used to describe compatibility.

Licence: [GNU AGPL-3.0-or-later](LICENSE) · No telemetry, no trackers, no external services. The user interface is currently German; all texts live in `web/src/locales/de.json`, so adding English is a matter of translating that file.

## Features

- Sources: upload (drag & drop, file picker, clipboard, camera and gallery on phones) and optionally Immich (albums, timeline, smart and metadata search). Multi-select.
- All common photo sizes (9 × 13 to 50 × 70 cm, square, panorama, DIN A6–A3, passport DE/EU and US), portrait and landscape, plus custom sizes in cm, mm or inches.
- Non-destructive editor: fill (crop), fit (white, black, colour or blurred background), white border/Polaroid, pan, zoom, pinch, 90° and fine rotation, mirroring, thirds grid, 3 mm safety margin, passport guides, centre on face (faces from Immich), undo/redo, brightness, contrast, saturation, temperature, sharpness, B&W, sepia, auto levels, caption in the border.
- Effective dpi of the visible crop (green ≥ 300, yellow ≥ 150, red below).
- Output rendered from the full-resolution original: JPEG (dpi in JFIF/EXIF, sRGB ICC profile, original EXIF, GPS optional), PNG, PDF with the exact page size; ZIP for several images.
- Save to Immich as a new asset dated like the original, optionally into an album ("Druck") with a description. The original is never modified.
- Print via the browser (exact page size in mm) or via CUPS/IPP (media, type, tray, copies, borderless only when the printer reports zero margins, job status).
- Sheet layout: several images on A4, A3, Letter or 4 × 6 in with crop marks.
- Multi-user: local accounts (Argon2id) or Immich login (password or personal API key). Each user only sees their own data; Immich calls run with the user's own credentials.

## Quick start

```bash
SESSION_SECRET=$(openssl rand -hex 32) docker compose up -d
```

Images for amd64 and arm64 are published to `ghcr.io/scazadar/foto-print-tool` and Docker Hub (`<user>/foto-print-tool`; maintainers set the repository secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`). Open <http://localhost:8080> and create the first admin account. To connect Immich, set `IMMICH_URL` (e.g. `http://immich-server:2283`) and join the Immich Docker network (see `docker-compose.yml`). All settings are listed in the [configuration table](#konfiguration) above. Tested against Immich API 3.4.0-rc.0; Immich 2.0.0 or later is supported.

Personal API keys need these permissions: `asset.read`, `asset.view`, `asset.download`, `asset.upload`, `asset.update`, `album.read`, `album.create`, `albumAsset.create`, `person.read`, `face.read`, `user.read`, `userProfileImage.read`.

For browser printing choose **"Scale 100 %" / "Actual size"** and the matching paper in the print dialog. For server printing set `CUPS_URL` to a CUPS server (`ipp://cups:631`) or an IPP printer.

## Licence

Copyright (C) 2026 Fotodruck contributors. This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. If you run a modified version for others over a network, you must offer them its source (AGPL §13): set `SOURCE_URL` to your fork.
