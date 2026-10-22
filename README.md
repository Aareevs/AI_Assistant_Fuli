# Fuli — AI Desktop Operator & Voice Assistant (100% Free, Cross-Platform for Windows & macOS)

<p align="center">
  <img src="images/Fuli_Logo.png" width="120" alt="Fuli Logo" />
</p>

Fuli is an agile, intelligent, autonomous desktop operator and hands-free voice assistant engineered for both **Windows** (10/11) and **macOS** (Apple Silicon & Intel). Designed as an always-available Spotlight/PowerToys-style floating operator, Fuli controls your computer, navigates your active browser in-place without opening duplicate tabs, launches and quits apps, manages media and volume, and speaks to you with a natural female voice—all at **$0.00 cost** (zero paid subscriptions or token bills).

---

## Key Features

- **⚡ Universal Hotkey (`Alt + Space` / `Option + Space`)**: Summon or dismiss Fuli instantly from anywhere on Windows or macOS.
- **🎙️ Hands-Free Wake Word ("Fuli")**: Say *"Fuli"* or *"Hey Fuli"* and the bar opens instantly (~250ms sliding-window detection) with a crisp chime. Saying the wake word *only* opens Fuli — nothing is listened for or run afterwards. Use the mic button when you want to speak a command.
- **🔇 Quiet when you type**: Typed commands never talk back; only spoken commands get a spoken reply.
- **🗣️ Natural Female Voice (Free)**: Real-time verbal feedback using Microsoft Edge Neural TTS (`en-US-AriaNeural`) with native offline speech fallbacks (Windows SAPI / macOS `Samantha`).
- **🌐 In-Place Browser Navigation**: Operates directly inside your **currently active browser** (Microsoft Edge, Google Chrome, Brave, Safari). Reuses your existing tab in place—**no test browsers, no automation banners, and no duplicate tabs**.
- **🤖 Autonomous Web App Interaction**: Paste and send prompts directly into **ChatGPT**, Claude, Google Search, and web forms with native clipboard fidelity.
- **💻 Full Native OS Control (Windows & macOS)**:
  - **Application Management**: Launch and terminate applications (*Spotify, VS Code, Slack, WhatsApp, Terminal, Discord, etc.*)
  - **Master Volume**: Smooth volume adjustments (0–100%) and mute/unmute via Windows CoreAudio and macOS AppleScript
  - **Media Keys**: Hardware-level virtual media keys (Play/Pause, Next Track, Previous Track) across any media player
  - **Screen Capture**: Clean, silent desktop screenshots saved straight to your temporary directory or desktop
