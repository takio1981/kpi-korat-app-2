# Stage 1: Create the production environment
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /app

# 1. Install pm2 globally
RUN npm install -g pm2

# 2. Copy package files and install only production dependencies
# This keeps the image small by not including development dependencies.
COPY package.json package-lock.json ./
RUN npm install --omit=dev

# 3. Copy pre-built application code and PM2 configuration
# The user builds the app on the host, and we copy the output.
COPY dist/ ./dist/
COPY ecosystem.config.js ./

# Expose the port the API runs on
EXPOSE 8809

# Start the application using pm2-runtime
# This is the recommended way to run Node.js apps in a container.
CMD ["pm2-runtime", "ecosystem.config.js"]
