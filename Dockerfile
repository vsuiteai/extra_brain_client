FROM node:18-alpine

# Set working dir
WORKDIR /usr/src/app

# Install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy source
COPY . .

# Expose port
EXPOSE 8080

# Start the app
CMD ["node", "api/server.js"]
