/**
 * Serves the HTML Web App interface.
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Calendar Sync Manager')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Loads the authenticated user's calendars and their saved sync settings.
 */
function getInitialData() {
  const userProps = PropertiesService.getUserProperties();
  const calendars = CalendarApp.getAllCalendars().map(cal => ({
    id: cal.getId(),
    name: cal.getName(),
    isPrimary: cal.isMyPrimaryCalendar(),
    isOwned: cal.isOwnedByMe()
  }));

  // Sort primary calendar to the top, then alphabetically
  calendars.sort((a, b) => {
    if (a.isPrimary) return -1;
    if (b.isPrimary) return 1;
    return a.name.localeCompare(b.name);
  });

  const savedTriggerId = userProps.getProperty('triggerId');
  const hasActiveTrigger = checkIfTriggerExists(savedTriggerId);
  const activeEmail = Session.getEffectiveUser().getEmail() || Session.getActiveUser().getEmail();

  return {
    userEmail: activeEmail,
    webAppUrl: ScriptApp.getService().getUrl() || '',
    calendars: calendars,
    settings: {
      sourceId: userProps.getProperty('sourceId') || '',
      destId: userProps.getProperty('destId') || '',
      daysAhead: parseInt(userProps.getProperty('daysAhead') || '30', 10),
      frequencyHours: hasActiveTrigger ? parseInt(userProps.getProperty('frequencyHours') || '0', 10) : 0,
      lastSync: userProps.getProperty('lastSync') || 'Never'
    }
  };
}

/**
 * Saves the user's configuration, updates their recurring trigger, and runs an immediate sync.
 */
function saveAndSync(config) {
  if (!config.sourceId || !config.destId) {
    throw new Error('Please select both a source and a destination calendar.');
  }
  if (config.sourceId === config.destId) {
    throw new Error('Source and destination calendars must be different.');
  }

  const daysAhead = Math.max(1, Math.min(365, parseInt(config.daysAhead, 10) || 30));
  const frequencyHours = parseInt(config.frequencyHours, 10) || 0;
  const activeEmail = Session.getEffectiveUser().getEmail() || Session.getActiveUser().getEmail();

  const userProps = PropertiesService.getUserProperties();
  userProps.setProperties({
    sourceId: config.sourceId,
    destId: config.destId,
    daysAhead: String(daysAhead),
    frequencyHours: String(frequencyHours),
    userEmail: activeEmail,
    webAppUrl: ScriptApp.getService().getUrl() || ''
  });

  // Update or clear the recurring background trigger for this user
  configureUserTrigger(frequencyHours);

  // Run an immediate deduplication and sync (also sends the summary email)
  const syncResult = runSyncForCurrentUser();

  return {
    copiedCount: syncResult.copiedCount,
    removedCount: syncResult.removedCount,
    lastSync: syncResult.lastSync,
    recurringActive: frequencyHours > 0,
    frequencyHours: frequencyHours
  };
}

/**
 * Stops the recurring background sync for the current user.
 */
function stopRecurringSync() {
  const userProps = PropertiesService.getUserProperties();
  clearUserTriggers();
  userProps.setProperty('frequencyHours', '0');
  return { status: 'stopped' };
}

/**
 * Executes duplicate cleanup, syncs missing events, and emails a summary report.
 */
