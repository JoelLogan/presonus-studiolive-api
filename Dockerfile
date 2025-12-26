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

# Install dependencies without running prepare script (skip build for now)
# Use npm ci for faster, more reliable installs with clean slate
# Increase timeout to handle large binary downloads (like @swc/core)
RUN npm ci --ignore-scripts --fetch-timeout=300000 --fetch-retries=5

# Copy source files and configuration (needed for build)
COPY src/ ./src/
COPY tsconfig.json .
COPY .swcrc.esm.json .
COPY .swcrc.cjs.json .

# Now build the project
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
