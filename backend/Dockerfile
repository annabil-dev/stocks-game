FROM node:20-slim

WORKDIR /app

# Install build tools for ts-node/tsx
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init && rm -rf /var/lib/apt/lists/*

COPY backend/package*.json ./
COPY backend/prisma ./prisma/

RUN npm install
RUN npx prisma generate

COPY backend/ .

# Create data dir for SQLite persistence
RUN mkdir -p /app/prisma

EXPOSE 3001

ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "run", "dev"]