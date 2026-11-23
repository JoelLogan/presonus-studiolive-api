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

# MQTT broker credentials come from the Supervisor (Mosquitto broker add-on)
if bashio::services.available "mqtt"; then
    MQTT_HOST=$(bashio::services mqtt "host")
    MQTT_PORT=$(bashio::services mqtt "port")
    MQTT_USER=$(bashio::services mqtt "username")
    MQTT_PASSWORD=$(bashio::services mqtt "password")
    export MQTT_HOST MQTT_PORT MQTT_USER MQTT_PASSWORD
    bashio::log.info "MQTT broker: ${MQTT_HOST}:${MQTT_PORT}"
else
    bashio::log.warning "No MQTT broker found. Install the Mosquitto broker add-on to get Home Assistant entities."
fi

# Start the Node.js server
cd /app
exec node /addon/server.js
