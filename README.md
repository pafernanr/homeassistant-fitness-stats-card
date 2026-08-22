# Fitness Stats Card

Custom Home Assistant Lovelace card for displaying fitness machine training statistics with period navigation.

Works with any FTMS (Fitness Machine Service) integration — cross trainers, treadmills, indoor bikes, rowers.

## Features

- **Period navigation**: week / month / year views with previous/next
- **Summary**: session count, distance, calories, time with delta vs previous period
- **Bar chart**: per-day or per-month breakdown with metric selector
- **Goals**: weekly progress bars (sessions, distance, calories, time)
- **Averages & Personal Bests**: per-session averages and peak values

## Installation

### HACS (recommended)

1. Open HACS → Frontend → three-dot menu → **Custom repositories**
2. Add `https://github.com/pafernanr/homeassistant-fitness-stats-card` as **Dashboard**
3. Search "Fitness Stats Card" and install
4. Restart Home Assistant

### Manual

1. Download `fitness-stats-card.js` to your `www/` folder
2. Add resource in Settings → Dashboards → Resources:
   - URL: `/local/fitness-stats-card.js`
   - Type: JavaScript Module

## Configuration

```yaml
type: custom:fitness-stats-card
name: Cross Trainer
entities:
  distance: sensor.bicibh_distance_total
  calories: sensor.bicibh_energy_total
  time: sensor.bicibh_time_elapsed
  speed: sensor.bicibh_speed
  power: sensor.bicibh_power
  heart_rate: sensor.bicibh_heart_rate
default_period: week
goals:
  sessions: 4
  distance: 20000
  calories: 2000
```

### Entity keys

Add only the entities your machine exposes:

| Key | Type | Description |
|-----|------|-------------|
| `distance` | total | Total distance |
| `calories` | total | Total energy |
| `time` | total | Elapsed time |
| `speed` | measurement | Speed |
| `power` | measurement | Power |
| `heart_rate` | measurement | Heart rate |
| `cadence` | measurement | Cadence (indoor bike) |
| `step_rate` | measurement | Step rate (cross trainer) |
| `stroke_rate` | measurement | Stroke rate (rower) |
| `resistance` | measurement | Resistance level |

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `name` | Fitness Stats | Card title |
| `default_period` | week | Initial period view: `week`, `month`, `year` |
| `goals` | — | Weekly goals (shown in week view only) |

## Data source

Uses Home Assistant long-term statistics (kept indefinitely). Requires entities with `state_class` set — standard FTMS integrations provide this automatically.
