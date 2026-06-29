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
ENV PORT=3002
EXPOSE 3002
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