- **🧮 Local commands (no AI call needed)**: calculator, percentages and unit/temperature conversion; window snapping (halves, quarters, thirds, maximize, center); lock, sleep, dark mode, empty trash, keep-awake, volume; clipboard history; reusable snippets.
- **🎵 Spotify inside Fuli**: play any song, album or playlist by name, browse your playlists, and control playback from a built-in player card with Spotify's own cover art and track list. Set up in [Connectors](#connectors).
- **🔌 Connectors panel**: the plug icon next to the mic lists services you can link to Fuli — **Spotify** and **Google** (Calendar, Gmail, YouTube).
- **💰 Free to use**: nothing in Fuli costs money. A few optional extras (like playing Spotify inside Fuli) plug into services you already have an account for — see [Architecture & Cost](#architecture--cost).
- **🔄 Always-On Background Daemon**: Starts on system login (Windows Startup / macOS `launchd`) and runs quietly in the background without needing a terminal open.

---

## Architecture & Cost

**Fuli itself is free** — no subscriptions, no token bills. Everything below runs on your machine or on free tiers.

| Layer | Technology | Platform | Cost | Description |
| :--- | :--- | :--- | :--- | :--- |
| **Desktop UI** | Electron 36 (Widevine build) + plain CSS | Win / Mac | Free | Floating prompt bar pinned near the top of the screen, translucent dark look with native blur on macOS. |
| **Wake Word & STT** | `faster-whisper` (`tiny.en`) | Win / Mac | **$0.00** | Runs locally with 4 CPU threads (~0.25s inference). 100% offline & private. |
| **Voice Output (TTS)** | Microsoft Edge Neural TTS + System SAPI/Samantha | Win / Mac | **$0.00** | Natural female voice (`en-US-AriaNeural`). Zero subscription or API keys needed. |
| **Browser Operator** | Windows Script Host / PowerShell + AppleScript | Win / Mac | Free | Directly updates `active tab` in Edge / Chrome / Brave / Safari in-place. |
| **Action Planner** | Local Fast-Path Engine + Gemini Flash Fallback | Win / Mac | **$0.00** | Sub-millisecond rule engine for everyday tasks; Gemini free tier for multi-step plans. |
| **Background Runner**| Windows Startup / macOS `launchd` | Win / Mac | Built-in | Always-on background service running Fuli and auto-spawning the voice operator. |

**Optional extras** — these are add-ons that use accounts you may already have. Fuli never charges for them and works fine without them:

| Extra | What it adds | What you need |
| :--- | :--- | :--- |
| **Spotify connector** | Search, playlists and the player card | A free Spotify developer app (your own keys) |
| **Play music inside Fuli** | Audio plays in Fuli instead of the Spotify app | **Spotify Premium** (Spotify's rule, not Fuli's) and a free castlabs account. Otherwise Fuli falls back to controlling the Spotify desktop app (what plays there depends on your Spotify plan). |
| **Google connector** | Calendar, Gmail and YouTube commands | A free Google Cloud project with your own keys (setup below) |
| **Harder AI commands** | Multi-step plans for unusual requests | A free Gemini key. Everyday commands are handled locally and need no key. |

> If you share Fuli with others, each person uses their own free Gemini key and Spotify app keys.

---

## Project Structure

```text
AI_Assistant_Fuli/
├── fuli-app/               # ⚡ Fuli Native Desktop Operator App
│   ├── main.js             # Electron main process, hotkeys (Alt+Space/Option+Space), daemon runner
│   ├── preload.js          # Secure IPC context bridge
│   ├── build.js            # Cross-platform packager for Windows (.exe) and macOS (.app)
│   ├── automation/         # Local & Cloud action execution engine
│   │   ├── planner.js      # Sub-millisecond fast-path parser & Gemini model fallback chain
│   │   ├── browser.js      # Cross-platform browser controller (in-place tab navigation)
│   │   ├── system.js       # Windows & macOS native control (volume, media, apps, screenshot)
│   │   ├── extras.js       # Calculator, window snapping, system commands, clipboard history, snippets
│   │   ├── spotify.js      # Spotify search, login (OAuth PKCE), playlists, desktop-app fallback
│   │   ├── player.js       # In-app Spotify playback (Web Playback SDK, Fuli as the device)
│   │   ├── google.js       # Google login (OAuth PKCE) + Calendar, Gmail (read-only), YouTube
│   │   └── executor.js     # Sequential plan orchestrator with progress streaming
│   ├── player/             # Hidden page that hosts Spotify's Web Playback SDK
│   └── renderer/           # Prompt bar UI (HTML, CSS, JS): result cards, player, connectors panel
│
├── fuli/                   # 🎙️ Local Voice Engine & MCP Server
│   ├── voice_operator.py   # Real-time ~250ms sliding-window wake-word & STT/TTS engine
│   ├── config.py           # Environment & assistant identity
│   └── tools/              # MCP tools (news, finance, web, system monitors)
│
├── server.py               # FastMCP server over SSE transport (:8000)
├── agent_fuli.py           # Optional LiveKit real-time voice agent
├── package.json            # Desktop app scripts & cross-platform build tooling
├── pyproject.toml          # Python dependencies managed via uv
└── .env                    # Credentials and user preferences
```

---

## Quick Start

### 1. Prerequisites
- **Operating System**: Windows 10/11 (x64 / arm64) OR macOS (Apple Silicon M1-M4 / Intel)
- **Node.js**: ≥ 18
- **Python**: ≥ 3.11 with [`uv`](https://github.com/astral-sh/uv)
  - *macOS*: `brew install uv` or `curl -LsSf https://astral.sh/uv/install.sh | sh`
  - *Windows*: `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`

### 2. Setup

```bash
# Clone the repository
git clone https://github.com/Aareevs/AI_Assistant_Fuli.git
cd AI_Assistant_Fuli

# Install Python dependencies
uv sync

# Install Node dependencies
cd fuli-app && npm install && cd ..

# Configure environment
cp .env.example .env
```

Open `.env` and set your preferred identity:
```env
USER_NAME="Aareev"
SERVER_NAME="Fuli"
GOOGLE_API_KEY="your_free_google_ai_studio_key"

# Optional — only for the Spotify connector (setup steps under "Connectors" below)
SPOTIFY_CLIENT_ID=""
SPOTIFY_CLIENT_SECRET=""

# Optional — only for the Google connector (Calendar, Gmail, YouTube)
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
```

### 3. Build & Install

#### For Windows:
```bash
npm run build:win
```
- Outputs standalone `dist/Fuli-win32-x64/Fuli.exe`.
- Automatically installs to Windows Startup so Fuli launches on login in the background.
- Toggle anytime with **`Alt + Space`**.

#### For macOS:
```bash
npm run build:mac
```
- Packages `/Applications/Fuli.app`.
- Registers a persistent macOS `launchd` background service.
- Toggle anytime with **`Option + Space`**.

---

## How to Use Fuli

### The verbs — what each one does

| Say | Meaning | Examples |
| :--- | :--- | :--- |
| **search** | Show a results page. Never plays anything. | *"Search camping vids on YouTube"*, *"Search shoes on Amazon"*, *"Search quantum computing"* (Google) |
| **play** | Start playing something. | *"Play Blinding Lights"* → Spotify. *"Play my gym playlist"* → Spotify. *"Play MKBHD iPhone review"* → YouTube. |
| **watch** | Play a video. | *"Watch MKBHD iPhone review"* → YouTube |
| **open** | Open an app, site, playlist or album — without playing it. | *"Open Spotify"*, *"Open GitHub"*, *"Open my gym playlist"* |
| **show** / **list** | Display something from a connected account. | *"Show my playlists"*, *"Show my inbox"*, *"Show my schedule"* |

**How "play" decides between a song and a video:** if you add *"by <artist>"*, the word *"song"*, or *"on Spotify"*, Fuli plays it on Spotify. Otherwise it checks Spotify for a song whose title really matches what you said, and if there isn't one it plays it on YouTube instead. Add *"on YouTube"* or use *"watch"* to go straight to YouTube.

**Sites you can search by name:** YouTube, Amazon, Flipkart, eBay, Google Maps, Wikipedia, GitHub, Reddit, IMDb, Google Images, Google News, X/Twitter, Stack Overflow, Google Scholar. Any other *"search X"* is a Google search.

### Example Voice & Text Commands

| Command Category | Example Spoken / Typed Prompt | Action Taken |
| :--- | :--- | :--- |
| **ChatGPT Automation** | *"Open ChatGPT and send prompt write a sci-fi prologue"* | Opens `chatgpt.com` in your current browser tab, pastes prompt into chatbox, and presses Enter. |
| **Website Navigation** | *"Open YouTube"* or *"Go to GitHub"* | Navigates your active browser tab directly in-place without opening new tabs. |
| **Search** | *"Search quantum computing on Google"* | Directly searches Google in your active browser tab. |
| **App Control** | *"Open Spotify"* / *"Launch VS Code"* / *"Quit Slack"* | Opens or closes the application natively on Windows or macOS. |
| **Media Playback** | *"Play music"*, *"Pause music"*, *"Next song"* | Sends universal media key events to resume, pause, or skip tracks. |
| **Audio Volume** | *"Set volume to 50"*, *"Turn volume up"*, *"Mute"* | Adjusts master system output volume via CoreAudio / Windows Endpoint. |
| **Screen Capture** | *"Take a screenshot"* | Captures the screen cleanly without camera flash noises. |
| **Calculator** | *"What's 15% of 80"*, *"12 x 7"*, *"10 km to miles"*, *"72 f to c"* | Shows the answer in a card and copies it to your clipboard. |
| **Window Snapping** | *"Snap window left"*, *"Move window to the top right"*, *"Maximize window"* | Moves the window you were just using (macOS; needs Accessibility permission). |
| **System** | *"Lock screen"*, *"Turn on dark mode"*, *"Empty trash"*, *"Keep my Mac awake"*, *"Volume up"* | Runs the system action (mostly macOS). |
| **Clipboard & Snippets** | *"Show clipboard"*, *"Save snippet email: me@example.com"*, *"Paste email snippet"* | History of what you copied; click an item to copy it. Snippets are pasted into the app you were in. |
| **Google Calendar** | *"What's on today"*, *"My agenda this week"*, *"When's my next meeting"*, *"Add dinner with Sam at 8 tomorrow"*, *"Delete dinner with Sam"*, *"Cancel my 8pm meeting"* | Shows your events (click to open), adds one using Google's own date understanding, or finds the matching event(s) to delete — nothing is deleted until you click **Delete**. |
| **Gmail** (read-only) | *"Any unread emails"*, *"Unread from Pranav"*, *"Read my latest email"* | Lists unread mail (click to open in Gmail) or shows your newest email. |
| **YouTube** | *"Search camping vids on YouTube"*, *"Play lo-fi on YouTube"*, *"Show my YouTube playlists"* | **Search** shows YouTube's results page. **Play / watch** opens the top video in your current browser tab (needs Google connected; otherwise it shows the results page). Lists your playlists. |
| **Spotify** | *"Play Blinding Lights by The Weeknd"*, *"Play the album After Hours"*, *"Open playlists from Spotify"*, *"Play my gym playlist"*, *"What's playing"* | Plays in Fuli's player card. *Open* only shows a playlist; *play* starts it. |

---

## Connectors

Click the **plug icon** next to the mic to see the services you can link to Fuli. Each shows **Connect** or **Disconnect** and its status.

<details>
<summary><b>🎵 Spotify — how to connect it (click to expand)</b></summary>

<br>

You create your own free Spotify "app" once. That gives Fuli permission to search music and read your playlists. It never changes your account.

**You need:** a Spotify account (**Premium** to play music inside Fuli) and the Spotify desktop app installed.

**1. Create the app**
1. Go to <https://developer.spotify.com/dashboard> and log in.
2. Click **Create app**.
3. Fill in:
   - **App name:** `Fuli` (anything)
   - **App description:** `Personal AI assistant` (anything)
   - **Redirect URI:** `http://127.0.0.1:8888` — type it exactly, click **Add**.
   - **Which API/SDKs are you planning to use?** tick **Web API** and **Web Playback SDK**.
4. Accept the terms and click **Save**.

**2. Copy your keys**
1. Open your new app → **Settings**.
2. Copy the **Client ID**. Click **View client secret** and copy that too.

**3. Put them in `.env`**
```env
SPOTIFY_CLIENT_ID="paste-client-id-here"
SPOTIFY_CLIENT_SECRET="paste-client-secret-here"
```

**4. Rebuild so the app picks them up** (the installed app keeps its own copy of `.env`)
```bash
cd fuli-app && npm run build
```

**5. Connect**
1. Open Fuli, click the **plug icon** → **Spotify** → **Connect**.
2. Your browser opens Spotify's page asking *"Allow Fuli?"* — click **Agree**.
3. The page says *Fuli is connected*, and the row shows **Connected as** your name.

**6. Try it**
- *"Play Shape of You by Ed Sheeran"*
- *"Open playlists from Spotify"* — click one to open it, press ▶ to play it
- *"Play my gym playlist"* · *"Open my gym playlist"* (shows it without playing)
- *"What's playing"*

**Notes**
- Your login is stored in `~/.fuli/spotify-token.json`. **Disconnect** (or deleting that file) removes it.
- An app in Spotify's development mode works for **your** account. To let up to 25 friends use your keys, add their emails under *Dashboard → your app → User Management*. Otherwise each person should create their own app, as above.
- Spotify only lists the songs of playlists **you own or follow**; for other people's playlists Fuli still plays them but can't show the track list.
- Saying *"my … playlist"* only ever matches your own playlists, so Fuli never plays a stranger's by accident.

**Troubleshooting**
- *"INVALID_CLIENT: Invalid redirect URI"* → the Redirect URI in the dashboard must be exactly `http://127.0.0.1:8888` (no trailing slash). Save, then Connect again.
- *"Add SPOTIFY_CLIENT_ID…"* → the keys aren't in `.env`, or you haven't rebuilt since adding them.
- Row says **Reconnect** → Fuli added a permission since you last connected; click it once.
- Songs skip after a second → see the next section (in-app audio needs a signed build). Fuli falls back to the Spotify app automatically, so music still plays.

</details>

<details>
<summary><b>🔵 Google (Calendar, Gmail, YouTube) — how to connect it (click to expand)</b></summary>

<br>

Like Spotify, you create your own free Google "app" once. It gives Fuli permission to read, add and delete calendar events, read your Gmail (**read-only** — Fuli can't send or delete email), and read your YouTube playlists.

**1. Create a project**
1. Go to <https://console.cloud.google.com> and sign in.
2. Click the project picker at the top → **New project** → name it `Fuli` → **Create**, then select it.

**2. Switch on the three APIs**
Open **APIs & Services → Library**, search for each of these and click **Enable**:
- **Google Calendar API**
- **Gmail API**
- **YouTube Data API v3**

**3. Set up the consent screen** (APIs & Services → **OAuth consent screen**, also called *Google Auth Platform*)
1. **User type: External** → Create.
2. **Branding** page — Google needs these to publish. Fill them in, then **Save**:
   - **App name:** `Fuli`
   - **User support email:** your email (pick it from the dropdown)
   - **App home page:** your copy of this repo, e.g. `https://github.com/<you>/AI_Assistant_Fuli`
   - **Privacy policy link:** the [PRIVACY.md](PRIVACY.md) in this repo, e.g. `https://github.com/<you>/AI_Assistant_Fuli/blob/main/PRIVACY.md`
   - **Developer contact email:** your email (at the bottom)

   Skip the logo — adding one makes Google ask for a full verification review. If Google complains about an *authorized domain* for the links, add `github.com` under **Authorized domains**.
3. **Scopes / Data Access** → add these:
   - `openid`
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
   - `.../auth/calendar.events`
   - `.../auth/gmail.readonly`
   - `.../auth/youtube.readonly`

   If some are already listed (Google often pre-adds the first three), just add the rest, then **Update** and **Save**.
4. **Publish the app** (Audience → **Publish app** → Confirm) so its status is **In production**.

> **Why step 4 matters:** while an app is in *Testing*, Google expires your login every **7 days**, so you'd have to reconnect weekly. In production the login lasts. You don't need to submit for verification — Google just shows an *"unverified app"* warning the first time you connect (below), which is fine for personal use (limit: 100 users).

**4. Create the keys**
1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. **Application type: Desktop app**, name it `Fuli` → **Create**.
3. Copy the **Client ID** and **Client secret**.

**5. Put them in `.env`, then rebuild**
```env
GOOGLE_CLIENT_ID="paste-client-id-here"
GOOGLE_CLIENT_SECRET="paste-client-secret-here"
```
```bash
cd fuli-app && npm run build
```

**6. Connect**
1. Click the **plug icon** → **Google** → **Connect**.
2. Your browser opens Google's sign-in. Choose your account.
3. You'll see **"Google hasn't verified this app"** → click **Advanced → Go to Fuli (unsafe)**. It's your own app, so this is expected.
4. Tick the permissions and **Continue**. The page says *Fuli is connected to Google*.

**7. Try it**
- *"What's on today"* · *"Add dinner with Sam at 8 tomorrow"* · *"Delete dinner with Sam"* · *"When's my next meeting"*
- *"Any unread emails"* · *"Unread from Pranav"* · *"Read my latest email"*
- *"Search camping vids on YouTube"* · *"Play lo-fi on YouTube"* · *"Show my YouTube playlists"*

**Notes**
- Your login is stored in `~/.fuli/google-token.json`. **Disconnect** removes it and tells Google to forget it.
- YouTube search uses Google's free daily quota (about 100 searches a day).
- Fuli only ever *reads* your email. Calendar is the one place it writes: it adds events you ask for, and deletes them only after you click **Delete** on the event it found.

**Troubleshooting**
- *"Add GOOGLE_CLIENT_ID…"* / the Google row has no button → keys missing from `.env`, or you haven't rebuilt since adding them.
- *"That Google API isn't switched on"* → enable the missing API in step 2.
- *"Google did not return a long-lived login"* → go to <https://myaccount.google.com/permissions>, remove Fuli, and connect again.
- Asked to reconnect every week → the app is still in *Testing*; do step 3.4 (**Publish app**).
- *"Access blocked: Fuli has not completed the Google verification process"* → the app is in Testing and your email isn't a listed test user. Publish it (step 3.4), or add yourself under *Audience → Test users*.

</details>

<details>
<summary><b>🔐 Playing audio inside Fuli (macOS) — one-time signing setup (click to expand)</b></summary>

<br>

Spotify's web player is copy-protected (Widevine). Stock Electron doesn't include it, and Spotify only streams to builds that carry a **castlabs signature**. Without this, Fuli still works: it plays through the (hidden) Spotify desktop app instead, and you still get Fuli's player card and controls.

**1. Get the Widevine-enabled Electron build** (one file, ~108 MB)
```bash
mkdir -p .electron-zip
curl -L -o ".electron-zip/electron-v36.9.5+wvcus-darwin-arm64.zip" \
  "https://github.com/castlabs/electron-releases/releases/download/v36.9.5%2Bwvcus/electron-v36.9.5+wvcus-darwin-arm64.zip"
cd fuli-app && npm install
```
> Intel Mac? Replace `arm64` with `x64` in both the file name and the URL.

**2. Install the signing tool**
```bash
cd ..   # repo root
python3 -m venv .evs-venv
.evs-venv/bin/pip install castlabs-evs
```

**3. Create your free castlabs EVS account** (once)
```bash
cd fuli-app
npm run evs:signup     # asks for email, name, organisation (anything), account name, password
npm run evs:confirm    # enter the code castlabs emails you
```
Password needs 8+ characters with upper-case, lower-case, a number and a symbol.

**4. Build** — signing happens automatically
```bash
npm run build
```
You should see `✓ VMP-signed bundle (castlabs EVS)`. The first signing uploads ~160 MB and takes a couple of minutes; later builds are quick.

**Troubleshooting**
- *`VMP signing skipped`* → step 2 or 3 wasn't completed.
- *`npm start` says "Electron Framework" is missing* → npm skipped Electron's install script. Unpack the zip by hand:
  ```bash
  cd fuli-app/node_modules/electron && rm -rf dist && mkdir dist \
    && ditto -x -k "../../../.electron-zip/electron-v36.9.5+wvcus-darwin-arm64.zip" dist \
    && printf "Electron.app/Contents/MacOS/Electron" > path.txt
  ```
- Playback errors in `~/.fuli/player.log` → if you see `playback_error` right after starting a song, the build isn't signed; Fuli will fall back to the Spotify app.

</details>

---

## Customization

- **Form of Address**: Change `USER_NAME` in `.env` to whatever name you want Fuli to call you.
- **Default Browser**: Prioritizes **Microsoft Edge**, falling back to **Google Chrome**, **Brave**, **Safari**, or your system default.
- **Shortcuts**: Both `Alt + Space` / `Option + Space` and `Ctrl/Cmd + Shift + Space` are active by default.
- **Speaking vs typing**: Fuli answers out loud only to spoken commands. Typed commands stay silent.

---

## License

This project is licensed under the [MIT License](LICENSE) — see the [LICENSE](LICENSE) file for details.
