FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache dumb-init openssl
COPY backend/package*.json ./
COPY backend/prisma ./prisma/
COPY backend/tsconfig.json ./
COPY backend/src ./src/
RUN npm install
RUN npx prisma generate
RUN npm run build
RUN mkdir -p /app/prisma
ENV DATABASE_URL="file:/app/prisma/dev.db"
EXPOSE 8080
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "npx prisma db push --accept-data-loss && node dist/index.js"]
