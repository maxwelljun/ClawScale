FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @clawscale/api db:generate
RUN pnpm run build

ENV NODE_ENV=production

COPY <<'EOF' /app/start.sh
#!/bin/sh
cd /app/packages/api && npx prisma db push --skip-generate && cd /app
exec HOST=0.0.0.0 PORT=4040 node /app/packages/api/dist/index.js
EOF
RUN chmod +x /app/start.sh

EXPOSE 4040
CMD ["/app/start.sh"]
