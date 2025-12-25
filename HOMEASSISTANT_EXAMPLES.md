# Home Assistant Configuration Examples

This file contains ready-to-use configuration examples for integrating the PreSonus StudioLive Control addon with Home Assistant.

## Basic Setup

### Step 1: Add REST Commands

Add to `configuration.yaml`:

```yaml
rest_command:
  presonus_mute:
    url: "http://homeassistant.local:8099/api/mute"
    method: POST
    content_type: "application/json"
    payload: '{"channel_type": "{{ channel_type }}", "channel_number": {{ channel_number }}, "muted": {{ muted }}}'
  
  presonus_level:
    url: "http://homeassistant.local:8099/api/level"
    method: POST
    content_type: "application/json"
    payload: '{"channel_type": "{{ channel_type }}", "channel_number": {{ channel_number }}, "level": {{ level }}}'
```

## Dashboard Configuration

### Lovelace UI Cards

```yaml
type: vertical-stack
cards:
  # Status Card
  - type: markdown
    content: |
      ## PreSonus StudioLive Mixer
      Control your mixer from Home Assistant
      
  # Mute Controls
  - type: entities
    title: Microphone Mutes
    entities:
      - type: button
        name: Mute Mic 1
        tap_action:
          action: call-service
          service: rest_command.presonus_mute
          data:
            channel_type: LINE
            channel_number: 1
            muted: true
      - type: button
        name: Unmute Mic 1
        tap_action:
          action: call-service
          service: rest_command.presonus_mute
          data:
            channel_type: LINE
            channel_number: 1
            muted: false
  
  # Volume Control
  - type: entities
    title: Channel Levels
    entities:
      - input_number.mic_1_level
```

## Helper Entities

Create these in **Settings** → **Devices & Services** → **Helpers**, or add to `configuration.yaml`:

```yaml
input_boolean:
  mic_1_mute:
    name: Microphone 1 Mute
    icon: mdi:microphone-off
  
  mic_2_mute:
    name: Microphone 2 Mute
    icon: mdi:microphone-off
  
  music_mute:
    name: Music Channel Mute
    icon: mdi:music-off

input_number:
  mic_1_level:
    name: Microphone 1 Level
    min: 0
    max: 100
    step: 1
    initial: 72
    icon: mdi:volume-high
    unit_of_measurement: "%"
  
  mic_2_level:
    name: Microphone 2 Level
    min: 0
    max: 100
    step: 1
    initial: 72
    icon: mdi:volume-high
    unit_of_measurement: "%"
  
  music_level:
    name: Music Level
    min: 0
    max: 100
    step: 1
    initial: 72
    icon: mdi:volume-high
    unit_of_measurement: "%"
```

## Automations

### Sync Mute State to Mixer

```yaml
automation:
  - id: sync_mic_1_mute
    alias: "Sync Mic 1 Mute to Mixer"
    trigger:
      - platform: state
        entity_id: input_boolean.mic_1_mute
    action:
      - service: rest_command.presonus_mute
        data:
          channel_type: LINE
          channel_number: 1
          muted: "{{ is_state('input_boolean.mic_1_mute', 'on') }}"
  
  - id: sync_mic_2_mute
    alias: "Sync Mic 2 Mute to Mixer"
    trigger:
      - platform: state
        entity_id: input_boolean.mic_2_mute
    action:
      - service: rest_command.presonus_mute
        data:
          channel_type: LINE
          channel_number: 2
          muted: "{{ is_state('input_boolean.mic_2_mute', 'on') }}"
```

### Sync Level to Mixer

```yaml
automation:
  - id: sync_mic_1_level
    alias: "Sync Mic 1 Level to Mixer"
    trigger:
      - platform: state
        entity_id: input_number.mic_1_level
    action:
      - service: rest_command.presonus_level
        data:
          channel_type: LINE
          channel_number: 1
          level: "{{ states('input_number.mic_1_level') | int }}"
  
  - id: sync_mic_2_level
    alias: "Sync Mic 2 Level to Mixer"
    trigger:
      - platform: state
        entity_id: input_number.mic_2_level
    action:
      - service: rest_command.presonus_level
        data:
          channel_type: LINE
          channel_number: 2
          level: "{{ states('input_number.mic_2_level') | int }}"
```

### Automatic Mute Based on Conditions

