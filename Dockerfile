ARG BUILD_FROM=ghcr.io/hassio-addons/base:15.0.1
FROM ${BUILD_FROM}

# Install Node.js and npm
RUN apk add --no-cache \
    nodejs \
    npm

# Set working directory
WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install all dependencies (needed for build)
RUN npm install

# Copy source files
COPY src/ ./src/
COPY tsconfig.json .
COPY .swcrc.esm.json .
COPY .swcrc.cjs.json .

# Build the project
RUN npm run build

# Remove dev dependencies to reduce image size
RUN npm prune --omit=dev

# Copy addon files
COPY addon/ /addon/

# Make run script executable
RUN chmod a+x /addon/run.sh

# Expose API port
EXPOSE 8099

# Start the addon
CMD [ "/addon/run.sh" ]
