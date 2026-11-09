# Installation

Fotodruck läuft als ein Docker-Container. Diese Seite zeigt drei typische Aufbauten und listet alle Einstellungen.

- [Variante 1: allein, ohne Immich](#variante-1-allein-ohne-immich)
- [Variante 2: neben Immich](#variante-2-neben-immich)
- [Variante 3: hinter Traefik mit HTTPS](#variante-3-hinter-traefik-mit-https)
- [Alle Einstellungen](#alle-einstellungen)
- [Daten, Updates, Backup](#daten-updates-backup)

## Images

| Image | Tags |
| --- | --- |
| `ghcr.io/scazadar/foto-print-tool` | `latest` (letztes Release), `0.4.0`, `0.4` …, `edge` (aktueller Stand von `main`) |

Das Image gibt es für amd64 und arm64 (z. B. Raspberry Pi 4/5), nur in der GitHub Container Registry.

## Variante 1: allein, ohne Immich

Fotos werden hochgeladen, Nutzer haben eigene Konten.

```yaml
# compose.yml
services:
  fotodruck:
    image: ghcr.io/scazadar/foto-print-tool:latest
    container_name: fotodruck
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      SESSION_SECRET: ${SESSION_SECRET}
    volumes:
      - fotodruck-data:/data

volumes:
  fotodruck-data:
```

In eine `.env` daneben:

```env
SESSION_SECRET=hier-64-zufaellige-hex-zeichen
```

Erzeugen mit `openssl rand -hex 32`. Den Wert **aufbewahren**: Er signiert die Sitzungen und verschlüsselt gespeicherte Immich-Zugänge. Ändert er sich, müssen sich alle neu anmelden.

```bash
docker compose up -d
```

Beim ersten Aufruf von `http://<server>:8080` legt ein Einrichtungsassistent das erste Administratorkonto an. Alternativ vorab `ADMIN_EMAIL` und `ADMIN_PASSWORD` setzen.

## Variante 2: neben Immich

Fotodruck kommt in das Docker-Netz des Immich-Stacks und spricht Immich direkt an. Die Nutzer melden sich mit ihrem Immich-Konto an.

```yaml
services:
  fotodruck:
    image: ghcr.io/scazadar/foto-print-tool:latest
    container_name: fotodruck
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      SESSION_SECRET: ${SESSION_SECRET}
      IMMICH_URL: http://immich-server:2283
      IMMICH_PUBLIC_URL: https://fotos.example.de
    volumes:
      - fotodruck-data:/data
    networks:
      - default
      - immich

volumes:
  fotodruck-data:

networks:
  immich:
    external: true
    name: immich_default
```

### Welche Immich-Adresse?

| Variable | Was eintragen |
| --- | --- |
| `IMMICH_URL` | die **interne** Adresse im Docker-Netz: `http://immich-server:2283`. Immer `http`, Port `2283`, ohne `/api`. |
| `IMMICH_PUBLIC_URL` | die Adresse, unter der **Sie** Immich im Browser öffnen, z. B. `https://fotos.example.de`. Nur für die Links „In Immich öffnen“. |

- `immich-server` ist der Dienstname aus der Compose-Datei von Immich; den genauen Namen zeigt `docker ps --format '{{.Names}}' | grep -i immich`.
- Den Netznamen zeigt `docker network ls` (meist `immich_default`).
- Die öffentliche Adresse als `IMMICH_URL` geht auch, ist aber langsamer und scheitert, wenn vor Immich eine Anmeldung oder IP-Sperre im Proxy hängt.

Prüfen:

```bash
docker exec fotodruck node -e "fetch('http://immich-server:2283/api/server/ping').then(r=>r.text()).then(console.log).catch(e=>console.log(e.message))"
```

`{"res":"pong"}` heißt: Immich ist erreichbar.

Unterstützt wird Immich ab Version 2.0.0, getestet gegen die API 3.4.0-rc.0. Ist Immich zu alt, steht das beim Start im Log und in der Oberfläche.

Anmeldung, OAuth und API-Keys: siehe [Anmeldung](anmeldung.md).

## Variante 3: hinter Traefik mit HTTPS

Vollständiges Beispiel mit Immich, Traefik und CUPS: [`examples/fotodruck/compose.yml`](../examples/fotodruck/compose.yml). Die wichtigen Zeilen:

```yaml
    environment:
      TRUST_PROXY: "true"                 # HTTPS von Traefik erkennen
      PUBLIC_URL: https://druck.example.de
    labels:
      - traefik.enable=true
      - traefik.docker.network=proxy
      - traefik.http.routers.fotodruck.rule=Host(`druck.example.de`)
      - traefik.http.routers.fotodruck.entrypoints=websecure
      - traefik.http.routers.fotodruck.tls.certresolver=letsencrypt
      - traefik.http.services.fotodruck.loadbalancer.server.port=8080
```

- **`TRUST_PROXY`** muss hinter einem Proxy gesetzt sein, sonst erkennt Fotodruck HTTPS nicht und setzt das Sitzungscookie ohne `Secure`.
- **`PUBLIC_URL`** ist für OAuth nötig (Rückruf-Adresse). Ohne diesen Wert kann die Adresse mit `http://` statt `https://` entstehen.
- `ports:` kann entfallen, wenn nur Traefik auf Fotodruck zugreift.
- `entrypoints`, `certresolver` und das Netz `proxy` an die eigene Traefik-Konfiguration anpassen.

## Alle Einstellungen

| Variable | Wann nötig | Beispiel | Bedeutung |
| --- | --- | --- | --- |
| `SESSION_SECRET` | **immer** | 64 Hex-Zeichen | Signiert Sitzungen, verschlüsselt gespeicherte Zugänge. Mindestens 32 Zeichen. |
| `IMMICH_URL` | mit Immich | `http://immich-server:2283` | Interne Adresse von Immich. Leer = ohne Immich. |
| `IMMICH_PUBLIC_URL` | mit Immich, empfohlen | `https://fotos.example.de` | Für Links zu Bildern in Immich. Standard: `IMMICH_URL`. |
| `AUTH_MODE` | selten | `local` | `immich` = Anmeldung mit dem Immich-Konto (Standard mit `IMMICH_URL`), `local` = eigene Konten (Standard ohne Immich), `none` = ohne Anmeldung, nur für einen einzelnen Nutzer im Heimnetz. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | optional | – | Erstes Admin-Konto im Modus `local`, statt Einrichtungsassistent. |
| `TRUST_PROXY` | hinter einem Proxy | `true` | HTTPS und Client-Adresse aus den Proxy-Headern übernehmen. |
| `PUBLIC_URL` | mit OAuth hinter einem Proxy | `https://druck.example.de` | Öffentliche Adresse von Fotodruck für die OAuth-Rückruf-Adresse. Standard: aus der Anfrage. |
| `GUEST_ACCESS` | optional | `true` | Anmeldung als Gast ohne Konto erlauben, ohne Immich und Netzwerkdrucker. Standard: aus. Siehe [Anmeldung → Gastzugang](anmeldung.md#gastzugang). |
| `GUEST_SESSION_HOURS` | mit Gastzugang | `24` | Gäste und ihre Fotos werden nach so vielen Stunden gelöscht (sonst beim Abmelden). |
| `GUEST_MAX_UPLOADS` | mit Gastzugang | `30` | Höchstzahl an Fotos pro Gast. |
| `CUPS_URL` | für Server-Druck | `ipp://cups:631` | CUPS-Server oder IPP-Drucker, siehe [Drucken](drucken.md). |
| `UPLOAD_MAX_MB` | optional | `100` | Maximale Größe pro hochgeladener Datei. |
| `UPLOAD_RETENTION_DAYS` | optional | `7` | Uploads nach so vielen Tagen löschen. `0` = nie. |
| `DEFAULT_DPI` | optional | `300` | Ausgabeauflösung, pro Nutzer in den Einstellungen änderbar. |
| `PORT` | optional | `8080` | HTTP-Port im Container. |
| `SOURCE_URL` | bei eigenen Änderungen | Link zum Fork | Quellcode-Link in der Oberfläche (AGPL §13). Standard: offizielles Repo. |
| `DATA_DIR` | selten | `/data` | Datenverzeichnis im Container. |
| `TZ` | optional | `Europe/Berlin` | Zeitzone (Datum im Dateinamen, Logs). |

## Daten, Updates, Backup

Alles liegt im Volume `/data`:

| Pfad | Inhalt | Aufbewahrung |
| --- | --- | --- |
| `fotodruck.sqlite` | Konten, Einstellungen, eigene Formate, Druckaufträge | dauerhaft |
| `uploads/<nutzer>/` | hochgeladene Fotos (neu kodiert) | `UPLOAD_RETENTION_DAYS` |
| `cache/<nutzer>/` | Originale aus Immich während des Renderns | höchstens 24 Stunden |

Gerenderte Ergebnisse werden nicht gespeichert, sondern direkt ausgeliefert.

**Update:**

```bash
docker compose pull
```

```bash
docker compose up -d
```

**Backup:** das Volume sichern, mindestens `fotodruck.sqlite`, und den `SESSION_SECRET` aufbewahren. Ohne den Secret sind gespeicherte Immich-Zugänge nicht mehr lesbar, die Nutzer verbinden sich dann einfach neu.
