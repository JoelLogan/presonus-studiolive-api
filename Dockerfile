ARG BUILD_FROM=ghcr.io/hassio-addons/base:21.0.11

# ---------------------------------------------------------------------------
# Build stage: compile the library and install production dependencies
# ---------------------------------------------------------------------------
FROM ${BUILD_FROM} AS build

RUN apk add --no-cache nodejs npm

WORKDIR /app

# Install all dependencies (including the TypeScript/swc toolchain) without
# running the prepare script; the source isn't copied yet
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --fetch-timeout=300000 --fetch-retries=5

COPY src/ ./src/
COPY tsconfig.json .swcrc.esm.json .swcrc.cjs.json ./
RUN npm run build \
    && test -f dist/cjs/api.js \
    && npm prune --omit=dev

# Add-on server dependencies (MQTT client)
COPY addon/package.json addon/package-lock.json /addon/
RUN cd /addon && npm ci --omit=dev --fetch-timeout=300000 --fetch-retries=5

# ---------------------------------------------------------------------------
# Runtime image: Node.js, the compiled library and the add-on server only
# ---------------------------------------------------------------------------
FROM ${BUILD_FROM}

RUN apk add --no-cache nodejs

WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /addon/node_modules /addon/node_modules
COPY addon/ /addon/
RUN chmod a+x /addon/run.sh

ARG BUILD_ARCH=amd64
ARG BUILD_VERSION=dev
LABEL \
    io.hass.name="PreSonus StudioLive Control" \
    io.hass.description="Control PreSonus StudioLive III mixers from Home Assistant" \
    io.hass.type="addon" \
    io.hass.arch="${BUILD_ARCH}" \
    io.hass.version="${BUILD_VERSION}" \
    org.opencontainers.image.source="https://github.com/JoelLogan/presonus-studiolive-api" \
    org.opencontainers.image.licenses="MIT"

EXPOSE 8099

CMD [ "/addon/run.sh" ]
