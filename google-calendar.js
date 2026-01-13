const fs = require('fs').promises;
const path = require('path');
const { google } = require('googleapis');
const config = require('./config');

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

// טען והרשם עם Service Account
async function authorize() {
  try {
    let credentials;
    const keyValue = config.calendar.serviceAccountKey;
    
    if (keyValue.startsWith('{')) {
      // אם זה JSON string (מ-GitHub secret)
      credentials = JSON.parse(keyValue);
    } else if (keyValue.length > 100) {
      // אם זה base64 (מומלץ ל-GitHub)
      const decoded = Buffer.from(keyValue, 'base64').toString('utf8');
      credentials = JSON.parse(decoded);
    } else {
      // אם זה נתיב לקובץ (לוקאלי)
      const CREDENTIALS_PATH = path.join(__dirname, keyValue);
      credentials = JSON.parse(await fs.readFile(CREDENTIALS_PATH));
    }
    
    const auth = new google.auth.GoogleAuth({
      credentials: credentials,
      scopes: SCOPES,
    });
    return auth;
  } catch (err) {
    console.error('Error loading service account credentials:', err);
    throw err;
  }
}

// קבל רשימת אירועים קיימים ליום מסוים
async function getExistingEvents(auth, date) {
  const calendar = google.calendar({ version: 'v3', auth });

  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  try {
    const response = await calendar.events.list({
      calendarId: config.calendar.calendarId,
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    // פילטר רק אירועי גלישה שלנו
    return response.data.items.filter(event =>
      event.summary && (
        event.summary.includes('חלון גלישה') ||
        event.summary.includes('גלישה הרצליה')
      )
    );
  } catch (err) {
    console.error('Error fetching existing events:', err);
    throw err;
  }
}

// צור או עדכן אירוע בקלנדר
async function createOrUpdateEvent(auth, eventDetails) {
  const calendar = google.calendar({ version: 'v3', auth });

  try {
    // בדוק אם יש אירוע קיים ליום הזה
    const existingEvents = await getExistingEvents(auth, new Date(eventDetails.startDateTime));

    if (existingEvents.length > 0) {
      // עדכן אירוע קיים
      const existingEvent = existingEvents[0];
      const updatedEvent = {
        summary: eventDetails.title,
        description: eventDetails.description,
        start: {
          dateTime: eventDetails.startDateTime,
          timeZone: config.location.timezone,
        },
        end: {
          dateTime: eventDetails.endDateTime,
          timeZone: config.location.timezone,
        },
      };

      const response = await calendar.events.update({
        calendarId: config.calendar.calendarId,
        eventId: existingEvent.id,
        resource: updatedEvent,
      });

      console.log(`✓ Updated event for ${eventDetails.date}: ${response.data.htmlLink}`);
      return response.data;
    } else {
      // צור אירוע חדש
      const newEvent = {
        summary: eventDetails.title,
        description: eventDetails.description,
        start: {
          dateTime: eventDetails.startDateTime,
          timeZone: config.location.timezone,
        },
        end: {
          dateTime: eventDetails.endDateTime,
          timeZone: config.location.timezone,
        },
      };

      const response = await calendar.events.insert({
        calendarId: config.calendar.calendarId,
        resource: newEvent,
      });

      console.log(`✓ Created event for ${eventDetails.date}: ${response.data.htmlLink}`);
      return response.data;
    }
  } catch (err) {
    console.error('Error creating/updating event:', err);
    throw err;
  }
}

// מחק אירוע (אם נצטרך בעתיד)
async function deleteEvent(auth, eventId) {
  const calendar = google.calendar({ version: 'v3', auth });

  try {
    await calendar.events.delete({
      calendarId: config.calendar.calendarId,
      eventId: eventId,
    });
    console.log(`✓ Deleted event ${eventId}`);
  } catch (err) {
    console.error('Error deleting event:', err);
    throw err;
  }
}

module.exports = {
  authorize,
  getExistingEvents,
  createOrUpdateEvent,
  deleteEvent
};