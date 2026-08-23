# Caddy with the DuckDNS DNS-01 plugin. Production only — local dev uses the
# stock caddy:2-alpine image over plain HTTP.
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/duckdns

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
