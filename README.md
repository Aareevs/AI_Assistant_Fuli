# Fuli — AI Voice Assistant & MCP Server

Fuli is an agile, sharp, and intelligent AI voice assistant split into two cooperating components:

| Component | Command | What it is |
| --- | --- | --- |
| **MCP Server** | `uv run fuli` | A [FastMCP](https://github.com/jlowin/fastmcp) server exposing tools (live global news, financial briefings, browser monitors, system utilities) over SSE transport. |
| **Voice Agent** | `uv run fuli_voice` | A [LiveKit Agents](https://github.com/livekit/agents) voice pipeline that listens to your speech, reasons with an LLM (Gemini 2.5 Flash / OpenAI), and speaks back with a crisp, natural female voice (OpenAI Nova / Sarvam Kavya) while invoking tools in real time. |

---

## Personality & Voice

- **Persona**: Sharp, quick, natural cadence that sounds like a real person over voice rather than a robotic butler.
- **Form of Address**: Calls you directly by name (configurable via `USER_NAME` in `.env`).
- **Cadence**: Concise, responsive, zero fluff, with proactive visual monitors.

---

## Architecture

```text
Microphone ──► STT (Sarvam Saaras v3 / Whisper)
                    │
                    ▼
              LLM (Gemini 2.5 Flash / GPT-4o) ◄──────► MCP Server (FastMCP / SSE on :8000)
                    │                                        ├─ get_world_news
                    ▼                                        ├─ open_world_monitor
              TTS (OpenAI nova / Sarvam kavya)               ├─ get_world_finance_news
                    │                                        ├─ open_finance_world_monitor
                    ▼                                        └─ …more tools
             Speaker / LiveKit Room
```

The voice agent connects to the MCP server via SSE at `http://127.0.0.1:8000/sse` (or resolved host IP).

---

## Project Structure

```text
AI_Assistant_Fuli/
├── server.py           # uv run fuli        → launches FastMCP server (SSE on :8000)
├── agent_fuli.py       # uv run fuli_voice  → launches LiveKit voice agent
├── pyproject.toml      # Project configuration & CLI entry points
├── .env.example        # Environment variable template
│
└── fuli/               # MCP server package
    ├── config.py       # Settings & environment variables
    ├── tools/          # MCP tools callable by the agent
    │   ├── web.py      # get_world_news, get_world_finance_news, visual monitors
    │   ├── system.py   # get_current_time, get_system_info
    │   └── utils.py    # format_json, word_count
    ├── prompts/        # MCP prompt templates (summarize, explain_code)
    └── resources/      # MCP resources (fuli://info)
```

---

## Quick Start

### 1. Prerequisites

* Python ≥ 3.11
* [`uv`](https://github.com/astral-sh/uv) (`curl -LsSf https://astral.sh/uv/install.sh | sh` or `pip install uv`)
* A free [LiveKit Cloud](https://cloud.livekit.io) project

### 2. Setup

```bash
# Sync dependencies and virtualenv
uv sync

# Configure environment variables
cp .env.example .env
```

Open `.env` and set your credentials (see table below). You can also set your name:
```env
USER_NAME="Aareev"
```

### 3. Run

Run these commands in two separate terminal tabs:

**Terminal 1 — MCP Server** (start this first):
```bash
uv run fuli
```

**Terminal 2 — Voice Agent**:
```bash
uv run fuli_voice
```

Connect to your LiveKit room via the [LiveKit Agents Playground](https://agents-playground.livekit.io) to start talking to Fuli.

---

## CLI Commands

| Command | Entry point | Description |
| --- | --- | --- |
| `uv run fuli` | `server.py → main()` | Starts the **FastMCP server** over SSE transport on port 8000. Registers tools, prompts, and resources. |
| `uv run fuli_voice` | `agent_fuli.py → dev()` | Launches the **LiveKit voice agent** in development mode. Connects to your room and hooks up Fuli's brain. |

---

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `USER_NAME` | Optional | Name Fuli uses to address you (default: `"Aareev"`) |
| `SERVER_NAME` | Optional | Name of the MCP server instance (default: `"Fuli"`) |
| `LIVEKIT_URL` | ✅ | LiveKit Cloud WebSocket URL (`wss://...`) |
| `LIVEKIT_API_KEY` | ✅ | LiveKit Cloud API Key |
| `LIVEKIT_API_SECRET` | ✅ | LiveKit Cloud API Secret |
| `GOOGLE_API_KEY` | ✅ *(Default LLM)* | Gemini API Key for `gemini-2.5-flash` |
| `OPENAI_API_KEY` | ✅ *(Default TTS)* | OpenAI API Key for TTS (`nova` voice) |
| `SARVAM_API_KEY` | ✅ *(Default STT)* | Sarvam AI API Key for speech transcription |
| `GROQ_API_KEY` | Optional | Groq API Key if using Groq models |

---

## Customizing Providers & Voices

In [agent_fuli.py](file:///Users/aareev/VS-Code/AI_Assistant_Fuli/agent_fuli.py), you can configure:

```python
STT_PROVIDER        = "sarvam"   # "sarvam" | "whisper"
LLM_PROVIDER        = "gemini"   # "gemini" | "openai"
TTS_PROVIDER        = "openai"   # "openai" | "sarvam"

# Female TTS options:
OPENAI_TTS_VOICE    = "nova"     # Clean, natural female voice
SARVAM_TTS_SPEAKER  = "kavya"    # Natural Indian-English female voice
```

---

## Adding New Tools

1. Create or modify a tool file in `fuli/tools/`.
2. Define a `register(mcp)` function and decorate tools with `@mcp.tool()`.
3. Register the module in `fuli/tools/__init__.py`.

The MCP server will register your new tools on the next restart.
