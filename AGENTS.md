# AGENTS.md — Development Guidelines & Architecture

## 1. Project Overview & Architecture

Calendar Sync Manager is a Google Apps Script (GAS) web application designed to copy events between Google Calendars, perform automated deduplication, schedule background recurring syncs, and email summary reports. It supports dual-mode operation:

1. **Production Mode (Google Apps Script):** Executes inside Google's runtime (`script.google.com`) using `google.script.run` to call server-side functions in `Code.gs`.
2. **Preview Mode (GitHub Pages / Static):** Runs statically in any browser or GitHub Pages via an automatic demo fallback (`isMockMode` in `index.html`), allowing users to test the UI without backend credentials.

### File Structure & Key Entry Points

* `Code.gs` — Core server-side script. Handles calendar lookups (`CalendarApp`), duplicate detection and cleanup, time-driven recurring triggers (`ScriptApp`), user properties (`PropertiesService.getUserProperties()`), and email dispatch (`MailApp`).
* `index.html` — Client-side web application interface (HTML5, responsive CSS, vanilla JavaScript). Contains the form controls, collapsible instructions card, and the mock preview fallback.
* `appsscript.json` — Google Apps Script project manifest specifying runtime version (V8), web app execution model (`USER_ACCESSING`), and minimal OAuth scopes.
* `README.md` — Project documentation, end-user guide, Apps Script deployment instructions, and GitHub Pages setup.
* `CHANGELOG.md` — Version history following Keep a Changelog standards.
* `.nojekyll` — Static file bypass file instructing GitHub Pages to serve files directly without Jekyll processing.
* `img/` — Asset directory holding source image `icon.jpeg`, and generated `favicon.png` / `favicon.ico`.
* `favicon.ico` / `favicon.png` — Root-level favicon files for static web servers.

---

## 2. Tooling & Commands

### Local Inspection & Preview
* **Static Preview Server:**
  ```bash
  python3 -m http.server 8000
  ```
  Visit `http://localhost:8000/index.html` to test the GitHub Pages preview mode.

* **Automated Integrity Check:**
  ```bash
  python3 -c "
  import io, base64, re, json
  from PIL import Image

  with open('index.html') as f:
      html = f.read()
  with open('Code.gs') as f:
      gs = f.read()
  with open('appsscript.json') as f:
      manifest = json.load(f)

  assert 'isMockMode' in html, 'Mock mode missing in index.html'
  assert 'toggleInstructions' in html, 'Toggle instructions missing'
  assert 'setFaviconUrl' in gs, 'setFaviconUrl missing in Code.gs'
  assert 'https://www.googleapis.com/auth/calendar' in manifest['oauthScopes']
  print('All integrity assertions passed.')
  "
  ```

### Google Apps Script CLI (`clasp`)
* **Push to Apps Script:** `clasp push`
* **Deploy Web App:** `clasp deploy`

### Git & Remote
* **Remote:** `origin` points to `git@github.com:aptr11/calendar-sync-manager.git`
* **Branch:** `main`

---

## 3. Coding Conventions & Hard Constraints

### Architectural Boundaries
* **DO NOT re-implement in-app multi-user/multi-account switching:**
  Google Apps Script's multi-session routing (`authuser` indexing, `/macros/u/X/`, and Google Account Chooser) causes persistent session collisions and Google Drive `"unable to open file"` errors. All multi-account use cases must rely on external isolation (separate Chrome profiles, distinct browsers, or incognito windows).
* **Self-Contained Frontend:**
  Keep `index.html` completely standalone with embedded CSS and vanilla JavaScript. Do not introduce heavy frontend frameworks or external CDN dependencies that could fail inside Google Apps Script sandboxed iframes.
* **Dual-Name Template Support:**
  Always maintain fallback template resolution in `Code.gs` (`HtmlService.createHtmlOutputFromFile('index')` with fallback to `'Index'`). Apps Script file naming in the online editor is case-sensitive, while Git and Linux servers require lowercase `index.html`.
* **Preserve Static Preview Fallback (`isMockMode`):**
  Any changes to `index.html` must keep the `isMockMode` detection intact so that users opening the page on GitHub Pages or locally can interact with the UI without JavaScript crashes from missing `google.script.run`.
* **Minimal OAuth Scopes:**
  Do not add broad or unneeded scopes to `appsscript.json`. Maintain only the 4 required scopes:
  - `https://www.googleapis.com/auth/calendar`
  - `https://www.googleapis.com/auth/script.scriptapp`
  - `https://www.googleapis.com/auth/script.send_mail`
  - `https://www.googleapis.com/auth/userinfo.email`
* **Rate-Limit & Quota Protection:**
  When adding or modifying event operations in `Code.gs`, preserve rate throttling (`Utilities.sleep(100)` or batch delays) to respect Google Calendar API rate limits.

---

## 4. Session Continuity

* **Before starting any work:** Read `HANDOFF.md` to understand the current task state, recent commits, and open action items.
* **Before finishing any session:** Update `HANDOFF.md` with the current branch status, what was modified, test results, and concrete next steps.
