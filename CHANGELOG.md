# Changelog

Alle nennenswerten Änderungen. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionierung nach [SemVer](https://semver.org/lang/de/).

## [Unreleased]

### Hinzugefügt

- Anmeldung über den OAuth/SSO-Anbieter von Immich (z. B. Authentik) mit PKCE, ohne eigenen Client beim Anbieter; ebenso Verbinden eines lokalen Kontos mit Immich per OAuth. Neue optionale Variable `PUBLIC_URL`.
- Docker-Image zusätzlich auf Docker Hub (wenn die Secrets `DOCKERHUB_USERNAME` und `DOCKERHUB_TOKEN` gesetzt sind), inklusive Beschreibung aus dem README.

### Dokumentation

- Anleitung für den Server-Druck mit CUPS am Beispiel Canon PIXMA TS6200 (`docs/drucken.md`) und Beispiel-Compose-Dateien für Fotodruck und CUPS (`examples/`).
- Dokumentation neu gegliedert: kurzes README, Seiten für Installation, Anmeldung (mit OAuth/Authentik), Drucken, Bedienung (mit Screenshots) und Fehlersuche unter `docs/`; Entwicklung und Releases in `CONTRIBUTING.md`.

### Behoben

- Editor: Der Bereich „Ausgabe“ und das Bogenlayout hatten keinen Rahmen bzw. einen schwarzen gestrichelten Rand.
- Docker-Build: `npm ci` ohne Install-Skripte (better-sqlite3 wollte ohne Compiler neu bauen).
- Server-Druck: `CUPS_URL` mit `https://` ohne Port nutzt jetzt Port 443 statt 631; das Attribut `printer-uri` wird immer als `ipp://`/`ipps://` gesendet.

## [0.1.0] - 2026-11-07

### Hinzugefügt

- Selbst gehostete Web-App (Fastify-Backend, Svelte-Oberfläche) in einem Docker-Image für amd64 und arm64.
- Fotoquellen: Upload (Drag & Drop, Dateiauswahl, Zwischenablage, Kamera/Galerie am Smartphone; JPEG, PNG, WebP, HEIC/HEIF, TIFF, AVIF) und optional Immich (Alben, Zeitleiste, Freitext- und Metadatensuche).
- Alle Standardformate aus der Spezifikation, hoch und quer, eigene Formate pro Nutzer, ausblendbare und zuletzt benutzte Formate.
- Editor mit Füllen, ganzem Bild und weißem Rand, Verschieben, Zoom, Pinch, Drehen, Begradigen, Spiegeln, Hilfslinien, Passbild-Schablone, Gesichtszentrierung, Bildkorrekturen, Auto-Tonwert, Text im Rand, Rückgängig/Wiederholen, dpi-Prüfung.
- Ausgabe aus dem Original als JPEG/PNG/PDF (exakte Pixel- und Seitengröße, dpi-Metadaten, sRGB-ICC, EXIF), ZIP für mehrere Bilder, Speichern in Immich mit Aufnahmedatum, Album und Beschreibung.
- Browser-Druck mit exakter Seitengröße, Server-Druck über CUPS/IPP mit Randlos-Erkennung und Auftragsstatus, Bogenlayout mit Schnittmarken.
- Mehrbenutzerbetrieb: lokale Konten (Argon2id), Anmeldung über Immich per Passwort oder API-Key, Einzelnutzermodus ohne Login.
- AGPL-3.0-or-later, Quellcode-Link mit Version und Commit in jeder Seite, Lizenzprüfung in der CI.

[Unreleased]: https://github.com/scazadar/foto-print-tool/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/scazadar/foto-print-tool/releases/tag/v0.1.0
