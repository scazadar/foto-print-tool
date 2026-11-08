# Fehlersuche

Erste Anlaufstelle ist fast immer das Log:

```bash
docker logs --tail 100 fotodruck
```

Version und Commit des laufenden Images stehen in der Fußzeile der App und hier:

```bash
docker exec fotodruck printenv APP_VERSION GIT_COMMIT
```

- [Start](#start)
- [Immich](#immich)
- [Anmeldung](#anmeldung)
- [Fotos und Ausgabe](#fotos-und-ausgabe)
- [Drucken](#drucken)

## Start

| Problem | Ursache und Lösung |
| --- | --- |
| Container startet nicht, Log: „SESSION_SECRET is required“ | `SESSION_SECRET` fehlt oder ist kürzer als 32 Zeichen. Mit `openssl rand -hex 32` erzeugen. |
| Log: „AUTH_MODE=immich requires IMMICH_URL“ | Entweder `IMMICH_URL` setzen oder `AUTH_MODE` weglassen. |
| Neue Einstellung wirkt nicht | Umgebungsvariablen gelten erst nach `docker compose up -d --force-recreate fotodruck`; ein `restart` reicht nicht. Prüfen mit `docker exec fotodruck printenv`. |

## Immich

| Problem | Ursache und Lösung |
| --- | --- |
| „Immich ist nicht erreichbar“ | `IMMICH_URL` falsch oder nicht im selben Docker-Netz. Test: `docker exec fotodruck node -e "fetch('http://immich-server:2283/api/server/ping').then(r=>r.text()).then(console.log).catch(e=>console.log(e.message))"` – erwartet wird `{"res":"pong"}`. Siehe [Installation → Welche Immich-Adresse?](installation.md#welche-immich-adresse) |
| „Die Immich-Version … ist zu alt“ | Immich auf mindestens 2.0.0 aktualisieren. |
| „Fehlende Rechte in Immich“ | Dem API-Key fehlt ein Recht; Liste unter [Anmeldung → API-Key](anmeldung.md#persönlicher-api-key). |
| „Ihr Konto ist nicht mit Immich verbunden“ | Bei eigenen Konten unter *Einstellungen → Immich-Konto* verbinden. |
| Immich-Reiter fehlt | `IMMICH_URL` ist nicht gesetzt. Ohne Immich wird der Reiter absichtlich nicht angezeigt. |

## Anmeldung

| Problem | Ursache und Lösung |
| --- | --- |
| Kein OAuth-Button | Immich nicht erreichbar, OAuth in Immich aus, `AUTH_MODE=local` gesetzt (dann nur unter *Einstellungen* zum Verbinden) oder ein Image vor OAuth-Unterstützung. Nach Änderungen in Immich bis zu einer Minute warten. |
| Nach dem Klick wird auf `http://` statt `https://` umgeleitet | `PUBLIC_URL=https://…` und `TRUST_PROXY=true` setzen und den Container neu erstellen. |
| Authentik zeigt „Redirect URI Error“ | Die Rückruf-Adresse fehlt beim Provider von Immich oder weicht ab. Eintragen: `PUBLIC_URL` + `/api/auth/oauth/callback`, Modus *strict*. |
| „Die OAuth-Anmeldung ist fehlgeschlagen“ | Meist dieselbe Ursache wie oben. Im Log steht `oauth callback failed` mit Details. |
| „Die Anmeldung ist abgelaufen oder wurde in einem anderen Browser gestartet“ | Länger als 10 Minuten gebraucht, oder Fotodruck unter einer anderen Adresse aufgerufen als `PUBLIC_URL`. Erneut versuchen. |
| Anmeldung klappt, aber man landet in einem anderen/neuen Immich-Konto | Authentik liefert eine andere E-Mail als das bestehende Immich-Konto; Immich ordnet OAuth-Logins über E-Mail bzw. verknüpfte OAuth-ID zu und legt mit „Auto Register“ neue Konten an. In Immich das Konto mit OAuth verknüpfen. |
| Ständig abgemeldet | `SESSION_SECRET` ändert sich bei jedem Start (z. B. ohne `.env`), oder die Immich-Sitzung ist abgelaufen. |
| Kein Knopf „Als Gast fortfahren“ | `GUEST_ACCESS=true` fehlt, oder `AUTH_MODE=none` (dort gibt es keinen Gastzugang). |
| „Als Gast ist diese Funktion nicht verfügbar“ | Gäste haben absichtlich keinen Zugriff auf Immich und Netzwerkdrucker; mit einem Konto anmelden. |
| „Zu viele Fehlversuche“ | Nach 10 falschen Anmeldungen ist die IP 15 Minuten gesperrt. Hinter einem Proxy `TRUST_PROXY=true` setzen, sonst teilen sich alle die IP des Proxys. |

## Fotos und Ausgabe

| Problem | Ursache und Lösung |
| --- | --- |
| „Dieser Dateityp wird nicht unterstützt“ | RAW-Dateien (CR2, NEF, ARW, DNG) gehen beim Upload nicht; vorher in JPEG wandeln. Aus Immich nutzt Fotodruck dafür die große Vorschau. |
| „Die Datei ist zu groß“ | `UPLOAD_MAX_MB` erhöhen (Standard 100). Hinter einem Proxy auch dessen Upload-Limit prüfen. |
| Hinweis „nur ein Vorschaubild“ | Das Original ließ sich nicht lesen (z. B. RAW in Immich); gedruckt wird in geringerer Auflösung. |
| Rote dpi-Anzeige | Der Ausschnitt hat zu wenig Pixel für das Format: weniger zoomen, kleineres Format wählen oder ein größeres Original nehmen. |
| Hochformat-Foto liegt quer | Sollte nicht vorkommen (die EXIF-Ausrichtung wird beachtet). Mit 90°-Drehen korrigieren und gern ein Issue mit Beispieldatei eröffnen. |

## Drucken

| Problem | Ursache und Lösung |
| --- | --- |
| Ausdruck zu klein oder zu groß | Im Druckdialog **Skalierung 100 %** bzw. **Tatsächliche Größe** wählen, nicht „An Seite anpassen“. |
| Weißer Rand trotz Randlos | Browser-Druck: Randlos im Druckdialog bzw. Treiber einschalten und passendes Fotopapier wählen. Server-Druck: Randlos nur, wenn der Drucker es meldet. |
| Reiter „Netzwerkdrucker“ fehlt | `CUPS_URL` ist nicht gesetzt. |
| Drucker fehlt in der Liste | Siehe [Drucken → Fehlersuche](drucken.md#fehlersuche); unter *Verwaltung* sichtbar geschaltet? Auf ↻ klicken (Liste wird bis zu einer Minute zwischengespeichert). |
| „Der Drucker ist offline“ | Drucker an und im Netz? `docker exec cups lpstat -p` zeigt den Status. |
