FROM node:18-alpine

WORKDIR /app

# Install dependencies first (better cache)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY server.js ./server.js
COPY public ./public

ENV PORT=5000
EXPOSE 5000

CMD ["node", "server.js"]
