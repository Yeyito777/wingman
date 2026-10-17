# Wingman server: one container, no database (groups live in memory and are deleted when they end).
FROM docker.io/oven/bun:1 AS app
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY tsconfig.json ./
COPY src ./src
COPY shared ./shared
COPY public ./public
# Host checkouts may be umask 077; make sure the unprivileged user can read the app.
RUN chmod -R a+rX /app
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
USER bun
HEALTHCHECK --interval=30s --timeout=3s CMD bun -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "src/server/index.ts"]
