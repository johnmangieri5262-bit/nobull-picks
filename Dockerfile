# ---- Build stage ----
FROM node:20-alpine AS builder

WORKDIR /app/server
COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev

# ---- Runtime stage ----
FROM node:20-alpine

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy server code
COPY --from=builder /app/server/node_modules ./server/node_modules
COPY server/ ./server/
COPY public/ ./public/

# Create data directory for SQLite
RUN mkdir -p ./server/data && chown -R appuser:appgroup ./server/data

# Environment defaults
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=./data/nobullpicks.db

WORKDIR /app/server

USER appuser

EXPOSE 3000

# Use dumb-init to handle PID 1 and signals properly
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "index.js"]
