FROM node:22-alpine

WORKDIR /app

# Install system dependencies
RUN apk add --no-cache curl

# Copy package manifests
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy full application code
COPY . .

# Build Vite client SPA
RUN npm run build

# Ensure persistent data directory exists
RUN mkdir -p /app/data

# Default Environment Variables
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

# Expose default port
EXPOSE 3000

# Start full-stack server
CMD ["npm", "start"]


