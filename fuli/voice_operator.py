"""
Fuli Voice Operator (100% Free & Local)
=======================================
Ultra-responsive voice wake-word ("Fuli" / "Hey Fuli") detection and spoken command operator.
- Wake Word & Speech-to-Text: faster-whisper (tiny.en running locally on Apple Silicon, cpu_threads=4, $0 cost)
- Text-to-Speech: Microsoft Edge Neural female voice (en-US-AriaNeural, $0 cost) with macOS Samantha fallback
- Tactile Feedback: Instant native 50ms chime (Tink.aiff) on wake-up — ZERO mic blocking or audio truncation
- Desktop Bridge: Connects directly to Fuli Desktop App (http://127.0.0.1:8765)
- Control Server: Listens on http://127.0.0.1:8766 for in-app UI trigger events
"""

import os
import sys
import time
import queue
import re
import threading
import subprocess
import urllib.request
import json
from http.server import HTTPServer, BaseHTTPRequestHandler
import numpy as np
import sounddevice as sd
from dotenv import load_dotenv
from faster_whisper import WhisperModel

load_dotenv()

USER_NAME = os.getenv("USER_NAME", "Aareev")
SAMPLE_RATE = 16000
BLOCK_SIZE = 1024
SILENCE_THRESHOLD = 0.0038  # MacBook Air microphone sensitivity
SILENCE_DURATION = 0.65     # 650ms natural conversational pause (prevents cutting sentences in half)

# Expanded phonetic variations of "Fuli" recognized by Whisper
WAKE_WORDS = [
    "fuli", "fully", "hey fuli", "hey fully", 
    "fooly", "foolee", "fulee", "phooli", 
    "foley", "fuji", "furi", "flee", "philip", 
    "philly", "poly", "pulley", "foolish", "fury"
]

audio_queue = queue.Queue()
is_speaking_out_loud = False
external_listen_requested = threading.Event()


