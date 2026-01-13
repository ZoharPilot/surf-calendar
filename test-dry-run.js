require('dotenv').config();
const axios = require('axios');
const config = require('./config');
const fs = require('fs');
const { meetsQualityThreshold, calculateWindowAverage, getWindDirectionText } = require('./surf-calendar');

// פונקציה לקבלת תחזית מ-Storm Glass (אותו דבר כמו ב-main)
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

// יצירת תיאור אירוע בעברית (אותו דבר כמו ב-main)
function createEventDescription(forecastData, timestamp) {
  const windDirectionText = getWindDirectionText(forecastData.windDirection);

  return `תנאי גלישה טובים בהרצליה

פרטי התחזית:
• גובה גלים: ${forecastData.waveHeight.toFixed(1)} מטר
• תקופת גלים: ${Math.round(forecastData.wavePeriod)} שניות
• רוח: ${windDirectionText} ${Math.round(forecastData.windSpeed)} קשר

תחזית עודכנה: ${timestamp}

זוהי תחזית אוטומטית. התנאים עשויים להשתנות.
מומלץ לבדוק את התנאים בשטח לפני כניסה למים.`;
}

// סימולציה של אירוע קיים (לצורך בדיקה)
function simulateExistingEvent(date, isGood) {
  return {
    summary: isGood ? 'חלון גלישה טוב - הרצליה' : 'חלון גלישה - התנאים נחלשו',
    description: 'תחזית קודמת: גובה גלים: 1.2 מטר',
    start: { dateTime: new Date(date).toISOString() },
    end: { dateTime: new Date(date).toISOString() }
  };
}

// הרצת בדיקה יבשה
async function runDryRun() {
  console.log('🏄 DRY RUN - Surf Calendar MVP - Herzliya 🏄');
  console.log('This will show what WOULD happen without creating actual events\n');
  console.log(`Checking surf conditions for ${config.location.name}...`);
  console.log('='.repeat(70));

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

      console.log(`\n📅 ${date.toLocaleDateString('he-IL')} (${dateStr})`);

      // חשב ממוצעים לחלונות
      const morningAvg = calculateWindowAverage(dayHours, config.timeWindows.morning.start, config.timeWindows.morning.end);
      const afternoonAvg = calculateWindowAverage(dayHours, config.timeWindows.afternoon.start, config.timeWindows.afternoon.end);
      const eveningAvg = calculateWindowAverage(dayHours, config.timeWindows.evening.start, config.timeWindows.evening.end);

      console.log(`   Morning window (${config.timeWindows.morning.start}-${config.timeWindows.morning.end}):`);
      if (morningAvg) {
        const morningGood = meetsQualityThreshold(morningAvg.waveHeight, morningAvg.wavePeriod, morningAvg.windSpeed);
        console.log(`     Wave: ${morningAvg.waveHeight.toFixed(1)}m @ ${Math.round(morningAvg.wavePeriod)}s | Wind: ${getWindDirectionText(morningAvg.windDirection)} ${Math.round(morningAvg.windSpeed)} knots | ${morningGood ? '✅ GOOD' : '❌ BAD'}`);
      } else {
        console.log(`     No data available`);
      }

      console.log(`   Afternoon window (${config.timeWindows.afternoon.start}-${config.timeWindows.afternoon.end}):`);
      if (afternoonAvg) {
        const afternoonGood = meetsQualityThreshold(afternoonAvg.waveHeight, afternoonAvg.wavePeriod, afternoonAvg.windSpeed);
        console.log(`     Wave: ${afternoonAvg.waveHeight.toFixed(1)}m @ ${Math.round(afternoonAvg.wavePeriod)}s | Wind: ${getWindDirectionText(afternoonAvg.windDirection)} ${Math.round(afternoonAvg.windSpeed)} knots | ${afternoonGood ? '✅ GOOD' : '❌ BAD'}`);
      } else {
        console.log(`     No data available`);
      }

      console.log(`   Evening window (${config.timeWindows.evening.start}-${config.timeWindows.evening.end}):`);
      if (eveningAvg) {
        const eveningGood = meetsQualityThreshold(eveningAvg.waveHeight, eveningAvg.wavePeriod, eveningAvg.windSpeed);
        console.log(`     Wave: ${eveningAvg.waveHeight.toFixed(1)}m @ ${Math.round(eveningAvg.wavePeriod)}s | Wind: ${getWindDirectionText(eveningAvg.windDirection)} ${Math.round(eveningAvg.windSpeed)} knots | ${eveningGood ? '✅ GOOD' : '❌ BAD'}`);
      } else {
        console.log(`     No data available`);
      }

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

      // סימולציה של אירוע קיים (לצורך הדגמה)
      const existingEvent = simulateExistingEvent(date, Math.random() > 0.7); // randomly simulate existing events

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

        if (existingEvent) {
          if (existingEvent.summary.includes('התנאים נחלשו')) {
            console.log(`   ↗️  WOULD RECOVER: Update existing degraded event back to "${title}" (${windowType})`);
            console.log(`      Wave: ${selectedWindow.waveHeight.toFixed(1)}m (${(selectedWindow.waveHeight * 3.28).toFixed(1)}ft) @ ${Math.round(selectedWindow.wavePeriod)}s`);
          } else {
            console.log(`   📝 WOULD UPDATE: Update existing good event with new forecast data (${windowType})`);
            console.log(`      Wave: ${selectedWindow.waveHeight.toFixed(1)}m (${(selectedWindow.waveHeight * 3.28).toFixed(1)}ft) @ ${Math.round(selectedWindow.wavePeriod)}s`);
          }
        } else {
          let windowTime;
          if (windowType === 'morning') {
            windowTime = config.timeWindows.morning.start + '-' + config.timeWindows.morning.end;
          } else if (windowType === 'afternoon') {
            windowTime = config.timeWindows.afternoon.start + '-' + config.timeWindows.afternoon.end;
          } else {
            windowTime = config.timeWindows.evening.start + '-' + config.timeWindows.evening.end;
          }
          console.log(`   ✅ WOULD CREATE: New surf window event (${windowType})`);
          console.log(`      Title: ${title}`);
          console.log(`      Time: ${windowTime}`);
          console.log(`      Wave: ${selectedWindow.waveHeight.toFixed(1)}m (${(selectedWindow.waveHeight * 3.28).toFixed(1)}ft) @ ${Math.round(selectedWindow.wavePeriod)}s`);
        }

      } else {
        // אין תנאים טובים
        if (existingEvent && !existingEvent.summary.includes('התנאים נחלשו')) {
          console.log(`   ↘️  WOULD DEGRADE: Update existing good event to "חלון גלישה - התנאים נחלשו"`);
        } else {
          console.log(`   ❌ WOULD DO NOTHING: No good surf conditions`);
        }
      }
    }

    console.log(`\n${'='.repeat(70)}`);
    console.log('✅ DRY RUN completed - no events were actually created!');
    console.log('💡 To run the actual system, use: npm start');
    console.log(`${'='.repeat(70)}`);

  } catch (error) {
    console.error(`Failed to run dry test:`, error.message);
    throw error;
  }
}

// הרץ את הבדיקה
if (require.main === module) {
  runDryRun().catch(console.error);
}

module.exports = { runDryRun };