function runSyncForCurrentUser() {
  const userProps = PropertiesService.getUserProperties();
  const sourceId = userProps.getProperty('sourceId');
  const destId = userProps.getProperty('destId');
  const daysAhead = parseInt(userProps.getProperty('daysAhead') || '30', 10);
  const frequencyHours = parseInt(userProps.getProperty('frequencyHours') || '0', 10);

  if (!sourceId || !destId) {
    throw new Error('Missing source or destination Calendar ID in user settings.');
  }

  const sourceCalendar = CalendarApp.getCalendarById(sourceId);
  const destCalendar = CalendarApp.getCalendarById(destId);

  if (!sourceCalendar || !destCalendar) {
    throw new Error('Unable to access one or both calendars. Check your calendar permissions.');
  }

  const timeZone = Session.getScriptTimeZone();
  const startTimeWindow = new Date();
  startTimeWindow.setHours(0, 0, 0, 0);

  const endTimeWindow = new Date(startTimeWindow);
  endTimeWindow.setDate(startTimeWindow.getDate() + daysAhead);

  const rawSourceEvents = sourceCalendar.getEvents(startTimeWindow, endTimeWindow);
  const rawDestEvents = destCalendar.getEvents(startTimeWindow, endTimeWindow);

  // 1. Find and remove existing duplicates within the Destination Calendar
  const destDedup = deduplicateCalendarEvents(
    rawDestEvents,
    destCalendar.getName(),
    timeZone
  );

  // 2. Find and remove existing duplicates within the Source Calendar (if writable)
  const sourceDedup = deduplicateCalendarEvents(
    rawSourceEvents,
    sourceCalendar.getName(),
    timeZone
  );

  const existingDestSignatures = destDedup.seenSignatures;
  const removedDuplicates = destDedup.removedDuplicates.concat(sourceDedup.removedDuplicates);
  const copiedEvents = [];

  // 3. Copy only unique source events that are not already present in the destination calendar
  for (const event of sourceDedup.uniqueEvents) {
    const signature = createEventSignature(event, timeZone);

    // Strictly skip if an identical event already exists in the destination calendar
    if (existingDestSignatures.has(signature)) {
      continue;
    }

    const title = event.getTitle() || '(No Title)';
    const startTime = event.getStartTime();
    const endTime = event.getEndTime();
    const options = {
      description: event.getDescription(),
      location: event.getLocation()
    };

    const formattedWhen = formatEventTimeframe(event, timeZone);

    if (event.isAllDayEvent()) {
      destCalendar.createAllDayEvent(
        title,
        event.getAllDayStartDate(),
        event.getAllDayEndDate(),
        options
      );
    } else {
      destCalendar.createEvent(title, startTime, endTime, options);
    }

    // Register signature immediately so it can never be duplicated in the same run
    existingDestSignatures.add(signature);
    copiedEvents.push({
      title: title,
      when: formattedWhen
    });

    // Pause briefly every 20 creations to avoid Google Calendar write rate limits
    if (copiedEvents.length % 20 === 0) {
      Utilities.sleep(1000);
    }
  }

  const nowFormatted = Utilities.formatDate(new Date(), timeZone, 'MMM d, yyyy HH:mm:ss');
  const lastSyncSummary = `${nowFormatted} (${copiedEvents.length} copied, ${removedDuplicates.length} duplicate(s) removed)`;
  userProps.setProperty('lastSync', lastSyncSummary);

  // Send email notification to the user
  sendSyncNotificationEmail({
    recipientEmail: userProps.getProperty('userEmail') || Session.getEffectiveUser().getEmail(),
    sourceName: sourceCalendar.getName(),
    destName: destCalendar.getName(),
    daysAhead: daysAhead,
    frequencyHours: frequencyHours,
    copiedEvents: copiedEvents,
    removedDuplicates: removedDuplicates,
    syncTimestamp: nowFormatted,
    webAppUrl: ScriptApp.getService().getUrl() || userProps.getProperty('webAppUrl') || ''
  });

  return {
    copiedCount: copiedEvents.length,
    removedCount: removedDuplicates.length,
    lastSync: lastSyncSummary
  };
}

/**
 * Scans a list of events from a single calendar, deletes any duplicate entries
 * sharing identical characteristics, and returns the remaining unique events.
 */
function deduplicateCalendarEvents(events, calendarName, timeZone) {
  const seenSignatures = new Set();
  const uniqueEvents = [];
  const removedDuplicates = [];
  let deleteCounter = 0;

  for (const event of events) {
    const signature = createEventSignature(event, timeZone);

    if (seenSignatures.has(signature)) {
      const title = event.getTitle() || '(No Title)';
      const when = formatEventTimeframe(event, timeZone);

      try {
        event.deleteEvent();
        deleteCounter++;
        removedDuplicates.push({
          title: title,
          when: when,
          calendarName: calendarName
        });

        // Pause briefly every 20 deletions to avoid rate limits
        if (deleteCounter % 20 === 0) {
          Utilities.sleep(1000);
        }
      } catch (err) {
        // If the source calendar is read-only, log and still exclude the duplicate from copying
        console.warn(`Could not delete duplicate "${title}" from ${calendarName}: ${err.message}`);
      }
    } else {
      seenSignatures.add(signature);
      uniqueEvents.push(event);
    }
  }

  return {
    uniqueEvents: uniqueEvents,
    seenSignatures: seenSignatures,
    removedDuplicates: removedDuplicates
  };
}

/**
 * Builds a unique fingerprint based on title, all-day status, start/end timeframe,
 * location, and description so identical events are reliably matched.
 */
