# Build from the repository root. No credentials or environment files enter this image.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY web-client/package.json web-client/package-lock.json ./
RUN npm ci
COPY web-client/ ./
RUN npm run build

FROM caddy:2.11.7-alpine
# The upstream binary has cap_net_bind_service=+ep. That file capability causes
# exec EPERM when local Compose drops every capability from the bounding set.
# Let Compose grant capabilities explicitly: none locally, NET_BIND_SERVICE in prod.
RUN setcap -r /usr/bin/caddy \
    && test -z "$(getcap /usr/bin/caddy)" \
    && caddy version
COPY --from=build /app/dist /srv
COPY infrastructure/caddy/Caddyfile.local /etc/caddy/Caddyfile
EXPOSE 4317
HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:2015/healthz || exit 1
