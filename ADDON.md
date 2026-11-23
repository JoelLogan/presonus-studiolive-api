# PreSonus StudioLive III - Home Assistant Addon

Control your PreSonus StudioLive III mixer directly from Home Assistant!

This add-on connects to a PreSonus StudioLive III mixer (16, 16R, 24R, etc.) and creates Home Assistant entities for the channels you choose: a level slider and a mute switch per channel. The entities follow the mixer's real state, including changes made on the mixer itself or in UC Surface. An HTTP API is also available.

## Installation

### Option 1: Install from GitHub (Recommended for development)

1. In Home Assistant, navigate to **Settings** → **Add-ons** → **Add-on Store**
2. Click the menu (⋮) in the top right corner
3. Select **Repositories**
4. Add this repository URL: `https://github.com/JoelLogan/presonus-studiolive-api`
5. Find "PreSonus StudioLive Control" in the add-on store
6. Click **Install**

### Option 2: Local Installation

1. Copy this entire repository to `/addons/presonus-studiolive` in your Home Assistant configuration directory
2. The addon should appear in your local add-ons

## Configuration

After installation, configure the addon before starting:

```yaml
mixer_ip: "192.168.1.100"  # IP address of your StudioLive mixer
mixer_port: 53000           # Port (default is 53000)
log_level: info             # Log level: debug, info, warn, error
mqtt_enabled: true          # Create Home Assistant entities over MQTT
state_debounce_ms: 300      # How long a channel must be still before its new state is reported to Home Assistant
channels:                   # Channels to expose as entities
  - id: chan_1              # Used in entity IDs: number.presonus_chan_1_level, switch.presonus_chan_1_mute
    name: Channel 1         # Display name
    type: LINE              # LINE, AUX, FX, MAIN, SUB, RETURN, FXRETURN, TALKBACK or DCA
    number: 1               # Channel number on the mixer (use 1 for MAIN)
```

### Finding Your Mixer's IP Address

1. On your mixer, go to **Settings** → **Network**
2. Note the IP address shown
3. Alternatively, check your router's DHCP client list
4. For best results, assign a static IP to your mixer in your router settings

## Home Assistant entities (MQTT)

This is the recommended way to use the add-on.

### Setup

1. Install the **Mosquitto broker** add-on (Settings → Add-ons → Add-on Store) and start it.
2. Home Assistant will offer to set up the **MQTT** integration (Settings → Devices & services). Accept it.
3. List your channels in this add-on's `channels` option and (re)start the add-on.

The add-on finds the broker automatically. A device called **PreSonus StudioLive** appears under the MQTT integration.

### Entities

| Entity | What it does |
| --- | --- |
| `number.presonus_<id>_level` | Fader level, 0–100 (0 = -84 dB, 72 = 0 dB unity, 100 = +10 dB) |
| `switch.presonus_<id>_mute` | Mute (on = muted) |
| `binary_sensor.presonus_mixer_connected` | Whether the add-on is connected to the mixer |
| `switch.presonus_ha_control` | When off, the add-on ignores all changes from Home Assistant (the entities still follow the mixer) |

Channel entities become unavailable while the mixer is disconnected.

### Real-time faders

Changes go straight to the mixer, and each channel gets at most one write every 25 ms (newest value wins, final value always sent). The new state is reported back to Home Assistant only after the channel has been still for `state_debounce_ms`. A dragged fader therefore causes one Home Assistant state change per movement, not hundreds, so it's safe to turn on "update while moving" options in dashboard cards.

If a fader jumps back briefly after you let go, increase `state_debounce_ms`.

## HTTP API

The add-on also exposes an HTTP API on port 8099. From Home Assistant itself, use `http://127.0.0.1:8099`.

### API Endpoints

#### Check Status
```bash
GET http://homeassistant.local:8099/api/status
```

Response:
```json
{
  "connected": true,
  "mixer_ip": "192.168.1.100",
  "mixer_port": 53000
}
```

#### Set Channel Mute
```bash
POST http://homeassistant.local:8099/api/mute
Content-Type: application/json

{
  "channel_type": "LINE",
  "channel_number": 1,
  "muted": true
}
```

#### Set Channel Level
```bash
POST http://homeassistant.local:8099/api/level
Content-Type: application/json

{
  "channel_type": "LINE",
  "channel_number": 1,
  "level": 72
}
```

Level values:
- `0` = -84 dB (minimum)
- `72` = 0 dB (unity gain)
- `100` = +10 dB (maximum)

#### Get State of Configured Channels
```bash
GET http://homeassistant.local:8099/api/state
```

Returns the level and mute state of every channel in the `channels` option.

#### Enable/Disable Control from Home Assistant
```bash
POST http://homeassistant.local:8099/api/control
Content-Type: application/json

{"enabled": false}
```

While disabled, `/api/mute`, `/api/level` and the MQTT entities don't change the mixer.

#### Get Available Channels
```bash
GET http://homeassistant.local:8099/api/channels
```

### Channel Types

