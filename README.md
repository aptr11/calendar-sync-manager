# Google Calendar Sync & Deduplicator Web App

A multi-user Google Apps Script Web App that copies new events from a source Google Calendar to a destination Google Calendar, automatically removes duplicate events in both calendars, sets up user-specific recurring schedules, and sends an email report after every run.

## Features

* **Multi-User Support:** Deployed as a Web App executing under each user's own Google account. Every user sees their own calendars, stores their own settings via `UserProperties`, and manages their own background triggers independently.
* **Active Duplicate Cleanup:** Before copying events, the script scans the lookahead window in both the destination and source calendars (when writable) and deletes duplicate entries that share the same title, timeframe, all-day status, location, and description.
* **Zero-Duplicate Syncing:** Uses an in-memory `Set` of multi-attribute event signatures to ensure an event already present in the destination calendar is never copied again.
* **Customizable Lookahead & Schedule:** Users can choose how many days ahead to sync (1–365 days) and run the sync manually or automatically every 1, 2, 6, 12, or 24 hours.
* **Email Summary Reports:** Sends a formatted HTML (and plain-text) email after each run listing every synced event, every removed duplicate, and a direct link back to the Web App to stop or modify the schedule.
* **Rate-Limit Protection:** Batches calendar reads and pauses briefly every 20 event creations or deletions to stay within Google Calendar API quotas.

---

## Repository Contents

* **`Code.gs`** — Server-side Google Apps Script handling calendar queries, signature matching, deduplication, trigger management, user properties, and email notifications.
* **`Index.html`** — Responsive web interface allowing users to select calendars, configure sync intervals, trigger manual syncs, and stop recurring background syncs.
* **`CHANGELOG.md`** — Project release history.

---

## Deployment Guide (For the Administrator)

### Option A: Manual Setup in the Google Apps Script Editor

1. Go to [script.google.com](https://script.google.com/) and click **New project**.
2. Rename the project to **Calendar Sync Manager**.
3. In the default **`Code.gs`** file, replace all placeholder code with the contents of [`Code.gs`](./Code.gs) from this repository.
4. Click the **+** icon next to **Files** in the left sidebar and select **HTML**.
5. Name the file **`Index`** (case-sensitive; Google Apps Script adds `.html` automatically) and paste the contents of [`Index.html`](./Index.html).
6. Press `Ctrl + S` (or `Cmd + S`) to save both files.
7. Click **Deploy** at the top right and select **New deployment**.
8. Click the gear icon next to **Select type** and choose **Web app**.
9. Configure the deployment settings:
   * **Description:** `v1.3.0 - Calendar Sync & Deduplicator`
   * **Execute as:** **User accessing the web app** *(Required so each user accesses their own calendars and triggers)*
   * **Who has access:** **Anyone with Google account**
10. Click **Deploy** and copy the generated **Web app URL**.

### Option B: Deploying from GitHub via `clasp` (Optional)

If you prefer managing deployments from your terminal:

```bash
npm install -g @google/clasp
clasp login
clasp create --type webapp --title "Calendar Sync Manager"
clasp push
clasp deploy
```

---

## How to Use the App (For End Users)

### 1. First-Time Authorization
1. Open the **Web App URL** in your browser.
2. Click **Review permissions** and select your Google account.
3. Because this is a private script hosted on a personal account, Google will display a **"Google hasn't verified this app"** warning. Click **Advanced** at the bottom left, select **Go to Calendar Sync Manager (unsafe)**, and click **Allow**.

### 2. Configuring a Sync
1. **Source Calendar (Copy From):** Choose the calendar containing the original events.
2. **Destination Calendar (Copy To):** Choose the calendar where new events should be copied.
3. **Sync Lookahead Window (Days):** Enter the number of days into the future (from midnight today) to scan and sync (default is `30` days).
4. **Automatic Recurring Sync:**
   * Select **Manual Only** to run a one-time cleanup and sync without scheduling background runs.
   * Select **Every 1 / 2 / 6 / 12 / 24 hours** to automatically deduplicate and sync in the background.
5. Click **Save & Sync Now**. The app will immediately clean up duplicates, copy missing events, activate your schedule, and email you a summary report.

### 3. How to Stop Automatic Syncing
You can stop the background sync at any time using either of these methods:
* **Method 1 (One-Click Stop):** Open the Web App URL (from your bookmarks or the link at the bottom of any sync report email) and click the red **Stop Auto-Sync** button.
* **Method 2 (Switch to Manual):** Set the **Automatic Recurring Sync** dropdown to **Manual Only** and click **Save & Sync Now**.

---

## How Duplicate Detection Works

Two events in the same calendar (or across the source and destination calendars) are treated as duplicates when they generate the exact same normalized signature:

```text
Title | All-Day vs. Timed Status & Start/End Timestamps | Location | Description
```

* **Text Normalization:** Leading/trailing spaces are stripped and multiple consecutive spaces are collapsed before comparison.
* **Timeframe Precision:** Timed events are compared using exact epoch milliseconds (`getTime()`), ensuring reliable matching across timezones. All-day events are compared using `yyyy-MM-dd` date strings so full-day banners are preserved properly.
* **Safe Cleanup:** When multiple identical events exist in the same calendar within the lookahead window, the script retains the first event and removes the redundant copies. If a source calendar is read-only (such as a subscribed public calendar), the script catches the permission error, leaves the read-only source untouched, and still prevents duplicate copies from reaching your destination calendar.

---

## Google Permissions Used

| Scope | Reason |
| :--- | :--- |
| `https://www.googleapis.com/auth/calendar` | Reads events from the source calendar, creates missing events in the destination calendar, and deletes duplicate entries. |
| `https://www.googleapis.com/auth/script.scriptapp` | Creates and removes time-driven recurring triggers for the active user. |
| `https://www.googleapis.com/auth/script.send_mail` | Sends the post-sync summary report to the signed-in user's inbox. |
| `https://www.googleapis.com/auth/userinfo.email` | Identifies the signed-in user's email address for the UI header and email reports. |