# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Fotodruck contributors

# ---------- build ----------
FROM node:22-slim AS build
WORKDIR /app
COPY server/package.json server/package-lock.json server/
COPY web/package.json web/package-lock.json web/
# --ignore-scripts: better-sqlite3 ships prebuilt binaries for linux x64/arm64
# (glibc) in its package but would otherwise try to compile itself with
# node-gyp, which needs Python and a compiler. No other production package
# has install scripts; sharp, @napi-rs/canvas and argon2 come as prebuilt
# optional dependencies.
RUN cd server && npm ci --no-audit --no-fund --ignore-scripts \
 && cd ../web && npm ci --no-audit --no-fund --ignore-scripts
COPY shared/ shared/
COPY server/ server/
COPY web/ web/
RUN cd web && npm run build \
 && cd ../server && npm run build \
 && npm prune --omit=dev --no-audit --no-fund

# ---------- runtime ----------
FROM node:22-slim
ARG VERSION=0.4.0
ARG GIT_COMMIT=unknown
LABEL org.opencontainers.image.title="Fotodruck" \
      org.opencontainers.image.description="Fotos auf Standardformate einpassen, speichern und drucken – optional mit Immich" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.source="https://github.com/scazadar/foto-print-tool" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${GIT_COMMIT}"
# fonts for captions rendered on the server, tini as init
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-dejavu-core ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/server/package.json server/package.json
COPY --from=build /app/server/node_modules server/node_modules
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
COPY LICENSE THIRD_PARTY_LICENSES.md ./
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production \
    DATA_DIR=/data \
    WEB_DIR=/app/web/dist \
    PORT=8080 \
    APP_VERSION=${VERSION} \
    GIT_COMMIT=${GIT_COMMIT}
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["tini", "--"]
CMD ["node", "server/dist/server/src/index.js"]
