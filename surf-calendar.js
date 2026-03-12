require('dotenv').config();
const axios = require('axios');
const config = require('./config');
const fs = require('fs');
const googleCalendar = require('./google-calendar');
const surfQuality = require('./surf-quality-scoring');

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

// בדיקה אם תנאים עומדים בסף האיכות (משתמש במערכת הניקוד החדשה)
function meetsQualityThreshold(waveHeight, wavePeriod, windSpeed, windDirection = 0) {
  const conditions = { waveHeight, wavePeriod, windSpeed, windDirection };
  const qualityResult = surfQuality.calculateSurfQuality(conditions, config);
  return surfQuality.isQualityScoreAcceptable(qualityResult, config.minQualityScore);
}

// חישוב ציון איכות לשעה (משתמש במערכת הניקוד)
function calculateQualityScore(waveHeight, wavePeriod, windSpeed, windDirection) {
  const conditions = { waveHeight, wavePeriod, windSpeed, windDirection };
  return surfQuality.calculateSurfQuality(conditions, config);
}

// בדיקה אם שעה היא בטווח שעות הגלישה היומי
function isInDailySurfHours(hourTime) {
  const [startHour, startMin] = config.dailySurfHours.start.split(':').map(Number);
  const [endHour, endMin] = config.dailySurfHours.end.split(':').map(Number);

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

// מציאת השעה הטובה ביותר ביום + בדיקת אפשרות ליצור חלון של 3 שעות
function findBestSurfWindow(dayHours) {
  // משקלים לספקי תחזית - NOAA מקבל משקל גבוה יותר
  const weights = {
    'noaa': 0.7,    // 70% - ספק מועדף
    'meteo': 0.15,  // 15%
    'sg': 0.15      // 15%
  };

  // משקלים נפרדים לתקופת גל - NOAA אמין הרבה יותר לתקופה מ-Meteo/SG
  // Meteo ו-SG לרוב מדווחים תקופה נמוכה מאוד (wind chop local) במקום swell period
  const periodWeights = {
    'noaa': 0.9,    // 90% - NOAA הכי מדויק לתקופת swell
    'meteo': 0.05,  // 5%
    'sg': 0.05      // 5%
  };

  // סנן רק שעות שבטווח הגלישה היומי
  const validHours = dayHours.filter(hour => {
    const hourTime = new Date(hour.time);
    return isInDailySurfHours(hourTime);
  });

  if (validHours.length === 0) return null;

  // חשב ציון לכל שעה (משתמש במערכת הניקוד החדשה)
  const hoursWithScores = validHours.map(hour => {
    const waveHeight = calculateWeightedAverage(hour.waveHeight, weights);
    const wavePeriod = calculateWeightedAverage(hour.wavePeriod, periodWeights);
    const windSpeed = calculateWeightedAverage(hour.windSpeed, weights);
    const windDirection = Object.values(hour.windDirection)[0];

    // חשב ציון איכות מלא למערכת הניקוד החדשה
    const qualityResult = calculateQualityScore(waveHeight, wavePeriod, windSpeed, windDirection);

    return {
      time: new Date(hour.time),
      waveHeight,
      wavePeriod,
      windSpeed,
      windDirection,
      score: qualityResult.score, // ציון איכות כולל (0-100)
      qualityBreakdown: qualityResult.breakdown // פירוט הציון
    };
  });

  // מיין לפי ציון מהגבוה לנמוך
  hoursWithScores.sort((a, b) => b.score - a.score);

  // נסה למצוא חלון של 3 שעות סביב השעה הטובה ביותר
  for (const bestHour of hoursWithScores) {
    // בדוק אם השעה הזו עומדת בסף האיכות
    if (!meetsQualityThreshold(bestHour.waveHeight, bestHour.wavePeriod, bestHour.windSpeed, bestHour.windDirection)) {
      continue;
    }

    // נסה ליצור חלון של 3 שעות
    const eventWindow = createThreeHourWindow(bestHour.time, validHours, weights, periodWeights);

    if (eventWindow) {
      return eventWindow;
    }
  }

  return null;
}

// יצירת חלון גלישה סביב שעה נתונה (duration מוגדר ב-config)
function createThreeHourWindow(centerTime, allHours, weights, periodWeights) {
  const [startHour, startMin] = config.dailySurfHours.start.split(':').map(Number);
  const [endHour, endMin] = config.dailySurfHours.end.split(':').map(Number);

  // dailySurfHours are in local time, but forecast data is in UTC
  // We need to work in local time throughout for proper boundary checking
  const eventDurationMinutes = config.eventDuration * 60;

  // Convert centerTime to local time minutes
  const centerDate = new Date(centerTime);
  const centerMinutes = centerDate.getHours() * 60 + centerDate.getMinutes();

  const dayStartMinutes = startHour * 60 + startMin;
  const dayEndMinutes = endHour * 60 + endMin;

  // מרכז החלון סביב השעה הטובה ביותר
  // עבור 2 שעות: שעה לפני ושעה אחרי
  // עבור 3 שעות: שעה לפני ושעתיים אחרי
  const beforeMinutes = eventDurationMinutes <= 120 ? 60 : 60; // Always 1 hour before for now
  let startMinutes = centerMinutes - beforeMinutes;
  let endMinutes = startMinutes + eventDurationMinutes;

  // התאם אם יוצאים מגבולות היום
  if (startMinutes < dayStartMinutes) {
    // צמוד לתחילת היום
    startMinutes = dayStartMinutes;
    endMinutes = startMinutes + eventDurationMinutes;
  }

  // הגבלת שעת סיום מקסימלית - שעה לפני החושך
  // dayEndMinutes = 18:00, אז maxEndMinutes = 17:00
  const maxEndMinutes = dayEndMinutes - 60;

  if (endMinutes > maxEndMinutes) {
    // צמוד לשעת הסיום המקסימלית (17:00)
    // כי אחרי 17:00 כבר מתחיל להחשיך
    endMinutes = maxEndMinutes;
    startMinutes = endMinutes - eventDurationMinutes;
  }

  // וודא שאנחנו עדיין בטווח אחרי ההתאמות
  if (startMinutes < dayStartMinutes || endMinutes > dayEndMinutes) {
    return null; // לא מספיק מקום ליצור חלון
  }

  // מצא את כל השעות בטווח הזה
  // Compare in local time (both sides)
  const windowHours = allHours.filter(hour => {
    const hourTime = new Date(hour.time);
    const hourMinutes = hourTime.getHours() * 60 + hourTime.getMinutes();
    return hourMinutes >= startMinutes && hourMinutes < endMinutes;
  });

  if (windowHours.length === 0) {
    return null; // No hours in the window
  }

  // חשב ממוצעים לחלון
  const waveHeights = windowHours.map(h => calculateWeightedAverage(h.waveHeight, weights));
  const wavePeriods = windowHours.map(h => calculateWeightedAverage(h.wavePeriod, periodWeights));
  const windSpeeds = windowHours.map(h => calculateWeightedAverage(h.windSpeed, weights));
  const windDirections = windowHours.map(h => Object.values(h.windDirection)[0]);

  // בדוק שכל השעות עומדות בסף האיכות
  for (let i = 0; i < windowHours.length; i++) {
    if (!meetsQualityThreshold(waveHeights[i], wavePeriods[i], windSpeeds[i], windDirections[i])) {
      return null; // אחת השעות לא עומדת בקריטריונים
    }
  }

  // קח את הערכים הממוצעים
  const avgWaveHeight = waveHeights.reduce((a, b) => a + b, 0) / waveHeights.length;
  const avgWavePeriod = wavePeriods.reduce((a, b) => a + b, 0) / wavePeriods.length;
  const avgWindSpeed = windSpeeds.reduce((a, b) => a + b, 0) / windSpeeds.length;
  const windDirection = Object.values(windowHours[0].windDirection)[0];

  // צור את זמני האירוע בזמן מקומי
  // Get the date part from centerTime
  const date = new Date(centerTime);
  date.setHours(0, 0, 0, 0);

  // Convert minutes to hours and minutes
  const startHours = Math.floor(startMinutes / 60);
  const startMins = startMinutes % 60;
  const endHours = Math.floor(endMinutes / 60);
  const endMins = endMinutes % 60;

  const eventStart = new Date(date);
  eventStart.setHours(startHours, startMins, 0, 0);

  const eventEnd = new Date(date);
  eventEnd.setHours(endHours, endMins, 0, 0);

  return {
    waveHeight: avgWaveHeight,
    wavePeriod: avgWavePeriod,
    windSpeed: avgWindSpeed,
    windDirection: windDirection,
    startTime: eventStart,
    endTime: eventEnd,
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

  // קבל המלצות לפי תנאי הגלישה
  const recommendations = surfQuality.getSurfingRecommendations(
    forecastData.waveHeight,
    forecastData.windSpeed,
    forecastData.windDirection
  );

  const waveHeightFeet = (forecastData.waveHeight * 3.28).toFixed(1);

  return `${recommendations.emoji} חלון גלישה - ${recommendations.levelHebrew}

נתונים:
• גובה גל: ${forecastData.waveHeight.toFixed(1)} מטר (${waveHeightFeet} פיט)
• תקופה: ${Math.round(forecastData.wavePeriod)} שניות
• רוח: ${windDirectionText} ${Math.round(forecastData.windSpeed)} קשר${windAssessment}

${recommendations.recommendation}
מתאים ל: ${recommendations.audienceHebrew}

• תחזית נכון ל-: ${timestamp}

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
    // בדוק אם יש קובץ שמור ו-cache מופעל (לא ב-CI)
    const useCache = config.cache.enabled && !process.env.CI && fs.existsSync(config.cache.file);
    
    if (useCache) {
      console.log('Using cached forecast data...\n');
      const fileData = fs.readFileSync(config.cache.file, 'utf8');
      forecast = JSON.parse(fileData);
    } else {
      console.log('Fetching fresh forecast from Storm Glass...');
      forecast = await getForecast();

      // שמור לקובץ (רק אם לא ב-CI)
      if (!process.env.CI) {
        fs.writeFileSync(config.cache.file, JSON.stringify(forecast, null, 2));
        console.log('Forecast saved to cache.\n');
      } else {
        console.log('Fresh forecast fetched (not cached in CI).\n');
      }
    }

    // קבל אישור לגוגל קלנדר
    const auth = await googleCalendar.authorize();

    // עיבוד 48 שעות קדימה
    const now = new Date();
    const horizonEnd = new Date(now.getTime() + (config.forecast.horizonHours * 60 * 60 * 1000));

    // קבץ שעות לפי יום (ממיר swellHeight/swellPeriod ל-waveHeight/wavePeriod)
    const dailyHours = {};
    forecast.hours.forEach(hour => {
      const hourTime = new Date(hour.time);
      if (hourTime >= now && hourTime <= horizonEnd) {
        const dateStr = hourTime.toISOString().split('T')[0];
        if (!dailyHours[dateStr]) dailyHours[dateStr] = [];

        // ממיר swellHeight/swellPeriod ל-waveHeight/wavePeriod למען עקביות בקוד
        const normalizedHour = {
          time: hour.time,
          waveHeight: hour.swellHeight || hour.waveHeight,  // משתמש ב-swellHeight, נופל ל-waveHeight אם לא קיים
          wavePeriod: hour.swellPeriod || hour.wavePeriod,  // משתמש ב-swellPeriod, נופל ל-wavePeriod אם לא קיים
          windSpeed: hour.windSpeed,
          windDirection: hour.windDirection
        };

        dailyHours[dateStr].push(normalizedHour);
      }
    });

    // עיבוד כל יום
    const processedDates = Object.keys(dailyHours).sort();

    for (const dateStr of processedDates) {
      const dayHours = dailyHours[dateStr];
      const date = new Date(dateStr);

      console.log(`\n📅 Processing ${date.toLocaleDateString('he-IL')}`);

      // מצא את חלון הגלישה הטוב ביותר ביום
      const bestWindow = findBestSurfWindow(dayHours);

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

      if (bestWindow) {
        // יש תנאים טובים
        const recommendations = surfQuality.getSurfingRecommendations(
          bestWindow.waveHeight,
          bestWindow.windSpeed,
          bestWindow.windDirection
        );
        const title = `${recommendations.emoji} חלון גלישה - ${recommendations.levelHebrew}`;
        const description = createEventDescription(bestWindow, timestamp);

        const eventDetails = {
          title: title,
          description: description,
          startDateTime: bestWindow.startTime.toISOString(),
          endDateTime: bestWindow.endTime.toISOString(),
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
          const startTime = bestWindow.startTime.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
          const endTime = bestWindow.endTime.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
          console.log(`  ✅ Creating new surf window event (${startTime}-${endTime})`);
          await googleCalendar.createOrUpdateEvent(auth, eventDetails);
        }

        console.log(`     Wave: ${bestWindow.waveHeight.toFixed(1)}m @ ${Math.round(bestWindow.wavePeriod)}s`);
        console.log(`     Wind: ${getWindDirectionText(bestWindow.windDirection)} ${Math.round(bestWindow.windSpeed)} knots`);

      } else {
        // אין תנאים טובים
        if (existingEvent && !existingEvent.summary.includes('התנאים נחלשו')) {
          // הידרדרות - מחק את האירוע במקום לעדכן אותו
          console.log(`  ↘️  Conditions degraded - deleting event`);

          try {
            await googleCalendar.deleteEvent(auth, existingEvent.id);
            console.log(`     ✓ Event deleted`);
          } catch (error) {
            console.log(`     ✗ Failed to delete event: ${error.message}`);
          }
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
  calculateQualityScore,
  findBestSurfWindow,
  createThreeHourWindow,
  getWindDirectionText,
  createEventDescription
};