function createEventSignature(event, timeZone) {
  const title = normalizeText(event.getTitle());
  const location = normalizeText(event.getLocation());
  const description = normalizeText(event.getDescription());

  let timeFrameKey = '';
  if (event.isAllDayEvent()) {
    const startDay = Utilities.formatDate(event.getAllDayStartDate(), timeZone, 'yyyy-MM-dd');
    const endDay = Utilities.formatDate(event.getAllDayEndDate(), timeZone, 'yyyy-MM-dd');
    timeFrameKey = `ALLDAY:${startDay}->${endDay}`;
  } else {
    timeFrameKey = `TIMED:${event.getStartTime().getTime()}->${event.getEndTime().getTime()}`;
  }

  return `${title}|${timeFrameKey}|${location}|${description}`;
}

/**
 * Formats an event's start and end time for human-readable UI and email logs.
 */
function formatEventTimeframe(event, timeZone) {
  if (event.isAllDayEvent()) {
    return Utilities.formatDate(event.getAllDayStartDate(), timeZone, 'EEE, MMM d, yyyy') + ' (All Day)';
  }
  const startStr = Utilities.formatDate(event.getStartTime(), timeZone, 'EEE, MMM d, yyyy HH:mm');
  const endStr = Utilities.formatDate(event.getEndTime(), timeZone, 'HH:mm');
  return `${startStr} – ${endStr}`;
}

/**
 * Normalizes text fields by trimming and collapsing multiple whitespace characters.
 */
function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

/**
 * Sends an email report to the user detailing what was synced, what duplicates were removed, and how to stop it.
 */
