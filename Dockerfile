FROM node:22-alpine

WORKDIR /app

# Install system dependencies
RUN apk add --no-cache curl

# Copy package manifests
COPY package*.json ./

# Install dependencies (works with or without lockfile)
RUN npm install

# Copy full application code
COPY . .

# Build Vite client SPA
RUN npm run build

# Default Environment
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

# Ensure persistent data directory exists
RUN mkdir -p /app/data

# Expose default port
EXPOSE 3000

# Start full-stack server
CMD ["npm", "start"]

