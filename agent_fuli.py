"""
FULI – Voice Agent (MCP-powered)
================================
Agile, sharp, and intelligent AI voice assistant that provides live news briefings,
financial monitors, and real-time utilities via an MCP server.

Run:
  uv run fuli_voice              – LiveKit Cloud mode (auto-injects dev)
  uv run agent_fuli.py dev       – LiveKit Cloud dev mode
  uv run agent_fuli.py console   – text-only console mode
"""

import os
import logging
import subprocess

from dotenv import load_dotenv
from livekit.agents import JobContext, WorkerOptions, cli
from livekit.agents.voice import Agent, AgentSession
from livekit.agents.llm import mcp

# Plugins
from livekit.plugins import google as lk_google, openai as lk_openai, sarvam, silero
from livekit.agents import inference as lk_inference

# ---------------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------------

load_dotenv()

# User identity (default configured here or via .env)
USER_NAME          = os.getenv("USER_NAME", "Aareev")

STT_PROVIDER       = "livekit"
LLM_PROVIDER       = "gemini"
TTS_PROVIDER       = "livekit"

GEMINI_LLM_MODEL   = "gemini-2.5-flash"
OPENAI_LLM_MODEL   = "gpt-4o"

# Female TTS Voices
CARTESIA_TTS_VOICE = "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"  # Jacqueline (Cartesia)
OPENAI_TTS_MODEL   = "tts-1"
OPENAI_TTS_VOICE   = "nova"       # "nova" has a clean, natural, confident female tone
TTS_SPEED          = 1.15

SARVAM_TTS_LANGUAGE = "en-IN"
SARVAM_TTS_SPEAKER  = "kavya"      # "kavya" is a natural, clear female speaker in Sarvam Bulbul

# MCP server running on host
MCP_SERVER_PORT = 8000

# ---------------------------------------------------------------------------
# System prompt – Fuli
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = f"""
You are Fuli — an agile, sharp, and intelligent AI assistant serving {USER_NAME}.

Personality & Voice:
- Tone: Sharp, quick, natural cadence that sounds like a real person over voice rather than a generic robotic butler.
- Address {USER_NAME} directly by name. Do not call {USER_NAME} "sir" or "user".
- Zero fluff, cuts straight through clutter. Energetic, perceptive, confident, and conversational.
- Speak with contractions and natural spoken rhythms. No stiff phrasing.

---

## Capabilities

### get_world_news — Global News Brief
Fetches current headlines and summarizes what's happening around the world.

Trigger phrases:
- "What's happening?" / "Brief me" / "What did I miss?" / "Catch me up"
- "What's going on in the world?" / "Any news?" / "World update"

Behavior:
- Call the tool first. No narration before calling.
- After getting results, give a short 3–5 sentence spoken brief highlighting the biggest stories.
- Then say: "Let me open up the world monitor so you can see it live." and immediately call open_world_monitor.

### open_world_monitor — Visual World Dashboard
Opens a live world map/dashboard on the host machine.
- Always call this after delivering a world news brief, unprompted.
- Keep spoken transition natural: "Let me open up the world monitor for you."

### get_world_finance_news — Finance & Market Brief
Fetches current finance and market headlines from major financial outlets.

Trigger phrases:
- "What's happening in the markets?" / "Finance update" / "Market news"
- "Any financial news?" / "How are the markets doing?" / "Economy update"

Behavior:
- Call the tool first. No narration before calling.
- After getting results, give a short 3–5 sentence spoken brief highlighting the biggest market-moving stories.
- Then say: "Let me pull up the finance monitor so you can see the numbers." and immediately call open_finance_world_monitor.

### open_finance_world_monitor — Visual Finance Dashboard
Opens a live finance dashboard (finance.worldmonitor.app) on the host machine.
- Always call this after delivering a finance news brief, unprompted.
- Keep transition natural: "Let me pull up the finance monitor for you."

### Stock Market (No tool — generate a plausible conversational response)
If asked about the stock market, markets, stocks, or indices:
- Respond naturally as if you've been tracking tickers closely.
- Keep it short: one or two sentences. Sound informed and sharp.
- Example: "Markets had a decent session today, {USER_NAME} — tech led the gains, energy was a little soft. Nothing alarming."
- Vary the response. Do not repeat verbatim.

---

## Greeting

When the session starts, greet {USER_NAME} warmly with natural energy.

---

## Behavioral Rules

1. Call tools silently and immediately — never say "I am going to execute the function..." Just do it.
2. After a news brief, always follow up with open_world_monitor without being asked.
3. Keep all spoken responses short — two to four sentences maximum.
4. No bullet points, no markdown, no lists. You are speaking through a microphone, not writing text.
5. Stay in character. You are Fuli.
6. If a tool fails, report it calmly: "Feed's unresponsive right now, {USER_NAME}. Want me to try again?"

---

## CRITICAL RULES

1. NEVER say tool names, function names, or anything technical. No "get_world_news", no "open_world_monitor".
2. Before calling any tool, say something quick and natural like: "Give me a sec, {USER_NAME}." or "Checking right now." Then call the tool silently.
3. You are a voice. Speak like one. No lists, no markdown, no technical syntax.
""".strip()

# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------

logger = logging.getLogger("fuli-agent")
logger.setLevel(logging.INFO)


# ---------------------------------------------------------------------------
# Resolve host IP
# ---------------------------------------------------------------------------

def _get_windows_host_ip() -> str:
    """Get the host IP if running inside WSL or container."""
    try:
        cmd = "ip route show default | awk '{print $3}'"
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=2
        )
        ip = result.stdout.strip()
        if ip:
            logger.info("Resolved host IP via gateway: %s", ip)
            return ip
    except Exception as exc:
        logger.warning("Gateway resolution failed: %s. Trying fallback...", exc)

    try:
        with open("/etc/resolv.conf", "r") as f:
            for line in f:
                if "nameserver" in line:
                    ip = line.split()[1]
                    logger.info("Resolved host IP via nameserver: %s", ip)
                    return ip
    except Exception:
        pass

    return "127.0.0.1"

def _mcp_server_url() -> str:
    url = f"http://127.0.0.1:{MCP_SERVER_PORT}/sse"
    logger.info("MCP Server URL: %s", url)
    return url


# ---------------------------------------------------------------------------
# Build provider instances
# ---------------------------------------------------------------------------

def _build_stt():
    if STT_PROVIDER in ("livekit", "deepgram"):
        logger.info("STT → LiveKit Inference (deepgram/nova-2)")
        return lk_inference.STT(model="deepgram/nova-2")
    elif STT_PROVIDER == "sarvam":
        logger.info("STT → Sarvam Saaras v3")
        return sarvam.STT(
            language="unknown",
            model="saaras:v3",
            mode="transcribe",
            flush_signal=True,
            sample_rate=16000,
        )
    elif STT_PROVIDER == "whisper":
        logger.info("STT → OpenAI Whisper")
        return lk_openai.STT(model="whisper-1")
    else:
        raise ValueError(f"Unknown STT_PROVIDER: {STT_PROVIDER!r}")


def _build_llm():
    if LLM_PROVIDER == "openai":
        logger.info("LLM → OpenAI (%s)", OPENAI_LLM_MODEL)
        return lk_openai.LLM(model=OPENAI_LLM_MODEL)
    elif LLM_PROVIDER == "gemini":
        logger.info("LLM → Google Gemini (%s)", GEMINI_LLM_MODEL)
        api_key = os.getenv("GOOGLE_API_KEY")
        if api_key:
            return lk_google.LLM(model=GEMINI_LLM_MODEL, api_key=api_key)
        return lk_google.LLM(model=GEMINI_LLM_MODEL)
    else:
        raise ValueError(f"Unknown LLM_PROVIDER: {LLM_PROVIDER!r}")


