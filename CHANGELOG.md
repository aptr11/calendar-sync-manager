# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-11-03

### Added
* **Active Duplicate Scanner (`deduplicateCalendarEvents`):** Scans both the destination and source calendars during every sync run and deletes duplicate events found within the lookahead window.
* **Multi-Attribute Event Fingerprinting (`createEventSignature`):** Expanded duplicate matching beyond title and start time to include normalized event title, start and end timestamps (or all-day date ranges), location, and description.
* **Deduplication Reporting:** Added a "Duplicates Removed" section to the HTML and plain-text email notifications and updated the in-app status banner to display the number of deleted duplicates alongside newly copied events.

### Changed
* Read-only source calendars now gracefully skip deletion errors via `try...catch` while still filtering out source-side duplicates before copying to the destination calendar.

---

## [1.2.0] - 2026-11-03

### Added
* **Automated Email Reports (`sendSyncNotificationEmail`):** Sends an HTML and plain-text summary email to the user's inbox after every manual or scheduled sync.
* **Synced Event Manifest:** Emails now list the exact title and formatted date/time range of every event copied during the run.
* **Stop Sync Instructions & Deep Link:** Added an in-app instruction card (`Index.html`) and a footer block in every notification email containing the live Web App URL (`ScriptApp.getService().getUrl()`) and step-by-step instructions to stop recurring syncs.

---

## [1.1.0] - 2026-11-03

### Added
* **Multi-User Web App Interface (`Index.html` & `doGet`):** Built a responsive frontend allowing any authorized user (such as a spouse or family member) to select their own calendars from dropdown menus.
* **Per-User Isolated Storage:** Migrated configuration storage to `PropertiesService.getUserProperties()` so each user's source calendar, destination calendar, lookahead window, and last-sync timestamp remain separate.
* **Self-Service Recurring Triggers:** Users can configure automatic background syncing (every 1, 2, 6, 12, or 24 hours) or stop active triggers directly from the web UI without opening the Apps Script editor.

---

## [1.0.0] - 2026-11-03

### Added
* Initial standalone Google Apps Script (`syncNewCalendarEvents`) to copy events from a source Calendar ID to a destination Calendar ID over a configurable lookahead window.
* In-memory `Set` lookup comparing normalized event titles and start timestamps (`getTime()`) to prevent creating duplicate entries.
* Support for preserving both timed events (`createEvent`) and all-day events (`createAllDayEvent`) along with event descriptions and locations.
* Rate-limit throttling (`Utilities.sleep`) every 20 event creations.