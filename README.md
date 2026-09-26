# Fuli — AI Desktop Operator & Voice Assistant (100% Free, Cross-Platform for Windows & macOS)

<p align="center">
  <img src="images/Fuli_Logo.png" width="120" alt="Fuli Logo" />
</p>

Fuli is an agile, intelligent, autonomous desktop operator and hands-free voice assistant engineered for both **Windows** (10/11) and **macOS** (Apple Silicon & Intel). Designed as an always-available Spotlight/PowerToys-style floating operator, Fuli controls your computer, navigates your active browser in-place without opening duplicate tabs, launches and quits apps, manages media and volume, and speaks to you with a natural female voice—all at **$0.00 cost** (zero paid subscriptions or token bills).

---

## Key Features

- **⚡ Universal Hotkey (`Alt + Space` / `Option + Space`)**: Summon or dismiss Fuli instantly from anywhere on Windows or macOS.
- **🎙️ Hands-Free Wake Word ("Fuli")**: Say *"Fuli"* or *"Hey Fuli"* to trigger wake-up instantly (~250ms sliding-window detection) accompanied by a crisp native tactile chime.
- **🗣️ Natural Female Voice (Free)**: Real-time verbal feedback using Microsoft Edge Neural TTS (`en-US-AriaNeural`) with native offline speech fallbacks (Windows SAPI / macOS `Samantha`).
- **🌐 In-Place Browser Navigation**: Operates directly inside your **currently active browser** (Microsoft Edge, Google Chrome, Brave, Safari). Reuses your existing tab in place—**no test browsers, no automation banners, and no duplicate tabs**.
- **🤖 Autonomous Web App Interaction**: Paste and send prompts directly into **ChatGPT**, Claude, Google Search, and web forms with native clipboard fidelity.
- **💻 Full Native OS Control (Windows & macOS)**:
  - **Application Management**: Launch and terminate applications (*Spotify, VS Code, Slack, WhatsApp, Terminal, Discord, etc.*)
  - **Master Volume**: Smooth volume adjustments (0–100%) and mute/unmute via Windows CoreAudio and macOS AppleScript
  - **Media Keys**: Hardware-level virtual media keys (Play/Pause, Next Track, Previous Track) across any media player
  - **Screen Capture**: Clean, silent desktop screenshots saved straight to your temporary directory or desktop
- **💰 100% Free Architecture ($0 Cost)**: Runs completely on local hardware and free-tier APIs. Zero monthly fees, zero token bills.
- **🔄 Always-On Background Daemon**: Starts on system login (Windows Startup / macOS `launchd`) and runs quietly in the background without needing a terminal open.

---

## Architecture & Zero-Cost Stack

| Layer | Technology | Platform | Cost | Description |
| :--- | :--- | :--- | :--- | :--- |
| **Desktop UI** | Electron 35 + Glassmorphic CSS | Win / Mac | Free | Floating, auto-centering prompt bar pinned to top of screen with dark glassmorphism. |
| **Wake Word & STT** | `faster-whisper` (`tiny.en`) | Win / Mac | **$0.00** | Runs locally with 4 CPU threads (~0.25s inference). 100% offline & private. |
| **Voice Output (TTS)** | Microsoft Edge Neural TTS + System SAPI/Samantha | Win / Mac | **$0.00** | Natural female voice (`en-US-AriaNeural`). Zero subscription or API keys needed. |
| **Browser Operator** | Windows Script Host / PowerShell + AppleScript | Win / Mac | Free | Directly updates `active tab` in Edge / Chrome / Brave / Safari in-place. |
| **Action Planner** | Local Fast-Path Engine + Gemini Flash Fallback | Win / Mac | **$0.00** | Sub-millisecond rule engine for everyday tasks; Gemini free tier for multi-step plans. |
| **Background Runner**| Windows Startup / macOS `launchd` | Win / Mac | Built-in | Always-on background service running Fuli and auto-spawning the voice operator. |

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
│   │   └── executor.js     # Sequential plan orchestrator with progress streaming
│   └── renderer/           # Glassmorphic UI (HTML, CSS, JS) with dynamic resizing
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
git clone https://github.com/Aareev/AI_Assistant_Fuli.git
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

---

## Customization

- **Form of Address**: Change `USER_NAME` in `.env` to whatever name you want Fuli to call you.
- **Default Browser**: Prioritizes **Microsoft Edge**, falling back to **Google Chrome**, **Brave**, **Safari**, or your system default.
- **Shortcuts**: Both `Alt + Space` / `Option + Space` and `Ctrl/Cmd + Shift + Space` are active by default.

---

## License

This project is licensed under the [MIT License](LICENSE) — see the [LICENSE](LICENSE) file for details.
