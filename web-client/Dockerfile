# Build from the repository root. No credentials or environment files enter this image.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY web-client/package.json web-client/package-lock.json ./
RUN npm ci
COPY web-client/ ./
RUN npm run build

FROM caddy:2.11.7-alpine
COPY --from=build /app/dist /srv
COPY infrastructure/caddy/Caddyfile.local /etc/caddy/Caddyfile
EXPOSE 4317
HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:2015/healthz || exit 1
