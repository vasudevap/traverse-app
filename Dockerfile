FROM node:24-bookworm-slim AS build

WORKDIR /app

RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile && pnpm build

FROM node:24-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update \
    && apt-get install --no-install-recommends --yes ca-certificates curl \
    && curl --fail --location --silent --show-error \
      https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
      --output /usr/local/share/ca-certificates/aws-rds-global-bundle.crt \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system traverse \
    && useradd --system --gid traverse --home-dir /app --shell /usr/sbin/nologin traverse

COPY --from=build /app /app

ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/aws-rds-global-bundle.crt

USER traverse

CMD ["node", "apps/api/dist/main.js"]
