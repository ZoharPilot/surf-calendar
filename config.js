require('dotenv').config();

module.exports = {
  // Herzliya location
  location: {
    name: 'הרצליה',
    lat: parseFloat(process.env.HERZLIYA_LAT || '32.1752'),
    lng: parseFloat(process.env.HERZLIYA_LON || '34.7998'),
    timezone: process.env.TIMEZONE || 'Asia/Jerusalem'
  },

  // Surf quality thresholds
  thresholds: {
    minWaveHeight: parseFloat(process.env.MIN_WAVE_HEIGHT || '0.3'),
    maxWaveHeight: parseFloat(process.env.MAX_WAVE_HEIGHT || '2.5'),
    minWavePeriod: parseFloat(process.env.MIN_WAVE_PERIOD || '6'),
    maxWindSpeed: parseFloat(process.env.MAX_WIND_SPEED || '8')
  },

  // Surf time windows
  timeWindows: {
    morning: {
      start: process.env.MORNING_START || '06:00',
      end: process.env.MORNING_END || '10:00'
    },
    afternoon: {
      start: process.env.AFTERNOON_START || '11:00',
      end: process.env.AFTERNOON_END || '15:00'
    },
    evening: {
      start: process.env.EVENING_START || '16:00',
      end: process.env.EVENING_END || '19:00'
    }
  },

  // Google Calendar
  calendar: {
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    serviceAccountKey: process.env.GOOGLE_SERVICE_ACCOUNT_KEY || './credentials.json'
  },

  // Storm Glass API
  stormGlass: {
    apiKey: process.env.STORMGLASS_API_KEY,
    params: 'waveHeight,wavePeriod,windSpeed,windDirection'
  },

  // Forecast settings
  forecast: {
    horizonHours: parseInt(process.env.FORECAST_HORIZON_HOURS || '48')
  },

  // Cache settings
  cache: {
    enabled: true,
    file: 'forecast-cache-herzliya.json'
  }
};