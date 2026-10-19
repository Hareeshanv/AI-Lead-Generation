# syntax=docker/dockerfile:1
# Build from the repo root:  docker build -f apps/api/Dockerfile -t ai-lead-gen-api .
# The API, packages/database and services/* are bundled by esbuild into one file (dist/index.js),
# so the runtime image needs no node_modules.

ARG NODE_VERSION=20

FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /repo
RUN corepack enable

# Every workspace manifest, so the frozen lockfile matches; only the API's dependency graph is installed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/database/package.json packages/database/
COPY tests/package.json tests/
RUN pnpm install --frozen-lockfile --filter "@ai-lead-gen/api..."

COPY apps/api apps/api
COPY packages/database packages/database
COPY services services
RUN pnpm --filter @ai-lead-gen/api build

FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production \
    PORT=4000
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
USER node
EXPOSE 4000
# /api/health answers 503 until the database is reachable.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO /dev/null "http://127.0.0.1:${PORT}/api/health" || exit 1
CMD ["node", "--enable-source-maps", "dist/index.js"]
