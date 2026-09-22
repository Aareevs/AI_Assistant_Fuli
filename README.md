# Fuli — AI Desktop Operator & Voice Assistant (100% Free & Local)

<p align="center">
  <img src="images/Fuli_Logo.png" width="120" alt="Fuli Logo" />
</p>

Fuli is an agile, intelligent, autonomous macOS desktop operator and hands-free voice assistant. Designed as a permanent Spotlight/Raycast-style operator, Fuli controls your Mac, navigates your active browser in-place, launches and quits apps, manages playback, and responds verbally with a natural female voice—all at **$0.00 cost** (zero paid APIs required).

---

## Key Features

- **⚡ Instant Shortcut (`Option + Space`)**: Summon or dismiss Fuli instantly from anywhere on macOS, just like Spotlight (`Cmd + Space`).
- **🎙️ Hands-Free Wake Word ("Fuli")**: Say *"Fuli"* to wake her up instantly (~250ms sliding-window detection) with a crisp 50ms tactile chime.
- **🗣️ Natural Female Voice (Free)**: Conversational verbal feedback using Microsoft Edge Neural TTS (`en-US-AriaNeural`) and macOS native speech (`Samantha`).
- **🌐 In-Place Browser Navigation**: Operates directly inside your **current open browser** (Microsoft Edge, Google Chrome, Safari). Reuses your existing tab in place—**no test browsers, no automation banners, and no unwanted new tabs**.
- **🤖 Autonomous Web App Interaction**: Paste and send prompts directly into **ChatGPT**, Claude, Google Search, and web forms with native clipboard fidelity.
- **💻 Full macOS Device Control**:
  - Launch and quit any application (*Spotify, VS Code, Slack, WhatsApp, Terminal, Discord, etc.*)
  - System volume adjustment (0–100%) and mute/unmute
  - Media playback controls (*Play, Pause, Next Track for Spotify & Apple Music*)
  - Desktop screenshots and terminal command execution
- **💰 100% Free Architecture ($0 Cost)**: Runs entirely on local Apple Silicon hardware and free provider tiers. Zero paid API subscriptions, zero token bills.
- **🔄 24/7 Background Daemon**: Managed by macOS `launchd` (`com.aareev.fuli`). Boots automatically on login and revives in milliseconds. No terminal commands required to keep it alive.

---

## Architecture & Zero-Cost Stack

| Layer | Technology | Cost | Description |
| :--- | :--- | :--- | :--- |
| **Desktop UI** | Electron 35 + Glassmorphic CSS | Free | Floating, auto-centering prompt bar pinned to top of screen with dark glassmorphism. |
| **Wake Word & STT** | `faster-whisper` (`tiny.en`) | **$0.00** | Runs locally on Apple Silicon (4 CPU threads, ~0.3s inference). 100% offline & private. |
| **Voice Output (TTS)** | Microsoft Edge Neural TTS + macOS `Samantha` | **$0.00** | Crisp, natural female voice (`en-US-AriaNeural`). Zero subscription or API keys needed. |
| **Browser Operator** | AppleScript + System Events | Free | Directly updates `active tab of front window` in Microsoft Edge / Chrome / Safari in-place. |
| **Action Planner** | Local Fast-Path Engine + Gemini Flash Fallback | **$0.00** | Sub-millisecond rule engine for all everyday tasks; Gemini free tier for complex multi-step plans. |
| **Daemon Manager** | macOS `launchd` LaunchAgent | Built-in | Always-on background daemon running `Fuli.app` and auto-spawning the voice operator. |

---

## Project Structure

```text
AI_Assistant_Fuli/
├── fuli-app/               # ⚡ Fuli Native Desktop Operator App
│   ├── main.js             # Electron main process, hotkey registration (Option+Space), daemon runner
│   ├── preload.js          # Secure IPC context bridge
│   ├── build.js            # Native macOS .app packager & launchd agent installer
│   ├── automation/         # Local & Cloud action execution engine
│   │   ├── planner.js      # Sub-millisecond fast-path parser & Gemini model fallback chain
│   │   ├── browser.js      # Active browser tab controller (Edge/Chrome/Safari in-place)
│   │   ├── system.js       # macOS native control (volume, media, apps, shell, screenshot)
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
├── package.json            # Desktop app scripts & build tooling
├── pyproject.toml          # Python dependencies managed via uv
└── .env                    # Credentials and user preferences
```

---

## Quick Start

### 1. Prerequisites
- macOS (Apple Silicon M1/M2/M3/M4 recommended)
- Node.js ≥ 18
- Python ≥ 3.11 & [`uv`](https://github.com/astral-sh/uv) (`brew install uv` or `curl -LsSf https://astral.sh/uv/install.sh | sh`)

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

### 3. Build & Install Native macOS Application

Build the standalone `/Applications/Fuli.app` bundle and register the 24/7 background LaunchAgent:
```bash
npm run build:app
```

Once built:
- **`Option + Space`**: Press anywhere on your Mac to toggle Fuli.
- **"Fuli"**: Speak out loud to wake Fuli hands-free.
- Fuli starts automatically on macOS login and runs 24/7 without needing any terminal window open.

---

## How to Use Fuli

### Example Voice & Text Commands

| Command Category | Example Spoken / Typed Prompt | Action Taken |
| :--- | :--- | :--- |
| **ChatGPT Automation** | *"Open ChatGPT and send prompt write a sci-fi prologue"* | Opens `chatgpt.com` in your open Edge tab, pastes the prompt into the chatbox, and presses Enter. |
| **Website Navigation** | *"Open YouTube"* or *"Go to GitHub"* | Navigates your active browser tab directly to the website without creating new tabs. |
| **Search** | *"Search quantum computing on Google"* | Directly searches Google in your active browser tab. |
| **App Control** | *"Open Spotify"* / *"Launch VS Code"* / *"Quit Slack"* | Opens or closes the application natively on macOS. |
| **Media Playback** | *"Play music"*, *"Pause music"*, *"Next song"* | Controls Spotify or Apple Music playback. |
| **Audio Volume** | *"Set volume to 50"*, *"Turn volume up"*, *"Mute"* | Adjusts macOS system audio output volume. |
| **Screen Capture** | *"Take a screenshot"* | Captures your screen and saves it directly to your Desktop. |

---

## Customization

- **Form of Address**: Change `USER_NAME` in `.env` to whatever name you want Fuli to call you.
- **Default Browser**: Fuli automatically checks for running browsers and prioritizes **Microsoft Edge**, falling back to **Google Chrome**, **Safari**, or your system default.
- **Shortcuts**: Both `Option + Space` and `Cmd + Shift + Space` are globally registered.

---

## License

This project is licensed under the [MIT License](LICENSE) — see the [LICENSE](LICENSE) file for details.

