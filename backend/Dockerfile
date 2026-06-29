FROM node:20-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init openssl && rm -rf /var/lib/apt/lists/*
COPY backend/package*.json ./
COPY backend/prisma ./prisma/
COPY backend/tsconfig.json ./
COPY backend/src ./src/
RUN npm install
RUN npx prisma generate
RUN npm run build
RUN mkdir -p /app/prisma
EXPOSE 3002
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
