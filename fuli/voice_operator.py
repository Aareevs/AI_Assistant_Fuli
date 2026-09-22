"""
Fuli Voice Operator (100% Free & Local)
=======================================
Hands-free voice wake-word ("Fuli" / "Hey Fuli") detection and spoken command operator.
- Wake Word & Speech-to-Text: faster-whisper (tiny.en running locally on Apple Silicon, $0 cost)
- Text-to-Speech: Microsoft Edge Neural female voice (en-US-AriaNeural, $0 cost) with macOS Samantha fallback
- Desktop Bridge: Connects directly to Fuli Desktop App (http://127.0.0.1:8765)
"""

import os
import sys
import time
import queue
import re
import subprocess
import urllib.request
import json
import numpy as np
import sounddevice as sd
from dotenv import load_dotenv
from faster_whisper import WhisperModel

load_dotenv()

USER_NAME = os.getenv("USER_NAME", "Aareev")
SAMPLE_RATE = 16000
BLOCK_SIZE = 1024
SILENCE_THRESHOLD = 0.004  # Lowered sensitivity threshold for Mac mics
SILENCE_DURATION = 0.7     # Seconds of silence to conclude utterance

# Expanded phonetic variations of "Fuli" recognized by Whisper
WAKE_WORDS = [
    "fuli", "fully", "hey fuli", "hey fully", 
    "fooly", "foolee", "fulee", "phooli", 
    "foley", "fuji", "furi", "flee", "philip", 
    "philly", "poly", "pulley", "foolish", "fury"
]

audio_queue = queue.Queue()


def speak_female_voice(text: str):
    """Speaks text using free high-quality neural female voice (AriaNeural) or macOS Samantha."""
    if not text or not text.strip():
        return
    clean = text.replace('"', ' ').replace('\n', ' ').strip()
    tmp_path = f"/tmp/fuli_voice_{int(time.time() * 1000)}.mp3"
    try:
        cmd = f'uv run edge-tts --voice en-US-AriaNeural --text "{clean}" --write-media "{tmp_path}" && afplay "{tmp_path}" && rm -f "{tmp_path}"'
        subprocess.run(cmd, shell=True, timeout=10, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        try:
            subprocess.run(f'say -v Samantha "{clean}"', shell=True, timeout=5)
        except Exception:
            pass


def send_to_fuli_app(endpoint: str, payload: dict = None):
    """Sends command or show request to Fuli desktop app."""
    url = f"http://127.0.0.1:8765{endpoint}"
    try:
        data = json.dumps(payload).encode('utf-8') if payload else None
        req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'} if data else {})
        with urllib.request.urlopen(req, timeout=3) as res:
            return res.status == 200
    except Exception:
        # Fallback to macOS open command
        try:
            subprocess.run("open /Applications/Fuli.app", shell=True)
            return True
        except Exception:
            return False


def audio_callback(indata, frames, time_info, status):
    """Collects raw audio chunks from microphone."""
    if status:
        pass
    audio_queue.put(indata.copy())


def clean_wake_word_from_text(text: str) -> str:
    """Removes the wake word prefix from the prompt."""
    cleaned = text
    for w in WAKE_WORDS:
        pattern = rf'^(hey\s+)?{w}[,\s!]*'
        cleaned = re.sub(pattern, '', cleaned, flags=re.IGNORECASE)
    return cleaned.strip()


def run_voice_operator():
    print("\n⚡ Initializing Fuli Free & Local Voice Engine...")
    print("✓ STT: Local faster-whisper (tiny.en on Apple Silicon — $0 cost)")
    print("✓ TTS: Free Neural Female Voice (Aria / Samantha — $0 cost)")
    print(f"✓ Persona: Addressing {USER_NAME}")
    print("✓ Wake words: 'Fuli' or 'Hey Fuli'")
    print("-" * 55)

    # 1. Load Whisper model
    print("Loading local Whisper model...")
    t0 = time.time()
    model = WhisperModel('tiny.en', device='cpu', compute_type='int8')
    print(f"Whisper model ready in {time.time() - t0:.2f}s!")

    input_dev = sd.query_devices(kind='input')
    dev_name = input_dev.get('name', 'Default Microphone')
    print(f"\n🎙️ Microphone: {dev_name}")
    print("Listening for 'Fuli'...")

    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, blocksize=BLOCK_SIZE, callback=audio_callback):
        accumulated_audio = []
        is_speaking = False
        silence_start = None
        zero_count = 0
        warned_mic = False

        while True:
            chunk = audio_queue.get()
            energy = np.linalg.norm(chunk) / np.sqrt(len(chunk))

            if energy == 0.0:
                zero_count += 1
                if zero_count > 60 and not warned_mic:
                    warned_mic = True
                    print("\n⚠️ NOTICE: Microphone input is returning 0.0 (Silence).")
                    print("macOS is blocking microphone access to your terminal.")
                    print("👉 Please open System Settings > Privacy & Security > Microphone")
                    print("👉 Turn ON 'Visual Studio Code' (or 'Terminal') and restart.")
            else:
                zero_count = 0

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
                    # Utterance finished, process speech
                    audio_data = np.concatenate(accumulated_audio, axis=0).flatten().astype(np.float32)
                    accumulated_audio = []
                    is_speaking = False
                    silence_start = None

                    # Transcribe audio with local Whisper
                    segments, _ = model.transcribe(audio_data, language="en", beam_size=1)
                    transcript = " ".join(s.text for s in segments).strip()

                    if not transcript:
                        continue

                    lower_text = transcript.lower()
                    print(f"\n[Heard]: \"{transcript}\"")

                    # Check for wake word
                    is_wake_word = any(re.search(rf'\b{w}\b', lower_text) for w in WAKE_WORDS)

                    if is_wake_word:
                        print("✨ Wake word DETECTED: Opening Fuli...")
                        # 1. Bring up Fuli window on screen
                        send_to_fuli_app("/show")

                        # 2. Check if command was included in the same utterance
                        command = clean_wake_word_from_text(transcript)

                        if command and len(command) > 3:
                            print(f"🚀 Executing spoken command: \"{command}\"")
                            speak_female_voice(f"On it, {USER_NAME}.")
                            send_to_fuli_app("/command", {"prompt": command})
                        else:
                            # User only said "Fuli" -> speak greeting and listen for command
                            speak_female_voice(f"Hey {USER_NAME}, I'm listening.")

                            # Record following command
                            cmd_audio = []
                            cmd_speaking = False
                            cmd_silence = None
                            timeout_start = time.time()

                            while time.time() - timeout_start < 7.0:
                                try:
                                    c_chunk = audio_queue.get(timeout=0.2)
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
                                c_segments, _ = model.transcribe(full_cmd, language="en", beam_size=1)
                                follow_up = " ".join(s.text for s in c_segments).strip()
                                if follow_up:
                                    print(f"🚀 Executing spoken command: \"{follow_up}\"")
                                    send_to_fuli_app("/command", {"prompt": follow_up})
                                else:
                                    speak_female_voice("I didn't catch that.")
                            else:
                                pass

                    print("\n🎙️ Listening for 'Fuli'...")


if __name__ == "__main__":
    try:
        run_voice_operator()
    except KeyboardInterrupt:
        print("\nFuli Voice Operator stopped.")