def play_chime():
    """Plays an instant 50ms native macOS system chime. Does NOT block mic or drop audio frames."""
    try:
        subprocess.Popen(['afplay', '/System/Library/Sounds/Tink.aiff'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass


def speak_female_voice(text: str):
    """Speaks text using free high-quality neural female voice (AriaNeural) or macOS Samantha.
    Used for action completions.
    """
    global is_speaking_out_loud
    if not text or not text.strip():
        return
    clean = text.replace('"', ' ').replace('\n', ' ').strip()
    tmp_path = f"/tmp/fuli_voice_{int(time.time() * 1000)}.mp3"
    
    is_speaking_out_loud = True
    try:
        cmd = f'uv run edge-tts --voice en-US-AriaNeural --text "{clean}" --write-media "{tmp_path}" && afplay "{tmp_path}" && rm -f "{tmp_path}"'
        subprocess.run(cmd, shell=True, timeout=10, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        try:
            subprocess.run(f'say -v Samantha "{clean}"', shell=True, timeout=5)
        except Exception:
            pass
    finally:
        time.sleep(0.2)
        while not audio_queue.empty():
            try:
                audio_queue.get_nowait()
            except queue.Empty:
                break
        is_speaking_out_loud = False


def send_to_fuli_app(endpoint: str, payload: dict | None = None):
    """Sends command or show request to Fuli desktop app."""
    url = f"http://127.0.0.1:8765{endpoint}"
    try:
        data = json.dumps(payload).encode('utf-8') if payload else None
        req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'} if data else {})
        with urllib.request.urlopen(req, timeout=3) as res:
            return res.status == 200
    except Exception:
        try:
            subprocess.run("open /Applications/Fuli.app", shell=True)
            return True
        except Exception:
            return False


def audio_callback(indata, frames, time_info, status):
    """Collects raw audio chunks from microphone, ignoring audio while Fuli speaks out loud."""
    if is_speaking_out_loud:
        return
    audio_queue.put(indata.copy())


def clean_voice_prompt(text: str) -> str:
    """Cleans wake words, polite fillers, and self-echo leakage from prompt."""
    cleaned = text
    # Clean leaks of Fuli's own responses or hallucinations
    cleaned = re.sub(r"hey,?\s*i'm\s*listening[.!?,]*", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"i'm\s*listening[.!?,]*", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"hey\s+aareev[.!?,]*", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"i've\s*taken\s*you\s*to.*?[.!?,]", " ", cleaned, flags=re.IGNORECASE)
    
    # Remove all wake-word variations
    for w in WAKE_WORDS:
        cleaned = re.sub(rf'\b{w}\b[,\s!]*', ' ', cleaned, flags=re.IGNORECASE)
    
    # Remove conversational filler prefix
    cleaned = re.sub(r'^(hey|yo|hi|hello|ok|okay)[,\s!]+', '', cleaned.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r'^(can you|could you|please)\s+', '', cleaned.strip(), flags=re.IGNORECASE)
    
    # Clean multiple spaces
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned


def is_standalone_wake_word(text: str) -> bool:
    """Checks if the utterance is just the wake word without a real multi-word command."""
    cleaned = clean_voice_prompt(text)
    if not cleaned or len(cleaned) < 3:
        return True
    words = [w for w in re.findall(r'\b\w+\b', cleaned.lower()) if w not in ['a', 'an', 'the', 'it', 'yes', 'yeah', 'now', 'go', 'ahead', 'hey', 'hi', 'ok', 'okay']]
    return len(words) == 0


class VoiceControlHandler(BaseHTTPRequestHandler):
    """Local HTTP control server on port 8766 for UI interaction."""
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        if self.path == '/listen':
            external_listen_requested.set()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"listening": true}')
        elif self.path == '/reset':
            while not audio_queue.empty():
                try:
                    audio_queue.get_nowait()
                except queue.Empty:
                    break
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"reset": true}')
        else:
            self.send_response(404)
            self.end_headers()


def start_control_server():
    try:
        server = HTTPServer(('127.0.0.1', 8766), VoiceControlHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        print("✓ Voice Control Server running on http://127.0.0.1:8766")
    except Exception as e:
        print(f"Control server notice: {e}")


def capture_next_utterance(model, max_wait=7.0):
    """Records the next speech utterance from the microphone and returns the transcript."""
    cmd_audio = []
    cmd_speaking = False
    cmd_silence = None
    timeout_start = time.time()

    while time.time() - timeout_start < max_wait:
        try:
            c_chunk = audio_queue.get(timeout=0.08)
        except queue.Empty:
            continue
        c_energy = np.linalg.norm(c_chunk) / np.sqrt(len(c_chunk))
        if c_energy > SILENCE_THRESHOLD:
            cmd_speaking = True
            cmd_silence = None
            cmd_audio.append(c_chunk)
        elif cmd_speaking:
            cmd_audio.append(c_chunk)
            if cmd_silence is None:
                cmd_silence = time.time()
            elif time.time() - cmd_silence > SILENCE_DURATION:
                break

    if cmd_audio:
        full_cmd = np.concatenate(cmd_audio, axis=0).flatten().astype(np.float32)
        c_segments, _ = model.transcribe(full_cmd, language="en", beam_size=1, condition_on_previous_text=False)
        return " ".join(s.text for s in c_segments).strip()
    return ""


def run_voice_operator():
    print("\n⚡ Initializing Fuli Free & Local Voice Engine...")
    print("✓ STT: Local faster-whisper (tiny.en, Apple Silicon 4-threads — $0 cost)")
    print("✓ Feedback: Instant 50ms System Chime (Zero speech drop)")
    print("✓ Persona: Addressing {USER_NAME}")
    print("✓ Wake words: 'Fuli' or 'Hey Fuli'")
    print("-" * 55)

    start_control_server()

    # 1. Load Whisper model with 4 threads for ultra-fast 0.3s inference on Apple Silicon
    print("Loading local Whisper model...")
    t0 = time.time()
    model = WhisperModel('tiny.en', device='cpu', compute_type='int8', cpu_threads=4)
    print(f"Whisper model ready in {time.time() - t0:.2f}s!")

    input_dev = sd.query_devices(kind='input')
    dev_name = input_dev.get('name', 'Default Microphone')
    print(f"\n🎙️ Microphone: {dev_name}")
    print("Listening for 'Fuli'...")

    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, blocksize=BLOCK_SIZE, callback=audio_callback):
        accumulated_audio = []
        is_speaking = False
        silence_start = None

        while True:
            # Handle UI microphone button click
            if external_listen_requested.is_set():
                external_listen_requested.clear()
                play_chime()
                print("\n🎙️ [UI Mic Clicked] Listening for command...")
                send_to_fuli_app("/status", {"status": "🎙️ Listening... Speak your command to Fuli"})
                raw = capture_next_utterance(model, max_wait=8.0)
                command = clean_voice_prompt(raw)
                if command and len(command) > 2:
                    print(f"🚀 Executing spoken command: \"{command}\"")
                    send_to_fuli_app("/command", {"prompt": command})
                else:
                    send_to_fuli_app("/status", {"status": "Fuli is ready"})
                continue

            try:
                chunk = audio_queue.get(timeout=0.05)
            except queue.Empty:
                continue

            energy = np.linalg.norm(chunk) / np.sqrt(len(chunk))

            if energy > SILENCE_THRESHOLD:
                if not is_speaking:
                    print("• [Detecting speech...]", end="\r", flush=True)
                is_speaking = True
                silence_start = None
                accumulated_audio.append(chunk)
            elif is_speaking:
                accumulated_audio.append(chunk)
                if silence_start is None:
                    silence_start = time.time()
                elif time.time() - silence_start > SILENCE_DURATION:
                    # Utterance finished cleanly
                    audio_data = np.concatenate(accumulated_audio, axis=0).flatten().astype(np.float32)
                    accumulated_audio = []
                    is_speaking = False
                    silence_start = None

                    # Transcribe audio with local Whisper (fast 0.3s inference)
                    segments, _ = model.transcribe(audio_data, language="en", beam_size=1, condition_on_previous_text=False)
                    transcript = " ".join(s.text for s in segments).strip()

                    if not transcript:
                        continue

                    lower_text = transcript.lower()
                    print(f"\n[Heard]: \"{transcript}\"")

                    # Check for wake word
                    is_wake_word = any(re.search(rf'\b{w}\b', lower_text) for w in WAKE_WORDS)

                    if is_wake_word:
                        print("✨ Wake word DETECTED: Opening Fuli...")
                        # 1. Bring up Fuli window on screen immediately
                        send_to_fuli_app("/show")
                        # 2. Play instant 50ms tactile chime (NO microphone blocking!)
                        play_chime()

                        # 3. Check if the user said the command in the SAME continuous breath
                        if not is_standalone_wake_word(transcript):
                            # The user spoke "Fuli, open ChatGPT and send hello"
                            command = clean_voice_prompt(transcript)
                            if command and len(command) > 2:
                                print(f"🚀 Executing unified spoken command: \"{command}\"")
                                send_to_fuli_app("/command", {"prompt": command})
                        else:
                            # User only said "Fuli" and paused -> listen for follow-up command
                            print("✓ User summoned Fuli. Prompt bar opened. Listening for command...")
                            send_to_fuli_app("/status", {"status": "🎙️ Listening for your command..."})
                            
                            follow_up_raw = capture_next_utterance(model, max_wait=7.0)
                            follow_up = clean_voice_prompt(follow_up_raw)

                            if follow_up and len(follow_up) > 2 and not is_standalone_wake_word(follow_up):
                                print(f"🚀 Executing follow-up command: \"{follow_up}\"")
                                send_to_fuli_app("/command", {"prompt": follow_up})
                            else:
                                send_to_fuli_app("/status", {"status": "Fuli is ready"})

                    print("\n🎙️ Listening for 'Fuli'...")


if __name__ == "__main__":
    try:
        run_voice_operator()
    except KeyboardInterrupt:
        print("\nFuli Voice Operator stopped.")