```yaml
automation:
  # Mute all mics when everyone leaves home
  - id: mute_on_away
    alias: "Mute Microphones When Away"
    trigger:
      - platform: state
        entity_id: zone.home
        to: "0"
    action:
      - service: rest_command.presonus_mute
        data:
          channel_type: LINE
          channel_number: 1
          muted: true
      - service: rest_command.presonus_mute
        data:
          channel_type: LINE
          channel_number: 2
          muted: true
      - service: rest_command.presonus_mute
        data:
          channel_type: LINE
          channel_number: 3
          muted: true
  
  # Unmute when someone arrives
  - id: unmute_on_home
    alias: "Unmute Microphones When Home"
    trigger:
      - platform: state
        entity_id: zone.home
        from: "0"
    action:
      - service: rest_command.presonus_mute
        data:
          channel_type: LINE
          channel_number: 1
          muted: false
  
  # Lower music volume at night
  - id: lower_music_at_night
    alias: "Lower Music Volume at Night"
    trigger:
      - platform: time
        at: "22:00:00"
    action:
      - service: rest_command.presonus_level
        data:
          channel_type: LINE
          channel_number: 5
          level: 30
  
  # Restore music volume in the morning
  - id: restore_music_morning
    alias: "Restore Music Volume in Morning"
    trigger:
      - platform: time
        at: "08:00:00"
    action:
      - service: rest_command.presonus_level
        data:
          channel_type: LINE
          channel_number: 5
          level: 72
  
  # Mute all during video calls
  - id: mute_during_call
    alias: "Mute All During Video Call"
    trigger:
      - platform: state
        entity_id: binary_sensor.video_call_active
        to: "on"
    action:
      - service: rest_command.presonus_mute
        data:
          channel_type: LINE
          channel_number: "{{ item }}"
          muted: true
        repeat:
          count: 8
          sequence:
            - service: rest_command.presonus_mute
              data:
                channel_type: LINE
                channel_number: "{{ repeat.index }}"
                muted: true
```

## Scripts

```yaml
script:
  # Preset: Studio Mode
  mixer_preset_studio:
    alias: "Mixer: Studio Mode"
    sequence:
      - service: rest_command.presonus_level
        data:
          channel_type: LINE
          channel_number: 1
          level: 72
      - service: rest_command.presonus_level
        data:
          channel_type: LINE
          channel_number: 2
          level: 72
      - service: rest_command.presonus_mute
        data:
          channel_type: LINE
          channel_number: 3
          muted: true
      - service: rest_command.presonus_level
        data:
          channel_type: LINE
          channel_number: 5
          level: 50
  
  # Preset: Live Performance
  mixer_preset_live:
    alias: "Mixer: Live Performance"
    sequence:
      - service: rest_command.presonus_level
        data:
          channel_type: LINE
          channel_number: 1
          level: 80
      - service: rest_command.presonus_level
        data:
          channel_type: LINE
          channel_number: 2
          level: 75
      - service: rest_command.presonus_mute
        data:
          channel_type: LINE
          channel_number: 3
          muted: false
      - service: rest_command.presonus_level
        data:
          channel_type: LINE
          channel_number: 5
          level: 72
  
  # Emergency: Mute All
  mixer_mute_all:
    alias: "Mixer: Mute All Channels"
    sequence:
      - repeat:
          count: 16
          sequence:
            - service: rest_command.presonus_mute
              data:
                channel_type: LINE
                channel_number: "{{ repeat.index }}"
                muted: true
            - delay:
                milliseconds: 100
  
  # Reset all to unity gain
  mixer_reset_levels:
    alias: "Mixer: Reset All Levels to Unity"
    sequence:
      - repeat:
          count: 16
          sequence:
            - service: rest_command.presonus_level
              data:
                channel_type: LINE
                channel_number: "{{ repeat.index }}"
                level: 72
            - delay:
                milliseconds: 100
```

## Advanced: Template Switches

```yaml
switch:
  - platform: template
    switches:
      mic_1_mute:
        friendly_name: "Microphone 1"
        value_template: "{{ is_state('input_boolean.mic_1_mute', 'on') }}"
        icon_template: >-
          {% if is_state('input_boolean.mic_1_mute', 'on') %}
            mdi:microphone-off
          {% else %}
            mdi:microphone
          {% endif %}
        turn_on:
          - service: input_boolean.turn_on
            target:
              entity_id: input_boolean.mic_1_mute
          - service: rest_command.presonus_mute
            data:
              channel_type: LINE
              channel_number: 1
              muted: true
        turn_off:
          - service: input_boolean.turn_off
            target:
              entity_id: input_boolean.mic_1_mute
          - service: rest_command.presonus_mute
            data:
              channel_type: LINE
              channel_number: 1
              muted: false
```

## Node-RED Flows

If you use Node-RED, here's a simple flow to control the mixer:

```json
[
  {
    "id": "mute_channel",
    "type": "http request",
    "method": "POST",
    "url": "http://homeassistant.local:8099/api/mute",
    "payload": "{\"channel_type\": \"LINE\", \"channel_number\": 1, \"muted\": true}"
  }
]
```

## Troubleshooting Tips

1. **Test the REST command**: Use the Developer Tools → Services to test rest_command services
2. **Check addon logs**: Go to the addon page and view logs for connection issues
3. **Verify network**: Ensure Home Assistant and the mixer are on the same network
4. **Use static IP**: Configure a static IP for your mixer to prevent connection issues

## Tips for Best Results

- Use a static IP address for your mixer
- Keep the addon running continuously (set boot to "auto")
- Test commands in Developer Tools before creating automations
- Start with simple automations and expand gradually
- Monitor the addon logs during initial setup
