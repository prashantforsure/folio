# The Folio worker - ADR 0003 D5: a separate, long-running Node process with its
# own image, deployable to any container host. The web app's hosting is unchanged.
#
# Build from the repository root (the worker bundles code from four workspace
# packages and web):
#
#   docker build -f apps/worker/Dockerfile -t folio-worker .
#
# docs/agents/worker.md has the environment, the health check and the deploy
# steps. The image holds one bundled file and no node_modules.

# --- build: install the worker's slice of the workspace and bundle it ---------
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
# The worker and everything it depends on, web included - web's handlers are
# bundled into the worker. Frozen: the image builds from the committed lockfile.
RUN pnpm install --frozen-lockfile --filter "worker..."
RUN pnpm --filter worker build

# --- run: plain node, one file -------------------------------------------------
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/worker/dist ./dist
USER node
# GET /health - WORKER_HEALTH_PORT, 8080 unless set.
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.WORKER_HEALTH_PORT || 8080) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
# SIGTERM drains: running jobs get 25 s to finish, then 5 s to notice an abort,
# then go back to the queue. Give the container at least 35 s before SIGKILL.
STOPSIGNAL SIGTERM
CMD ["node", "--enable-source-maps", "dist/main.mjs"]
