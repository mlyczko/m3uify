FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Data is stored in /app/data — mount a volume here for persistence
VOLUME ["/app/data"]

ENV PORT=6767

EXPOSE 6767

CMD ["node", "server.js"]
