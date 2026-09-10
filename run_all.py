"""
Fuli AI Assistant — Unified Launcher
Runs both the FastMCP tools server and the Voice Agent together.
"""

import sys
import os
import subprocess
import time
import signal

def cleanup_port(port=8000):
    """Kills any process currently occupying the port."""
    try:
        cmd = f"lsof -ti :{port}"
        pids = subprocess.check_output(cmd, shell=True).decode().strip().split()
        for pid in pids:
            try:
                os.kill(int(pid), signal.SIGKILL)
                print(f"[Launcher] Cleared stale process on port {port} (PID: {pid})")
            except Exception:
                pass
    except Exception:
        pass

def main():
    print("=" * 60)
    print("  🚀 Starting Fuli AI Assistant (Server + Voice Agent) ")
    print("=" * 60)

    # 1. Clear any stuck server processes on port 8000
    cleanup_port(8000)

    # 2. Start MCP server
    server_process = subprocess.Popen(
        [sys.executable, "server.py"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    print("[Launcher] Starting MCP Tools Server on :8000...")
    time.sleep(2)

    # 3. Start Voice Agent
    print("[Launcher] Starting LiveKit Voice Agent...")
    print("[Launcher] Press Ctrl+C at any time to stop both.\n")
    agent_cmd = [sys.executable, "agent_fuli.py", "dev"]
    if len(sys.argv) > 1 and sys.argv[1] == "console":
        agent_cmd = [sys.executable, "agent_fuli.py", "console"]

    try:
        agent_process = subprocess.Popen(agent_cmd)
        agent_process.wait()
    except KeyboardInterrupt:
        print("\n[Launcher] Shutting down Fuli...")
    finally:
        try:
            agent_process.terminate()
        except Exception:
            pass
        try:
            server_process.terminate()
        except Exception:
            pass
        cleanup_port(8000)
        print("[Launcher] Shutdown complete.")

if __name__ == "__main__":
    main()