function sendSyncNotificationEmail(details) {
  if (!details.recipientEmail) return;

  const copiedCount = details.copiedEvents.length;
  const removedCount = details.removedDuplicates.length;
  const subject = `Calendar Sync Report: ${copiedCount} copied, ${removedCount} duplicate(s) removed (${details.sourceName} to ${details.destName})`;

  // Plain-text lists
  const plainCopiedLines = copiedCount > 0
    ? details.copiedEvents.map((e, idx) => `${idx + 1}. ${e.title} — ${e.when}`).join('\n')
    : 'No new events needed to be copied (all events in the window were already in sync).';

  const plainRemovedLines = removedCount > 0
    ? details.removedDuplicates.map((e, idx) => `${idx + 1}. ${e.title} — ${e.when} [Removed from: ${e.calendarName}]`).join('\n')
    : 'No duplicate events were found.';

  // HTML lists
  const htmlCopiedItems = copiedCount > 0
    ? '<ul style="padding-left:20px; margin:10px 0;">' +
      details.copiedEvents
        .map(e => `<li style="margin-bottom:6px;"><strong>${escapeHtml(e.title)}</strong> <span style="color:#5f6368;">(${escapeHtml(e.when)})</span></li>`)
        .join('') +
      '</ul>'
    : '<p style="color:#5f6368; font-style:italic;">No new events needed to be copied (all events in the lookahead window were already in sync).</p>';

  const htmlRemovedItems = removedCount > 0
    ? '<ul style="padding-left:20px; margin:10px 0;">' +
      details.removedDuplicates
        .map(e => `<li style="margin-bottom:6px;"><strong>${escapeHtml(e.title)}</strong> <span style="color:#5f6368;">(${escapeHtml(e.when)} — removed from <em>${escapeHtml(e.calendarName)}</em>)</span></li>`)
        .join('') +
      '</ul>'
    : '<p style="color:#5f6368; font-style:italic;">No duplicate events were found.</p>';

  const scheduleText = details.frequencyHours > 0
    ? `Active (runs automatically every ${details.frequencyHours} hour(s))`
    : 'Manual Only (no automatic recurring sync is scheduled)';

  const urlSectionPlain = details.webAppUrl
    ? `To stop or modify this sync:\n1. Open the Calendar Sync Manager: ${details.webAppUrl}\n2. Click the red "Stop Auto-Sync" button (or set the schedule to "Manual Only" and click "Save & Sync Now").`
    : 'To stop or modify this sync, open your Calendar Sync Manager Web App and click "Stop Auto-Sync".';

  const urlSectionHtml = details.webAppUrl
    ? `<p style="margin:0 0 10px 0;">If you want to stop the automatic recurring sync or change your calendars:</p>
       <ol style="margin:0 0 14px 0; padding-left:20px;">
         <li style="margin-bottom:6px;">Open the <a href="${details.webAppUrl}" style="color:#1a73e8; font-weight:600;">Calendar Sync Manager Web App</a>.</li>
         <li style="margin-bottom:6px;">Click the red <strong>Stop Auto-Sync</strong> button at the bottom of the page (or change <em>Automatic Recurring Sync</em> to <strong>Manual Only</strong> and click <strong>Save &amp; Sync Now</strong>).</li>
       </ol>
       <p style="margin:0; font-size:12px; color:#5f6368;">Direct URL: <a href="${details.webAppUrl}" style="color:#1a73e8;">${details.webAppUrl}</a></p>`
    : '<p style="margin:0;">To stop the automatic sync, open your Calendar Sync Manager Web App and click the <strong>Stop Auto-Sync</strong> button.</p>';

  const plainBody =
`Calendar Sync Completed
------------------------
Time: ${details.syncTimestamp}
From Calendar: ${details.sourceName}
To Calendar: ${details.destName}
Lookahead Window: Next ${details.daysAhead} day(s)
Recurring Schedule: ${scheduleText}

Events Copied (${copiedCount}):
${plainCopiedLines}

Duplicates Removed (${removedCount}):
${plainRemovedLines}

------------------------
${urlSectionPlain}`;

  const htmlBody = `
  <div style="font-family:'Segoe UI', Roboto, Arial, sans-serif; max-width:560px; color:#202124; line-height:1.5;">
    <h2 style="margin:0 0 12px 0; color:#1a73e8; font-size:20px;">Calendar Sync Completed</h2>
    <div style="background:#f8f9fa; border:1px solid #dadce0; border-radius:8px; padding:14px 16px; margin-bottom:16px; font-size:14px;">
      <div><strong>Time:</strong> ${escapeHtml(details.syncTimestamp)}</div>
      <div><strong>Copied From:</strong> ${escapeHtml(details.sourceName)}</div>
      <div><strong>Copied To:</strong> ${escapeHtml(details.destName)}</div>
      <div><strong>Lookahead Window:</strong> Next ${details.daysAhead} day(s)</div>
      <div><strong>Recurring Status:</strong> ${escapeHtml(scheduleText)}</div>
    </div>

    <h3 style="font-size:16px; margin:16px 0 8px 0;">Events Synced (${copiedCount})</h3>
    <div style="font-size:14px; margin-bottom:16px;">
      ${htmlCopiedItems}
    </div>

    <h3 style="font-size:16px; margin:16px 0 8px 0;">Duplicates Removed (${removedCount})</h3>
    <div style="font-size:14px; margin-bottom:20px;">
      ${htmlRemovedItems}
    </div>

    <div style="background:#fce8e6; border:1px solid #fad2cf; border-radius:8px; padding:14px 16px; font-size:13px; color:#3c4043;">
      <strong style="color:#c5221f; display:block; margin-bottom:6px; font-size:14px;">How to Stop Automatic Sync</strong>
      ${urlSectionHtml}
    </div>
  </div>`;

  MailApp.sendEmail({
    to: details.recipientEmail,
    subject: subject,
    body: plainBody,
    htmlBody: htmlBody
  });
}

/**
 * Escapes special HTML characters in event titles and descriptions.
 */
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Sets up or removes the user's time-based trigger.
 */
function configureUserTrigger(frequencyHours) {
  clearUserTriggers();

  if (frequencyHours > 0) {
    const trigger = ScriptApp.newTrigger('runSyncForCurrentUser')
      .timeBased()
      .everyHours(frequencyHours)
      .create();

    PropertiesService.getUserProperties().setProperty('triggerId', trigger.getUniqueId());
  }
}

/**
 * Removes any existing sync triggers belonging to the current user.
 */
function clearUserTriggers() {
  const userProps = PropertiesService.getUserProperties();
  const savedTriggerId = userProps.getProperty('triggerId');
  const triggers = ScriptApp.getProjectTriggers();

  for (const trigger of triggers) {
    if (
      trigger.getUniqueId() === savedTriggerId ||
      trigger.getHandlerFunction() === 'runSyncForCurrentUser'
    ) {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  userProps.deleteProperty('triggerId');
}

/**
 * Checks whether the user's saved trigger ID is still active.
 */
function checkIfTriggerExists(triggerId) {
  if (!triggerId) return false;
  const triggers = ScriptApp.getProjectTriggers();
  return triggers.some(t => t.getUniqueId() === triggerId);
}