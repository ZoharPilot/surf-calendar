require('dotenv').config();

module.exports = {
  // Herzliya location
  location: {
    name: 'הרצליה',
    lat: parseFloat(process.env.HERZLIYA_LAT || '32.1752'),
    lng: parseFloat(process.env.HERZLIYA_LON || '34.7998'),
    timezone: process.env.TIMEZONE || 'Asia/Jerusalem'
  },

  // Hard requirements (must meet these or rejected completely)
  hardRequirements: {
    minWaveHeight: parseFloat(process.env.MIN_WAVE_HEIGHT || '0.3'),
    maxWaveHeight: parseFloat(process.env.MAX_WAVE_HEIGHT || '2.5'),
    minWavePeriod: parseFloat(process.env.MIN_WAVE_PERIOD || '6'),
    maxWindSpeed: parseFloat(process.env.MAX_WIND_SPEED || '8')
  },

  // Optimal ranges for quality scoring
  optimalRanges: {
    waveHeight: {
      min: parseFloat(process.env.OPTIMAL_WAVE_HEIGHT_MIN || '0.8'),
      max: parseFloat(process.env.OPTIMAL_WAVE_HEIGHT_MAX || '1.5')
    },
    wavePeriod: {
      min: parseFloat(process.env.OPTIMAL_WAVE_PERIOD_MIN || '8'),
      max: parseFloat(process.env.OPTIMAL_WAVE_PERIOD_MAX || '12')
    },
    windSpeed: {
      perfect: parseFloat(process.env.OPTIMAL_WIND_SPEED_PERFECT || '3'),
      excellent: parseFloat(process.env.OPTIMAL_WIND_SPEED_EXCELLENT || '5'),
      acceptable: parseFloat(process.env.OPTIMAL_WIND_SPEED_ACCEPTABLE || '8')
    }
  },

  // Weights for quality scoring (must sum to 1.0)
  // Period is MOST important - offshore swell with short period = wind chop
  qualityWeights: {
    wavePeriod: parseFloat(process.env.WEIGHT_WAVE_PERIOD || '0.50'),    // 50% - Most critical
    waveHeight: parseFloat(process.env.WEIGHT_WAVE_HEIGHT || '0.30'),    // 30% - Important but secondary
    windSpeed: parseFloat(process.env.WEIGHT_WIND_SPEED || '0.15'),      // 15% - Less critical (location-dependent)
    windDirection: parseFloat(process.env.WEIGHT_WIND_DIRECTION || '0.05') // 5% - Least critical
  },

  // Minimum quality score to consider creating an event (0-100)
  minQualityScore: parseInt(process.env.MIN_QUALITY_SCORE || '65'),

  // Daily surf hours range (when surfing is possible)
  dailySurfHours: {
    start: process.env.SURF_DAY_START || '06:00',
    end: process.env.SURF_DAY_END || '18:00'
  },

  // Event duration in hours (2 hours = more precise, more opportunities)
  eventDuration: parseInt(process.env.EVENT_DURATION_HOURS || '2'),

  // Google Calendar
  calendar: {
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    serviceAccountKey: process.env.GOOGLE_SERVICE_ACCOUNT_KEY || './credentials.json'
  },

  // Storm Glass API
  stormGlass: {
    apiKey: process.env.STORMGLASS_API_KEY,
    params: 'swellHeight,swellPeriod,windSpeed,windDirection'
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