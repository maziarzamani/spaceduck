# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.9-slim

ARG GIT_SHA=dev

LABEL org.opencontainers.image.source="https://github.com/maziarzamani/spaceduck"
LABEL org.opencontainers.image.revision="${GIT_SHA}"

WORKDIR /app

# Copy everything, then install.
# Bun workspaces need source files present to create workspace links.
COPY . .
RUN bun install --frozen-lockfile

RUN mkdir -p /data

ENV PORT=3000
ENV MEMORY_CONNECTION_STRING=/data/spaceduck.db
ENV NODE_ENV=production
ENV GIT_SHA=${GIT_SHA}

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD bun -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/api/health').then(r => { if (!r.ok) throw new Error('bad status ' + r.status); }).catch(() => process.exit(1))"

CMD ["bun", "run", "packages/gateway/src/index.ts"]