- `LINE` - Input channels (1-16 or 1-24 depending on model)
- `AUX` - Auxiliary outputs
- `FX` - Effects buses
- `MAIN` - Main mix
- `DCA` - DCA groups

## Using the HTTP API from Home Assistant

The MQTT entities above are simpler and faster. These examples are for scripts or setups without MQTT.

### REST Commands

Add these to your `configuration.yaml`. Home Assistant core runs on the host network, so it reaches the add-on at `127.0.0.1:8099`. From other devices, use your Home Assistant's address instead (e.g. `homeassistant.local:8099`).

```yaml
rest_command:
  # Mute a channel
  presonus_mute:
    url: "http://127.0.0.1:8099/api/mute"
    method: POST
    content_type: "application/json"
    payload: '{"channel_type": "{{ channel_type }}", "channel_number": {{ channel_number }}, "muted": {{ muted }}}'
  
  # Set channel level
  presonus_level:
    url: "http://127.0.0.1:8099/api/level"
    method: POST
    content_type: "application/json"
    payload: '{"channel_type": "{{ channel_type }}", "channel_number": {{ channel_number }}, "level": {{ level }}}'
```

### Example Automations

#### Mute a channel when you leave home
```yaml
automation:
  - alias: "Mute studio mic when leaving"
    trigger:
      - platform: state
        entity_id: person.your_name
        to: "not_home"
    action:
      - service: rest_command.presonus_mute
        data:
          channel_type: "LINE"
          channel_number: 1
          muted: true
```

#### Set channel level based on time of day
```yaml
automation:
  - alias: "Lower music at night"
    trigger:
      - platform: time
        at: "22:00:00"
    action:
      - service: rest_command.presonus_level
        data:
          channel_type: "LINE"
          channel_number: 5
          level: 30
```

### Scripts

Create reusable scripts in Home Assistant:

```yaml
script:
  # Mute all vocal mics
  mute_all_vocals:
    sequence:
      - service: rest_command.presonus_mute
        data:
          channel_type: "LINE"
          channel_number: 1
          muted: true
      - service: rest_command.presonus_mute
        data:
          channel_type: "LINE"
          channel_number: 2
          muted: true
      - service: rest_command.presonus_mute
        data:
          channel_type: "LINE"
          channel_number: 3
          muted: true
  
  # Set monitor mix levels
  set_monitor_mix:
    sequence:
      - service: rest_command.presonus_level
        data:
          channel_type: "AUX"
          channel_number: 1
          level: 65
```

### Switch Entity for Mute Control

Create a switch to control mute state:

```yaml
switch:
  - platform: template
    switches:
      mic_1_mute:
        friendly_name: "Microphone 1 Mute"
        turn_on:
          service: rest_command.presonus_mute
          data:
            channel_type: "LINE"
            channel_number: 1
            muted: true
        turn_off:
          service: rest_command.presonus_mute
          data:
            channel_type: "LINE"
            channel_number: 1
            muted: false
```

### Number Entity for Level Control

Create a number input to control channel level:

```yaml
input_number:
  mic_1_level:
    name: "Microphone 1 Level"
    min: 0
    max: 100
    step: 1
    initial: 72

automation:
  - alias: "Update mic 1 level"
    mode: restart  # newest value always wins; never drops the final value
    trigger:
      - platform: state
        entity_id: input_number.mic_1_level
    action:
      - service: rest_command.presonus_level
        data:
          channel_type: "LINE"
          channel_number: 1
          level: "{{ states('input_number.mic_1_level') | int }}"
```

### Real-time sliders (updating while you drag)

For dragging faders, use the MQTT entities instead: they skip automations and HTTP requests entirely. If you stay with `input_number` helpers and automations, use `mode: restart` on the level automations (the newest value always wins) and exclude the helpers from `recorder:` and `logbook:`.

## Troubleshooting

### Addon won't start
- Check the logs in the addon page
- Verify the mixer IP address is correct
- Ensure your Home Assistant can reach the mixer on your network
- Make sure port 53000 is not blocked by a firewall

### Cannot connect to mixer
- Verify the mixer is powered on and connected to the network
- Test connectivity: `ping <mixer_ip>` from your Home Assistant host
- Check that no other application is connected to the mixer
- Try power cycling the mixer

### Entities don't appear
- Make sure the Mosquitto broker add-on is running and the MQTT integration is set up
- Check the add-on log for "Connected to MQTT broker"
- Check the `channels` option: invalid entries are listed in the log as "Skipping channel"

### Commands don't work
- Check that `switch.presonus_ha_control` is on
- Check the addon logs for error messages
- Verify you're using the correct channel type and number
- Ensure the addon shows as "connected" in `/api/status`

### Get more detailed logs
Change the `log_level` to `debug` in the addon configuration and restart.

## Support

For issues, questions, or feature requests, please visit:
https://github.com/JoelLogan/presonus-studiolive-api/issues

## Credits

Based on the PreSonus StudioLive III API by featherbear and maintained by JoelLogan.

## License

MIT License - See LICENSE file for details
