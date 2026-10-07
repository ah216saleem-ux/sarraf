FROM node:22-alpine

WORKDIR /app

# Install system dependencies
RUN apk add --no-cache curl

# Copy package manifests
COPY package*.json ./

# Install npm dependencies
RUN npm ci

# Copy full application code
COPY . .

# Build Vite client SPA
RUN npm run build

# Default Environment
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

# Ensure data directory exists
RUN mkdir -p /app/data

# Expose server port
EXPOSE 3000

# Start full-stack server
CMD ["node", "--import", "tsx", "server.ts"]
