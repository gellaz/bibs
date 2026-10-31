# syntax=docker/dockerfile:1.28

# ---------- Build stage ----------
# Installs the API's workspace graph only (`--filter`: @bibs/api and the
# workspaces it depends on), dev deps included — drizzle-kit is a runtime
# requirement for `bun run db:migrate` on the final image.
FROM oven/bun:1.4 AS build
WORKDIR /app

# Workspace manifests first, so the install layer caches until any lockfile
# or package.json changes. bun needs every workspace listed in bun.lock on
# disk, even the ones the filter skips.
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/customer/package.json apps/customer/
COPY apps/seller/package.json apps/seller/
COPY packages/emails/package.json packages/emails/
COPY packages/ui/package.json packages/ui/

# --ignore-scripts skips the root `postinstall: lefthook install`, which
# requires git in $PATH (absent from the slim bun image) and is meaningless
# inside a container anyway.
RUN bun install --frozen-lockfile --ignore-scripts --filter @bibs/api

# API source (only what's needed to build, thanks to .dockerignore), plus the
# workspace packages the API imports: `bun build` bundles them into dist, so
# the runtime stage needs nothing from them.
COPY apps/api apps/api
COPY packages/emails packages/emails

# `bun build` inlines NODE_ENV at build time: without it the bundle stays
# "development" whatever the runtime env says (Mailpit/log emails, localhost CORS).
RUN NODE_ENV=production bun run --cwd apps/api build


# ---------- Runtime stage ----------
FROM oven/bun:1.4-slim
WORKDIR /app/apps/api

# Non-root user. In production the API logs only to stdout (no ./logs), so the
# root-owned WORKDIR needs nothing writable: a file log would crash the boot
# with EACCES, and the CI smoke would catch it.
RUN groupadd -r bibs && useradd -r -g bibs -s /sbin/nologin bibs

# Dependencies, in the same layout as the build stage. bun's isolated linker
# makes apps/api/node_modules a tree of symlinks into the root store
# (/app/node_modules/.bun): copying one without the other leaves them all
# dangling. The bundle carries the JS, but the native `sharp` binary and
# drizzle-kit are resolved from here at runtime.
COPY --from=build --chown=bibs:bibs /app/node_modules /app/node_modules
COPY --from=build --chown=bibs:bibs /app/apps/api/node_modules ./node_modules

# Built JS bundle.
COPY --from=build --chown=bibs:bibs /app/apps/api/dist ./dist

# Drizzle needs the migration SQL files + config at runtime for `db:migrate`.
COPY --from=build --chown=bibs:bibs /app/apps/api/src/db/migrations ./src/db/migrations
COPY --from=build --chown=bibs:bibs /app/apps/api/drizzle.config.ts ./drizzle.config.ts
COPY --from=build --chown=bibs:bibs /app/apps/api/package.json ./package.json

USER bibs
EXPOSE 3000

# Run the bundled API. Migrations should be run as a separate step
# (`bun run db:migrate`) — either as an init container or at deploy time.
CMD ["bun", "dist/index.js"]
