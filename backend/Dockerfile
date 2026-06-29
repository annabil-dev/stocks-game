FROM node:20-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init openssl && rm -rf /var/lib/apt/lists/*
COPY backend/package*.json ./
COPY backend/prisma ./prisma/
RUN npm install
RUN npx prisma generate
RUN npm run build
COPY backend/ .
RUN mkdir -p /app/prisma
EXPOSE 3002
ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "start"]
