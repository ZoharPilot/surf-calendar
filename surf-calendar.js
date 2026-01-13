require('dotenv').config();
const axios = require('axios');
const config = require('./config');
const fs = require('fs');
const googleCalendar = require('./google-calendar');

// פונקציה להמרת כיוון רוח למטריקס למחרוזת בעברית
function getWindDirectionText(degrees) {
  const directions = [
    'צפון', 'צפון-מזרח', 'מזרח', 'דרום-מזרח',
    'דרום', 'דרום-מערב', 'מערב', 'צפון-מערב'
  ];

  // המר מעלות לכיוון (0 = צפון, 45 = צפון-מזרח, וכו')
  const index = Math.round(degrees / 45) % 8;
  return directions[index];
}

// פונקציה לקבלת תחזית מ-Storm Glass
async function getForecast() {
  const url = 'https://api.stormglass.io/v2/weather/point';

  const params = {
    lat: config.location.lat,
    lng: config.location.lng,
    params: config.stormGlass.params
  };

  try {
    const response = await axios.get(url, {
      params: params,
      headers: {
        'Authorization': config.stormGlass.apiKey
      }
    });

    return response.data;
  } catch (error) {
    console.error(`Error fetching forecast for ${config.location.name}:`, error.message);
    throw error;
  }
}

// בדיקה אם תנאים עומדים בסף האיכות
function meetsQualityThreshold(waveHeight, wavePeriod, windSpeed) {
  return (
    waveHeight >= config.thresholds.minWaveHeight &&
    waveHeight <= config.thresholds.maxWaveHeight &&
    wavePeriod >= config.thresholds.minWavePeriod &&
    windSpeed <= config.thresholds.maxWindSpeed
  );
}

// בדיקה אם חלון זמן הוא בחלון גלישה
function isInSurfWindow(hourTime, windowStart, windowEnd) {
  const [startHour, startMin] = windowStart.split(':').map(Number);
  const [endHour, endMin] = windowEnd.split(':').map(Number);

  const windowStartMinutes = startHour * 60 + startMin;
  const windowEndMinutes = endHour * 60 + endMin;
  const hourMinutes = hourTime.getHours() * 60 + hourTime.getMinutes();

  return hourMinutes >= windowStartMinutes && hourMinutes < windowEndMinutes;
}

