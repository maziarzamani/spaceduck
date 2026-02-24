# syntax=docker/dockerfile:1.7

############################
# Stage 1: Build bundles
############################
FROM oven/bun:1.3.9 AS build

WORKDIR /app

# Copy manifests first for layer caching.
# Bun workspaces require all package.json files for a frozen install.
COPY package.json bun.lock ./
COPY packages/config/package.json packages/config/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/gateway/package.json packages/gateway/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/channels/whatsapp/package.json packages/channels/whatsapp/package.json
COPY packages/providers/gemini/package.json packages/providers/gemini/package.json
COPY packages/providers/openrouter/package.json packages/providers/openrouter/package.json
COPY packages/providers/bedrock/package.json packages/providers/bedrock/package.json
COPY packages/providers/openai-compat/package.json packages/providers/openai-compat/package.json
COPY packages/providers/llamacpp/package.json packages/providers/llamacpp/package.json
COPY packages/providers/lmstudio/package.json packages/providers/lmstudio/package.json
COPY packages/memory/sqlite/package.json packages/memory/sqlite/package.json
COPY packages/tools/browser/package.json packages/tools/browser/package.json
COPY packages/tools/web-fetch/package.json packages/tools/web-fetch/package.json
COPY packages/tools/web-search/package.json packages/tools/web-search/package.json
COPY packages/tools/marker/package.json packages/tools/marker/package.json
COPY packages/stt/whisper/package.json packages/stt/whisper/package.json
COPY apps/cli/package.json apps/cli/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/spaceduck-website/package.json apps/spaceduck-website/package.json

RUN bun install --frozen-lockfile

COPY . .

RUN bun run build
RUN bun run build:cli


############################
# Stage 2: Runtime image
############################
FROM oven/bun:1.3.9-slim AS runtime

ARG GIT_SHA=dev

LABEL org.opencontainers.image.source="https://github.com/maziarzamani/spaceduck"
LABEL org.opencontainers.image.revision="${GIT_SHA}"

WORKDIR /app

# Install sqlite-vec native addon in an isolated directory so we don't mutate
# the app package.json. The addon must match the runtime OS/arch.
WORKDIR /runtime-deps
RUN bun init -y >/dev/null 2>&1 \
  && bun add sqlite-vec@0.1.7-alpha.2

WORKDIR /app

COPY --from=build /app/dist/index.js /app/spaceduck-gateway.js
COPY --from=build /app/dist/cli/index.js /app/spaceduck-cli.js
COPY --from=runtime /runtime-deps/node_modules /app/node_modules

RUN mkdir -p /data

ENV PORT=3000
ENV MEMORY_CONNECTION_STRING=/data/spaceduck.db
ENV NODE_ENV=production
ENV GIT_SHA=${GIT_SHA}

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD bun -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/api/health').then(r => { if (!r.ok) throw new Error('bad status ' + r.status); }).catch(() => process.exit(1))"

CMD ["bun", "run", "/app/spaceduck-gateway.js"]