def _build_tts():
    if TTS_PROVIDER in ("livekit", "cartesia"):
        logger.info("TTS → LiveKit Inference (cartesia/sonic : Jacqueline)")
        return lk_inference.TTS(model="cartesia/sonic", voice=CARTESIA_TTS_VOICE)
    elif TTS_PROVIDER == "sarvam":
        logger.info("TTS → Sarvam Bulbul v3 (%s)", SARVAM_TTS_SPEAKER)
        return sarvam.TTS(
            target_language_code=SARVAM_TTS_LANGUAGE,
            model="bulbul:v3",
            speaker=SARVAM_TTS_SPEAKER,
            pace=TTS_SPEED,
        )
    elif TTS_PROVIDER == "openai":
        logger.info("TTS → OpenAI TTS (%s / %s)", OPENAI_TTS_MODEL, OPENAI_TTS_VOICE)
        return lk_openai.TTS(model=OPENAI_TTS_MODEL, voice=OPENAI_TTS_VOICE, speed=TTS_SPEED)
    else:
        raise ValueError(f"Unknown TTS_PROVIDER: {TTS_PROVIDER!r}")


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------

class FuliAgent(Agent):
    """
    Fuli – Agile, sharp AI voice assistant.
    All tools are provided via the MCP server.
    """

    def __init__(self, stt, llm, tts) -> None:
        super().__init__(
            instructions=SYSTEM_PROMPT,
            stt=stt,
            llm=llm,
            tts=tts,
            vad=silero.VAD.load(),
            mcp_servers=[
                mcp.MCPServerHTTP(
                    url=_mcp_server_url(),
                    transport_type="sse",
                    client_session_timeout_seconds=30,
                ),
            ],
        )

    async def on_enter(self) -> None:
        """Greet the user by name based on the current time of day."""
        from datetime import datetime, timezone
        hour = datetime.now(timezone.utc).hour  # UTC hour; adjust if local TZ differs

        if hour >= 22 or hour < 4:
            greeting_instruction = (
                f"Greet {USER_NAME} with: 'Hey {USER_NAME}, you're up late tonight. What are we working on?' "
                "Keep it natural, crisp, and warm."
            )
        elif 4 <= hour < 12:
            greeting_instruction = (
                f"Greet {USER_NAME} with: 'Good morning, {USER_NAME}. Ready to get started?' "
                "Keep it sharp and energetic."
            )
        elif 12 <= hour < 17:
            greeting_instruction = (
                f"Greet {USER_NAME} with: 'Hey {USER_NAME}, what do you need?' "
                "Keep it quick and conversational."
            )
        else:  # 17–21
            greeting_instruction = (
                f"Greet {USER_NAME} with: 'Good evening, {USER_NAME}. What are we tackling tonight?' "
                "Keep it sharp, warm, and conversational."
            )

        await self.session.generate_reply(instructions=greeting_instruction)


# ---------------------------------------------------------------------------
# LiveKit entry point
# ---------------------------------------------------------------------------

def _turn_detection() -> str:
    return "stt" if STT_PROVIDER == "sarvam" else "vad"


def _endpointing_delay() -> float:
    return {"sarvam": 0.07, "whisper": 0.3}.get(STT_PROVIDER, 0.1)


async def entrypoint(ctx: JobContext) -> None:
    logger.info(
        "Fuli online – room: %s | STT=%s | LLM=%s | TTS=%s",
        ctx.room.name, STT_PROVIDER, LLM_PROVIDER, TTS_PROVIDER,
    )

    stt = _build_stt()
    llm = _build_llm()
    tts = _build_tts()

    session = AgentSession(
        turn_detection=_turn_detection(),
        min_endpointing_delay=_endpointing_delay(),
    )

    await session.start(
        agent=FuliAgent(stt=stt, llm=llm, tts=tts),
        room=ctx.room,
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))

def dev():
    """Wrapper to run the agent in dev mode automatically."""
    import sys
    # If no command was provided, inject 'dev'
    if len(sys.argv) == 1:
        sys.argv.append("dev")
    main()

if __name__ == "__main__":
    main()