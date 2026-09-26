"""
Fuli Voice Operator (100% Free & Local)
=======================================
Ultra-fast real-time sliding-window wake-word ("Fuli" / "Hey Fuli") detection and spoken command operator.
- Wake Word & Speech-to-Text: faster-whisper (tiny.en running locally on Apple Silicon, cpu_threads=4, $0 cost)
- Latency: ~250ms sliding-window detection — opens immediately when "Fuli" is spoken!
- Tactile Feedback: Instant native 50ms chime (Tink.aiff) on wake-up — ZERO mic blocking
- Desktop Bridge: Connects directly to Fuli Desktop App (http://127.0.0.1:8765)
- Control Server: Listens on http://127.0.0.1:8766 for in-app UI trigger events
"""

import os
import sys
import time
import tempfile
import queue
import collections
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
SILENCE_THRESHOLD = 0.0035  # Microphone sensitivity threshold
SILENCE_DURATION = 0.55     # 550ms natural conversational pause for command completion

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
    """Plays an instant native system chime. Does NOT block mic or drop audio frames."""
    try:
        if sys.platform == 'win32':
            import winsound
            winsound.MessageBeep(winsound.MB_ICONASTERISK)
        else:
            subprocess.Popen(['afplay', '/System/Library/Sounds/Tink.aiff'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass


def speak_female_voice(text: str):
    """Speaks text using free high-quality neural female voice (AriaNeural) or native system TTS."""
    global is_speaking_out_loud
    if not text or not text.strip():
        return
    clean = text.replace('"', ' ').replace('\n', ' ').strip()
    tmp_path = os.path.join(tempfile.gettempdir(), f"fuli_voice_{int(time.time() * 1000)}.mp3")
    
    is_speaking_out_loud = True
    try:
        if sys.platform == 'win32':
            subprocess.run(f'uv run edge-tts --voice en-US-AriaNeural --text "{clean}" --write-media "{tmp_path}"', shell=True, timeout=10, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if os.path.exists(tmp_path):
                escaped_path = tmp_path.replace('\\', '\\\\')
                ps_cmd = f"powershell -NoProfile -Command \"Add-Type -AssemblyName presentationCore; $p = New-Object system.windows.media.mediaplayer; $p.open('{escaped_path}'); $p.Play(); Start-Sleep -Seconds 1; while($p.Position -lt $p.NaturalDuration.TimeSpan){{ Start-Sleep -Milliseconds 100 }}\""
                subprocess.run(ps_cmd, shell=True, timeout=15, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass
        else:
            cmd = f'uv run edge-tts --voice en-US-AriaNeural --text "{clean}" --write-media "{tmp_path}" && afplay "{tmp_path}" && rm -f "{tmp_path}"'
            subprocess.run(cmd, shell=True, timeout=10, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        try:
            if sys.platform == 'win32':
                escaped_text = clean.replace("'", "''")
                ps_speech = f"powershell -NoProfile -Command \"Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('{escaped_text}')\""
                subprocess.run(ps_speech, shell=True, timeout=6, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
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
            if sys.platform == 'win32':
                subprocess.run('start "" "Fuli.exe"', shell=True)
            else:
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
            c_chunk = audio_queue.get(timeout=0.06)
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
    print("✓ Real-Time Streaming: ~250ms sliding-window wake-word detection")
    print("✓ Feedback: Instant 50ms System Chime (Zero speech drop)")
    print(f"✓ Persona: Addressing {USER_NAME}")
    print("✓ Wake words: 'Fuli' or 'Hey Fuli'")
    print("-" * 55)

    start_control_server()

    # 1. Load Whisper model with 4 threads for ultra-fast 0.2s inference on Apple Silicon
    print("Loading local Whisper model...")
    t0 = time.time()
    model = WhisperModel('tiny.en', device='cpu', compute_type='int8', cpu_threads=4)
    print(f"Whisper model ready in {time.time() - t0:.2f}s!")

    input_dev = sd.query_devices(kind='input')
    dev_name = input_dev.get('name', 'Default Microphone')
    print(f"\n🎙️ Microphone: {dev_name}")
    print("Listening for 'Fuli'...")

    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, blocksize=BLOCK_SIZE, callback=audio_callback):
        # Rolling ring buffer of the last ~1.15 seconds of audio (18 chunks of 1024 samples)
        ring_buffer = collections.deque(maxlen=18)
        check_counter = 0

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

            ring_buffer.append(chunk)
            energy = np.linalg.norm(chunk) / np.sqrt(len(chunk))

            # Only evaluate when there is active speech energy
            if energy > SILENCE_THRESHOLD and len(ring_buffer) >= 8:
                check_counter += 1

                # Check sliding window every 3 chunks (~190ms)
                if check_counter % 3 == 0:
                    audio_data = np.concatenate(list(ring_buffer), axis=0).flatten().astype(np.float32)
                    segments, _ = model.transcribe(audio_data, language="en", beam_size=1, condition_on_previous_text=False)
                    short_transcript = " ".join(s.text for s in segments).strip().lower()

                    if any(re.search(rf'\b{w}\b', short_transcript) for w in WAKE_WORDS):
                        # WAKE WORD DETECTED IN REAL TIME (~250ms)!
                        print(f"\n✨ Wake word DETECTED in real-time ({short_transcript})! Opening Fuli...")
                        # 1. Open Fuli window immediately on screen
                        send_to_fuli_app("/show")
                        # 2. Instant 50ms chime
                        play_chime()
                        send_to_fuli_app("/status", {"status": "🎙️ Listening for your command..."})

                        # Clear ring buffer to prevent duplicate triggers
                        ring_buffer.clear()
                        check_counter = 0

                        # Capture the user's command immediately without missing a single syllable
                        cmd_raw = capture_next_utterance(model, max_wait=7.0)
                        cleaned_cmd = clean_voice_prompt(cmd_raw)

                        if cleaned_cmd and len(cleaned_cmd) > 2 and not is_standalone_wake_word(cleaned_cmd):
                            print(f"🚀 Executing spoken command: \"{cleaned_cmd}\"")
                            send_to_fuli_app("/command", {"prompt": cleaned_cmd})
                        else:
                            send_to_fuli_app("/status", {"status": "Fuli is ready"})

                        print("\n🎙️ Listening for 'Fuli'...")


if __name__ == "__main__":
    try:
        run_voice_operator()
    except KeyboardInterrupt:
        print("\nFuli Voice Operator stopped.")
