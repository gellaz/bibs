# syntax=docker/dockerfile:1.7

# ---------- Build stage ----------
# Installs the full monorepo workspace graph (dev deps included — the bun
# bundler needs them to build, and drizzle-kit is a runtime requirement for
# `bun run db:migrate` on the final image).
FROM oven/bun:1 AS build
WORKDIR /app

# Workspace manifests first, so the install layer caches until any lockfile
# or package.json changes.
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/customer/package.json apps/customer/
COPY apps/seller/package.json apps/seller/
COPY packages/ui/package.json packages/ui/

# --ignore-scripts skips the root `postinstall: lefthook install`, which
# requires git in $PATH (absent from the slim bun image) and is meaningless
# inside a container anyway.
RUN bun install --frozen-lockfile --ignore-scripts

# API source (only what's needed to build, thanks to .dockerignore).
COPY apps/api apps/api

RUN bun run --cwd apps/api build


# ---------- Runtime stage ----------
FROM oven/bun:1-slim
WORKDIR /app

# Non-root user; writable /app for Pino's local file transport if enabled.
RUN groupadd -r bibs && useradd -r -g bibs -s /sbin/nologin bibs

# Built JS bundle.
COPY --from=build --chown=bibs:bibs /app/apps/api/dist ./dist

# Drizzle needs the migration SQL files + config at runtime for `db:migrate`.
COPY --from=build --chown=bibs:bibs /app/apps/api/src/db/migrations ./src/db/migrations
COPY --from=build --chown=bibs:bibs /app/apps/api/drizzle.config.ts ./drizzle.config.ts
COPY --from=build --chown=bibs:bibs /app/apps/api/package.json ./package.json

# API node_modules (bun keeps per-workspace deps here, not hoisted).
COPY --from=build --chown=bibs:bibs /app/apps/api/node_modules ./node_modules

USER bibs
EXPOSE 3000

# Run the bundled API. Migrations should be run as a separate step
# (`bun run db:migrate`) — either as an init container or at deploy time.
CMD ["bun", "dist/index.js"]
