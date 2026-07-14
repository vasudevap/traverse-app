FROM node:24-bookworm-slim AS build

WORKDIR /app

RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile && pnpm build

FROM node:24-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update \
    && apt-get install --no-install-recommends --yes ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system traverse \
    && useradd --system --gid traverse --home-dir /app --shell /usr/sbin/nologin traverse

COPY --from=build /app /app
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

USER traverse

CMD ["node", "apps/api/dist/main.js"]
