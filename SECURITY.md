# Sicherheit / Security

## Unterstützte Versionen

Sicherheitsupdates gibt es für die jeweils neueste Version (`latest`).

## Schwachstelle melden

Bitte **kein öffentliches Issue** eröffnen. Melden Sie Sicherheitslücken vertraulich über *Security → Report a vulnerability* (GitHub Private Vulnerability Reporting) in diesem Repository.

Bitte angeben: betroffene Version, Konfiguration (`AUTH_MODE`, mit/ohne Immich, CUPS), Schritte zur Reproduktion und mögliche Auswirkungen. Wir bestätigen den Eingang innerhalb einer Woche und melden uns mit einer Einschätzung.

## Sicherheitsmodell (Kurzfassung)

- Immich-Tokens und API-Keys liegen nur im Backend, verschlüsselt mit AES-256-GCM (Schlüssel aus `SESSION_SECRET` abgeleitet). Sie werden nie an den Browser geschickt.
- Sitzungen: zufälliges Token im `HttpOnly`-, `SameSite=Lax`-Cookie (signiert, bei HTTPS `Secure`); in der Datenbank steht nur der SHA-256-Hash.
- Schreibende API-Aufrufe verlangen den Header `x-fotodruck: 1` (CSRF-Schutz).
- Passwörter lokaler Konten: Argon2id. Anmeldeversuche werden pro IP begrenzt.
- Uploads werden am Inhalt erkannt und serverseitig neu kodiert.
- Jeder Nutzer sieht nur eigene Uploads, Einstellungen und Druckaufträge; Immich-Anfragen laufen mit seinen eigenen Rechten.
- `AUTH_MODE=none` schaltet die Anmeldung ab und ist nur für Einzelnutzer in einem vertrauenswürdigen Netz gedacht.

---

**English:** Please report vulnerabilities privately via GitHub's *Report a vulnerability* feature, not as a public issue.
