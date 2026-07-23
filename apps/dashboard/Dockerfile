# DealEngine dashboard — build from the monorepo root:
#   docker build -f apps/dashboard/Dockerfile -t dealengine-dashboard .

# ---- Build stage ------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies for the dashboard app only
COPY apps/dashboard/package.json .
RUN npm install

# Copy the app source and build the standalone output
COPY apps/dashboard .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- Runtime stage ----------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -S nextjs && adduser -S nextjs -G nextjs

COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nextjs /app/public ./public

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