// חישוב ממוצע משוקלל של ספקי תחזית לשעה אחת
function calculateWeightedAverage(hourData, weights) {
  let totalWeight = 0;
  let weightedSum = 0;

  for (const [provider, value] of Object.entries(hourData)) {
    const weight = weights[provider] || 0;
    weightedSum += value * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

// חישוב ממוצע של שעות בחלון זמן
function calculateWindowAverage(hours, windowStart, windowEnd) {
  const windowHours = hours.filter(hour => {
    const hourTime = new Date(hour.time);
    return isInSurfWindow(hourTime, windowStart, windowEnd);
  });

  if (windowHours.length === 0) return null;

  // משקלים לספקי תחזית - NOAA מקבל משקל גבוה יותר
  const weights = {
    'noaa': 0.7,    // 70% - ספק מועדף
    'meteo': 0.15,  // 15%
    'sg': 0.15      // 15%
  };

  // חשב ממוצע משוקלל לכל שעה, ואז קח את המקסימום
  const waveHeightAverages = windowHours.map(h => calculateWeightedAverage(h.waveHeight, weights));
  const wavePeriodAverages = windowHours.map(h => calculateWeightedAverage(h.wavePeriod, weights));
  const windSpeedAverages = windowHours.map(h => calculateWeightedAverage(h.windSpeed, weights));

  // משתמש בערך המקסימלי כדי להיות יותר אופטימי
  const avgWaveHeight = Math.max(...waveHeightAverages);
  const avgWavePeriod = Math.max(...wavePeriodAverages);
  const avgWindSpeed = Math.max(...windSpeedAverages);

  // קח את כיוון הרוח מהשעה הראשונה (הכי מייצג)
  const windDirection = Object.values(windowHours[0].windDirection)[0];

  return {
    waveHeight: avgWaveHeight,
    wavePeriod: avgWavePeriod,
    windSpeed: avgWindSpeed,
    windDirection: windDirection,
    hourCount: windowHours.length
  };
}

// יצירת תיאור אירוע בעברית
function createEventDescription(forecastData, timestamp) {
  const windDirectionText = getWindDirectionText(forecastData.windDirection);

  // הערכת כיוון רוח (offshore/onshore) להרצליה
  let windAssessment = '';
  const windDirDegrees = forecastData.windDirection;
  // הרצליה: רוחות מ-270°-360° (מערב-צפון) הן offshore, 90°-270° (מזרח-דרום) הן onshore
  if (windDirDegrees >= 270 || windDirDegrees <= 90) {
    windAssessment = ' (offshore)';
  } else if (windDirDegrees > 90 && windDirDegrees < 270) {
    windAssessment = ' (onshore)';
  }

  return `חלון גלישה טוב בהרצליה

נתונים:
• גובה גל: ${forecastData.waveHeight.toFixed(1)} מטר (${(forecastData.waveHeight * 3.28).toFixed(1)} פיט)
• תקופה: ${Math.round(forecastData.wavePeriod)} שניות
• רוח: ${windDirectionText} ${Math.round(forecastData.windSpeed)} קשר${windAssessment}
• עודכן לאחרונה: ${timestamp}

תחזית אוטומטית. התנאים עשויים להשתנות.
יש לבדוק את מצב הים בשטח.`;
}

// עיבוד תחזית והחלטה על אירועים
async function processForecast() {
  console.log('🏄 Surf Calendar MVP - Herzliya 🏄');
  console.log(`Checking surf conditions for ${config.location.name}...`);
  console.log('='.repeat(60));

  let forecast;

  try {
    // בדוק אם יש קובץ שמור ו-cache מופעל
    if (config.cache.enabled && fs.existsSync(config.cache.file)) {
      console.log('Using cached forecast data...\n');
      const fileData = fs.readFileSync(config.cache.file, 'utf8');
      forecast = JSON.parse(fileData);
    } else {
      console.log('Fetching fresh forecast from Storm Glass...');
      forecast = await getForecast();

      // שמור לקובץ
      fs.writeFileSync(config.cache.file, JSON.stringify(forecast, null, 2));
      console.log('Forecast saved to cache.\n');
    }

    // קבל אישור לגוגל קלנדר
    const auth = await googleCalendar.authorize();

    // עיבוד 48 שעות קדימה
    const now = new Date();
    const horizonEnd = new Date(now.getTime() + (config.forecast.horizonHours * 60 * 60 * 1000));

    // קבץ שעות לפי יום
    const dailyHours = {};
    forecast.hours.forEach(hour => {
      const hourTime = new Date(hour.time);
      if (hourTime >= now && hourTime <= horizonEnd) {
        const dateStr = hourTime.toISOString().split('T')[0];
        if (!dailyHours[dateStr]) dailyHours[dateStr] = [];
        dailyHours[dateStr].push(hour);
      }
    });

    // עיבוד כל יום
    const processedDates = Object.keys(dailyHours).sort();

    for (const dateStr of processedDates) {
      const dayHours = dailyHours[dateStr];
      const date = new Date(dateStr);

      console.log(`\n📅 Processing ${date.toLocaleDateString('he-IL')}`);

      // חשב ממוצעים לחלונות
      const morningAvg = calculateWindowAverage(dayHours, config.timeWindows.morning.start, config.timeWindows.morning.end);
      const afternoonAvg = calculateWindowAverage(dayHours, config.timeWindows.afternoon.start, config.timeWindows.afternoon.end);
      const eveningAvg = calculateWindowAverage(dayHours, config.timeWindows.evening.start, config.timeWindows.evening.end);

      // קבע איזה חלון לבחור - בחר את התנאים הטובים ביותר מבין כל החלונות שטובים
      let selectedWindow = null;
      let windowType = null;
      let bestWaveHeight = 0;

      // בדוק כל חלון ובחר את הטוב ביותר
      const windows = [
        { avg: morningAvg, type: 'morning' },
        { avg: afternoonAvg, type: 'afternoon' },
        { avg: eveningAvg, type: 'evening' }
      ];

      for (const { avg, type } of windows) {
        if (avg && meetsQualityThreshold(avg.waveHeight, avg.wavePeriod, avg.windSpeed)) {
          // בחר לפי גובה הגל הגבוה ביותר
          if (avg.waveHeight > bestWaveHeight) {
            selectedWindow = avg;
            windowType = type;
            bestWaveHeight = avg.waveHeight;
          }
        }
      }

      // בדוק אם יש אירוע קיים
      const existingEvents = await googleCalendar.getExistingEvents(auth, date);
      const existingEvent = existingEvents.length > 0 ? existingEvents[0] : null;

      const timestamp = new Date().toLocaleString('he-IL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      if (selectedWindow) {
        // יש תנאים טובים
        const title = 'חלון גלישה טוב - הרצליה';
        const description = createEventDescription(selectedWindow, timestamp);

        // קבע זמני אירוע
        let windowConfig;
        if (windowType === 'morning') {
          windowConfig = config.timeWindows.morning;
        } else if (windowType === 'afternoon') {
          windowConfig = config.timeWindows.afternoon;
        } else {
          windowConfig = config.timeWindows.evening;
        }

        const [startHour, startMin] = windowConfig.start.split(':');
        const [endHour, endMin] = windowConfig.end.split(':');

        const eventStart = new Date(date);
        eventStart.setHours(parseInt(startHour), parseInt(startMin), 0, 0);

        const eventEnd = new Date(date);
        eventEnd.setHours(parseInt(endHour), parseInt(endMin), 0, 0);

        const eventDetails = {
          title: title,
          description: description,
          startDateTime: eventStart.toISOString(),
          endDateTime: eventEnd.toISOString(),
          date: dateStr
        };

        if (existingEvent) {
          if (existingEvent.summary.includes('התנאים נחלשו')) {
            // התאוששות - חזרה לתנאים טובים
            console.log(`  ↗️  Conditions recovered - updating event`);
            await googleCalendar.createOrUpdateEvent(auth, eventDetails);
          } else {
            // עדכון אירוע קיים עם נתונים חדשים
            console.log(`  📝 Updating existing good conditions event`);
            await googleCalendar.createOrUpdateEvent(auth, eventDetails);
          }
        } else {
          // יצירת אירוע חדש
          console.log(`  ✅ Creating new surf window event (${windowType})`);
          await googleCalendar.createOrUpdateEvent(auth, eventDetails);
        }

        console.log(`     Wave: ${selectedWindow.waveHeight.toFixed(1)}m @ ${Math.round(selectedWindow.wavePeriod)}s`);
        console.log(`     Wind: ${getWindDirectionText(selectedWindow.windDirection)} ${Math.round(selectedWindow.windSpeed)} knots`);

      } else {
        // אין תנאים טובים
        if (existingEvent && !existingEvent.summary.includes('התנאים נחלשו')) {
          // הידרדרות - עדכן כותרת
          console.log(`  ↘️  Conditions degraded - updating event title`);

          const degradedTitle = 'חלון גלישה - התנאים נחלשו';
          const lastKnownGood = existingEvent.description.match(/גובה גל: ([\d.]+) מטר/) ?
            existingEvent.description : 'תחזית מעודכנת לא זמינה';

          const degradedDescription = `התנאים הידרדרו מתחת לסף הנדרש

${lastKnownGood ? `תחזית אחרונה: ${lastKnownGood[0]}` : 'נתוני תחזית קודמים לא זמינים'}

תחזית עודכנה: ${timestamp}

זוהי תחזית אוטומטית. התנאים עשויים להשתנות.`;

          const eventDetails = {
            title: degradedTitle,
            description: degradedDescription,
            startDateTime: existingEvent.start.dateTime,
            endDateTime: existingEvent.end.dateTime,
            date: dateStr
          };

          await googleCalendar.createOrUpdateEvent(auth, eventDetails);
        } else {
          // אין אירוע קיים או שהוא כבר מסומן כמוחלש - אל תעשה כלום
          console.log(`  ❌ No good surf conditions - no action needed`);
        }
      }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log('✅ Forecast processing completed!');
    console.log(`${'='.repeat(60)}`);

  } catch (error) {
    console.error(`Failed to process forecast:`, error.message);
    throw error;
  }
}

// פונקציה ראשית
async function main() {
  try {
    await processForecast();
  } catch (error) {
    console.error('Application error:', error.message);
    process.exit(1);
  }
}

// הרץ את הסקריפט
if (require.main === module) {
  main();
}

module.exports = {
  processForecast,
  meetsQualityThreshold,
  calculateWindowAverage,
  getWindDirectionText,
  createEventDescription
};