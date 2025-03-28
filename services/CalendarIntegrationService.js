const ical = require("ical-generator");

// Debug log to confirm ical-generator is loaded
console.log("🔍 Loading ical-generator:", typeof ical === "function" ? "Function loaded successfully" : "Failed to load function");

// Interface for calendar plugins
class CalendarPlugin {
  async createEvent(eventData) {
    throw new Error("createEvent must be implemented by plugin");
  }

  async updateEvent(eventId, eventData) {
    throw new Error("updateEvent must be implemented by plugin");
  }

  async deleteEvent(eventId) {
    throw new Error("deleteEvent must be implemented by plugin");
  }
}

// iCalendar Plugin (for .ics file generation)
class ICalendarPlugin extends CalendarPlugin {
  async createEvent(eventData) {
    const { title, description, start, end, organizer, attendees } = eventData;
    let icsContent;
    try {
      const cal = ical({ name: "RightArtist Event" });
      cal.createEvent({
        start: new Date(start),
        end: new Date(end),
        summary: title,
        description,
        organizer: organizer ? { name: organizer.name, email: organizer.email } : undefined,
        attendees: attendees ? attendees.map(att => ({ name: att.name, email: att.email })) : [],
      });
      icsContent = cal.toString();
      console.log("✅ Generated .ics content successfully");
    } catch (error) {
      console.error("❌ Error generating .ics content:", error.message);
      icsContent = null; // Fallback to null if .ics generation fails
    }
    return { eventId: null, icsContent }; // No event ID for iCalendar, just the .ics content
  }

  async updateEvent(eventId, eventData) {
    // iCalendar doesn't support updates since it's a file export
    return this.createEvent(eventData);
  }

  async deleteEvent(eventId) {
    // iCalendar doesn't support deletion since it's a file export
    return true;
  }
}

// Placeholder for Google Calendar Plugin (to be implemented with Google Calendar API)
class GoogleCalendarPlugin extends CalendarPlugin {
  async createEvent(eventData) {
    // Implement Google Calendar API integration here
    console.log("🔍 Google Calendar: Creating event (placeholder)", eventData);
    return { eventId: "google-event-id-placeholder" };
  }

  async updateEvent(eventId, eventData) {
    console.log("🔍 Google Calendar: Updating event (placeholder)", eventId, eventData);
    return true;
  }

  async deleteEvent(eventId) {
    console.log("🔍 Google Calendar: Deleting event (placeholder)", eventId);
    return true;
  }
}

// Placeholder for Outlook Calendar Plugin (to be implemented with Microsoft Graph API)
class OutlookCalendarPlugin extends CalendarPlugin {
  async createEvent(eventData) {
    // Implement Microsoft Graph API integration here
    console.log("🔍 Outlook Calendar: Creating event (placeholder)", eventData);
    return { eventId: "outlook-event-id-placeholder" };
  }

  async updateEvent(eventId, eventData) {
    console.log("🔍 Outlook Calendar: Updating event (placeholder)", eventId, eventData);
    return true;
  }

  async deleteEvent(eventId) {
    console.log("🔍 Outlook Calendar: Deleting event (placeholder)", eventId);
    return true;
  }
}

class CalendarIntegrationService {
  constructor() {
    this.plugins = {
      iCalendar: new ICalendarPlugin(),
      googleCalendar: new GoogleCalendarPlugin(),
      outlook: new OutlookCalendarPlugin(),
    };
  }

  /**
   * To add a new calendar integration:
   * 1. Create a new class that extends CalendarPlugin and implements createEvent, updateEvent, and deleteEvent.
   * 2. Add the new plugin to the this.plugins object in the constructor with a unique key.
   * 3. Update the User model's calendarIntegrations field to include the new integration (e.g., { "newCalendar": { enabled: false } }).
   * 4. Update SettingsPage.tsx to allow users to enable/disable the new integration.
   * Example:
   * class NewCalendarPlugin extends CalendarPlugin {
   *   async createEvent(eventData) { ... }
   *   async updateEvent(eventId, eventData) { ... }
   *   async deleteEvent(eventId) { ... }
   * }
   * this.plugins.newCalendar = new NewCalendarPlugin();
   */
  async createEvent(user, eventData) {
    const integrations = user.calendarIntegrations || {};
    const externalEventIds = {};
    let icsContent = null;

    for (const [name, plugin] of Object.entries(this.plugins)) {
      if (name === "iCalendar" || (integrations[name] && integrations[name].enabled)) {
        const result = await plugin.createEvent(eventData);
        if (name === "iCalendar") {
          icsContent = result.icsContent;
        } else {
          externalEventIds[name] = result.eventId;
        }
      }
    }

    return { externalEventIds, icsContent };
  }

  async updateEvent(user, eventId, eventData) {
    const integrations = user.calendarIntegrations || {};
    for (const [name, plugin] of Object.entries(this.plugins)) {
      if (name !== "iCalendar" && integrations[name] && integrations[name].enabled && eventId[name]) {
        await plugin.updateEvent(eventId[name], eventData);
      }
    }
  }

  async deleteEvent(user, eventId) {
    const integrations = user.calendarIntegrations || {};
    for (const [name, plugin] of Object.entries(this.plugins)) {
      if (name !== "iCalendar" && integrations[name] && integrations[name].enabled && eventId[name]) {
        await plugin.deleteEvent(eventId[name]);
      }
    }
  }
}

module.exports = new CalendarIntegrationService();