FROM oven/bun:1.4.2 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY scripts/patches ./scripts/patches
COPY prisma ./prisma
RUN bun install --frozen-lockfile
COPY . .
ENV DATABASE_URL=file:./dev.db
RUN bunx prisma generate
RUN bun --bun run build
# Download the Lightpanda browser binary explicitly. The @lightpanda/browser
# postinstall downloads it to ~/.cache/lightpanda-node but is wrapped in
# `|| true` (silently fails on flaky network / checksum mismatch), so the
# binary is not guaranteed to exist. bun fetch follows redirects and needs no
# extra packages (the oven/bun image ships no curl).
RUN mkdir -p /root/.cache/lightpanda-node \
	&& bun -e "const res = await fetch('https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-x86_64-linux'); if (!res.ok) throw new Error('lightpanda download failed: ' + res.status); await Bun.write('/root/.cache/lightpanda-node/lightpanda', await res.arrayBuffer());" \
	&& chmod +x /root/.cache/lightpanda-node/lightpanda

FROM oven/bun:1.4.2
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /root/.cache/lightpanda-node /root/.cache/lightpanda-node
COPY --from=build /app/dist ./dist
COPY --from=build /app/backend ./backend
COPY --from=build /app/shared ./shared
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/bun.lock ./bun.lock
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
ENV NODE_ENV=production
ENV DATABASE_URL=file:/data/prod.db
ENV LIGHTPANDA_EXECUTABLE_PATH=/root/.cache/lightpanda-node/lightpanda
ENV RECORDINGS_DIR=/data/recordings
ENV PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && bun run backend/server.ts"]
