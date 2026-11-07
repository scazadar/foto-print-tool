# Dokumentation

| Seite | Für wen | Inhalt |
| --- | --- | --- |
| [Installation](installation.md) | Betreiber | Docker Compose allein, neben Immich, hinter Traefik; alle Einstellungen; Daten, Updates, Backup |
| [Anmeldung](anmeldung.md) | Betreiber | Anmeldemodi, OAuth mit Authentik, persönlicher API-Key, eigene Konten |
| [Drucken](drucken.md) | Betreiber | Browser-Druck, CUPS am Beispiel Canon PIXMA TS6200, Drucker direkt per IPP |
| [Bedienung](bedienung.md) | Nutzer | Fotos wählen, Editor, Ausgabe, Bogenlayout, Einstellungen |
| [Fehlersuche](fehlersuche.md) | alle | häufige Probleme nach Bereich |
| [Mitwirken](../CONTRIBUTING.md) | Entwickler | Entwicklung, Tests, Aufbau, Releases |

Beispieldateien: [`examples/fotodruck/compose.yml`](../examples/fotodruck/compose.yml) (Fotodruck mit Immich, Traefik, CUPS), [`examples/cups/`](../examples/cups/) (CUPS als eigenes Compose-Projekt).

Änderungen je Version: [CHANGELOG](../CHANGELOG.md). Sicherheitslücken bitte vertraulich melden: [SECURITY](../SECURITY.md).

## Bekannte Grenzen

- RAW-Dateien (CR2, NEF, ARW, DNG) werden beim Upload nicht unterstützt. Aus Immich wird dafür das große Vorschaubild verwendet, mit Hinweis auf die geringere Auflösung.
- HEIC/HEIF (iPhone) wird langsamer verarbeitet als JPEG.
- Passbild-Hilfslinien: Gesichtshöhe 32–36 mm nach der Passbildschablone, Augenbereich nach ICAO 9303. Vor der Abgabe mit der aktuellen amtlichen Schablone prüfen.
- Die Papiervorschau ist maßstäblich, Bildschirme zeigen Millimeter aber nicht physikalisch exakt an.
- Die Oberfläche gibt es bisher nur auf Deutsch.
- OAuth ist gegen nachgebaute Server getestet; im Betrieb bestätigt mit Authentik.
