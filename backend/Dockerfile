FROM node:22-slim
# openssl is needed by Prisma's query engine
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
ENV NODE_ENV=production
EXPOSE 4000
# Default: run the API. Compose overrides the command for the worker.
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/seed.ts && npx tsx src/server.ts"]
