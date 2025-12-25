#!/usr/bin/with-contenv bashio

# Get configuration from Home Assistant
MIXER_IP=$(bashio::config 'mixer_ip')
MIXER_PORT=$(bashio::config 'mixer_port')
LOG_LEVEL=$(bashio::config 'log_level')

# Export as environment variables
export MIXER_IP
export MIXER_PORT
export LOG_LEVEL

bashio::log.info "Starting PreSonus StudioLive Control Addon"
bashio::log.info "Mixer IP: ${MIXER_IP}"
bashio::log.info "Mixer Port: ${MIXER_PORT}"

# Start the Node.js server
cd /app
exec node /addon/server.js
