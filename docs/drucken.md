# Drucken mit CUPS – Beispiel Canon PIXMA TS6200

Diese Anleitung richtet den Server-Druck ein: Fotodruck schickt Druckaufträge per IPP an einen CUPS-Server, der sie an den Drucker weitergibt. Als Beispiel dient ein **Canon PIXMA TS6200** (Serie TS6250/TS6251) im Heimnetz, CUPS läuft als **eigenes Compose-Projekt**, Fotodruck steht hinter **Traefik**.

Für den Browser-Druck ist nichts davon nötig, siehe [README](../README.md#drucker-einrichten).

> Ungeprüft: Das Zusammenspiel mit genau diesem Drucker und dem CUPS-Image `olbat/cupsd` ist nicht getestet. Getestet ist der Fotodruck-Teil (Drucker auflisten, Aufträge senden, Status) gegen einen nachgebauten CUPS-Server.

## Überblick

```
Browser ──HTTPS──▶ Traefik ──▶ fotodruck ──ipp://cups:631──▶ cups ──ipp://192.168.1.50/ipp/print──▶ Canon TS6200
                      └────────▶ cups (Weboberfläche, nur Heimnetz + Passwort)
```

- Fotodruck und CUPS laufen in zwei Compose-Projekten und teilen sich das Docker-Netz `print`. Fotodruck erreicht CUPS darüber als `ipp://cups:631`, ohne Umweg über Traefik.
- Die CUPS-Weboberfläche braucht man nur zum Einrichten der Drucker.

Beispieldateien:

| Datei | Inhalt |
| --- | --- |
| [`examples/fotodruck/compose.yml`](../examples/fotodruck/compose.yml) | Fotodruck mit Immich, Traefik und `CUPS_URL=ipp://cups:631` |
| [`examples/cups/compose.yml`](../examples/cups/compose.yml) | CUPS mit Weboberfläche über Traefik |
| [`examples/cups/cupsd.conf`](../examples/cups/cupsd.conf) | CUPS-Konfiguration für Docker-Netz und Reverse Proxy |

## 1. Netz anlegen und CUPS starten

```bash
docker network create print
```

Im Ordner mit `examples/cups/compose.yml` und `cupsd.conf`:

```bash
docker compose up -d
```

Die Weboberfläche ist danach unter `https://cups.example.de` erreichbar (Traefik-Labels anpassen). Wer sie nur im Heimnetz ohne Traefik braucht, ersetzt die Labels durch `ports: ["631:631"]`.

### Anmeldung bei CUPS

CUPS hat keine eigenen Konten, sondern nutzt die Benutzer im Container aus der Gruppe `lpadmin`. Beim Image `olbat/cupsd` ist das standardmäßig **`print` / `print`**. Prüfen und Passwort ändern:

```bash
docker exec cups getent group lpadmin
```

```bash
docker exec -it cups passwd print
```

Diese Konten liegen im Container: Nach einem Neuerstellen (`docker compose pull && docker compose up -d`) gilt wieder das Standardpasswort.

Steht Traefik mit Basic-Auth davor, fragt der Browser zweimal: zuerst Traefik (Konto aus `htpasswd`), auf den Verwaltungsseiten dann CUPS.

## 2. Canon TS6200 hinzufügen

Der TS6200 unterstützt AirPrint und damit **IPP Everywhere**: CUPS braucht keinen Treiber, sondern fragt Papierformate, Papiertypen, Fächer und Randlos direkt beim Drucker ab.

### IP-Adresse

Am Drucker unter *Einstellungen → LAN-Einstellungen → LAN-Einstellungen bestätigen* oder im Router nachsehen. Am besten im Router eine **feste IP** vergeben. Im Folgenden: `192.168.1.50`.

Test, ob der Drucker IPP spricht:

```bash
docker exec cups ipptool -tv ipp://192.168.1.50/ipp/print get-printer-attributes.test
```

Am Ende sollte `PASS` stehen.

### Per Befehl (empfohlen)

```bash
docker exec cups lpadmin -p Canon_TS6200 -E -v ipp://192.168.1.50/ipp/print -m everywhere -D "Canon TS6200" -L "Arbeitszimmer"
```

| Option | Bedeutung |
| --- | --- |
| `-p Canon_TS6200` | Name der Warteschlange (ohne Leerzeichen); so heißt der Drucker auch in Fotodruck |
| `-E` | Drucker sofort aktivieren |
| `-v ipp://…/ipp/print` | Adresse des Druckers |
| `-m everywhere` | IPP Everywhere, Fähigkeiten vom Drucker abfragen |
| `-D`, `-L` | Beschreibung und Standort |

### Oder über die Weboberfläche

1. *Administration → Add Printer*, mit `print` anmelden.
2. Unter **Other Network Printers** *Internet Printing Protocol (ipp)* wählen.
3. Adresse `ipp://192.168.1.50/ipp/print` eintragen.
4. Name und Beschreibung vergeben, bei *Make* **Generic**, als Modell **IPP Everywhere** wählen.
5. *Add Printer*.

Unter *Discovered Network Printers* erscheint der Drucker meist nicht: Die automatische Suche (mDNS/Bonjour) funktioniert im normalen Docker-Netz nicht. Deshalb die Adresse von Hand eintragen.

### Prüfen

```bash
docker exec cups lpstat -v
```

Testseite: in der CUPS-Weboberfläche unter *Printers → Canon_TS6200 → Maintenance → Print Test Page*.

## 3. Fotodruck verbinden

In der Compose-Datei von Fotodruck (siehe [`examples/fotodruck/compose.yml`](../examples/fotodruck/compose.yml)):

```yaml
    environment:
      CUPS_URL: ipp://cups:631
    networks:
      - default
      - print
networks:
  print:
    external: true
```

Wichtig: Hat der Dienst bisher keinen `networks`-Abschnitt, `default` mit aufführen.

Verbindung prüfen:

```bash
docker exec fotodruck node -e "fetch('http://cups:631/').then(r=>console.log(r.status)).catch(e=>console.log(e.message))"
```

`200` heißt: CUPS ist erreichbar.

## 4. Drucken

1. Im Editor das Format wählen, z. B. 10 × 15.
2. **Ausgabe → Drucken → Netzwerkdrucker**, ggf. auf ↻ klicken (die Druckerliste wird bis zu einer Minute zwischengespeichert).
3. **Canon_TS6200** wählen.
4. Papierformat: für 10 × 15 **10 × 15 cm (4 × 6 in)** (intern `na_index-4x6_4x6in`), sonst A4. Dazu Papiertyp, z. B. `photographic-glossy`, und Fach, soweit der Drucker sie meldet.
5. **Randlos** anhaken. Die Option erscheint nur, wenn der Drucker Ränder von 0 meldet.
6. **An Drucker senden.** Darunter steht der Status: wartend, druckt, fertig, Fehler.

Fotodruck sendet ein PDF in exakter Größe mit `print-scaling=none`. Ohne Randlos druckt der Canon mit seinem kleinsten Rand, die Maße des Bilds bleiben exakt.

Administratoren legen unter **Verwaltung → Sichtbare Drucker** fest, welche CUPS-Drucker die Nutzer sehen.

## Fehlersuche

| Problem | Lösung |
| --- | --- |
| `ipptool` meldet `Unable to connect` | Erreicht der CUPS-Container das Heimnetz? Feste IP des Druckers prüfen. Manche Drucker antworten nur unter `ipp://192.168.1.50:631/ipp/print`. |
| Drucker fehlt in Fotodruck | `CUPS_URL` und gemeinsames Netz prüfen; in Fotodruck auf ↻ klicken; unter *Verwaltung* sichtbar? |
| „Der Drucker ist offline“ | Drucker eingeschaltet und im WLAN? `docker exec cups lpstat -p` zeigt den Status; angehaltene Warteschlange mit `docker exec cups cupsenable Canon_TS6200` fortsetzen. |
| Kein Randlos, kein Fotopapier | IPP Everywhere meldet die Optionen des Druckers. Fehlen sie, alternativ den Gutenprint-Treiber testen (*Make* **Canon**, passendes PIXMA-Modell), falls das CUPS-Image ihn enthält. |
| Bild zu klein oder verschoben | Fotodruck sendet die exakte Größe. Papierformat passend zum eingelegten Papier wählen. |

## Variante: CUPS auf einem anderen Rechner

Läuft CUPS nicht auf demselben Docker-Host, geht IPP auch über HTTPS, z. B. hinter Traefik auf Port 443:

```yaml
CUPS_URL: ipps://cups.example.de:443   # oder https://cups.example.de
```

Fotodruck sendet keine Zugangsdaten an CUPS: Für diese Adresse darf der Proxy keine Anmeldung und keine IP-Sperre verlangen, die Fotodruck ausschließt. Damit sind die Druckerpfade aber offen erreichbar. Wenn möglich, ist das interne Netz die bessere Wahl.
