import os
import sys
import subprocess
import cmd
import time
import socket
import json
import urllib.request
from pathlib import Path

if os.name == 'nt':
    os.system('color')

# Autodetect paths relatively
SCRIPT_DIR = Path(__file__).resolve().parent
CODEX_DIR = SCRIPT_DIR.parent
SHAN_LAB = CODEX_DIR.parent.parent.parent / "shan_lab"

HERMES_DIR = SHAN_LAB / "hermes_home" / "hermes-agent"
HAVOC_DIR = SHAN_LAB / "hackerai" / "havoc-bridge"
MCP_DIR = SHAN_LAB / "mcp_bridge"
ORCH_DIR = CODEX_DIR.parent / "context-orchestrator"

C_RED = '\033[91m'
C_GREEN = '\033[92m'
C_YELLOW = '\033[93m'
C_BLUE = '\033[94m'
C_MAGENTA = '\033[95m'
C_CYAN = '\033[96m'
C_RESET = '\033[0m'
C_BOLD = '\033[1m'

services = {
    'context_integrator': {'cwd': '.', 'cmd': ['python', str(MCP_DIR / 'context_integrator.py'), '--daemon'], 'port': 9800, 'proc': None},
    'enclave_bridge': {'cwd': '.', 'cmd': ['python', str(SHAN_LAB / 'hackerai' / 'enclave_bridge.py'), '--daemon'], 'port': 9900, 'proc': None},
    'dashboard': {'cwd': '.', 'cmd': ['python', str(MCP_DIR / 'dashboard.py'), '--port', '5000'], 'port': 5000, 'proc': None},
    'havoc_bridge': {'cwd': str(HAVOC_DIR), 'cmd': ['python', str(HAVOC_DIR / 'havoc_bridge.py')], 'port': 40056, 'proc': None},
    'omni_gui': {'cwd': str(CODEX_DIR), 'cmd': ['cmd.exe', '/c', 'npm', 'run', 'dev:gui'], 'port': 3017, 'proc': None},
    'context_orchestrator': {'cwd': str(ORCH_DIR), 'cmd': ['cmd.exe', '/c', 'npm', 'run', 'dev'], 'port': 3000, 'proc': None}
}

ENDPOINTS = {
    "shannon": {"url": "https://api.shannon-ai.com/v1/chat/completions", "key": "sk-VWBrt2s7FJb5jB1AU-2gPnqlLCuwgZRyXZmUWdB1zKs", "model": "shannon-1.6-pro"},
    "ollama": {"url": "http://127.0.0.1:11434/api/chat", "key": "", "model": "llama3"},
    "hermes": {"url": "http://127.0.0.1:9090/v1/chat/completions", "key": "", "model": "hermes-agent"}
}

def check_port(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0

class OmniChat(cmd.Cmd):
    prompt = f"{C_MAGENTA}OmniChat>{C_RESET} "
    def __init__(self, endpoint="shannon"):
        super().__init__()
        self.endpoint = endpoint
        self.history = [{"role": "system", "content": "You are Omni, integrating Shannon, Hermes, and native PC tools."}]
        print(f"{C_GREEN}Entered OmniChat targeting '{endpoint}'. Type 'switch <name>' to change endpoint, or 'exit' to return.{C_RESET}")

    def do_exit(self, arg):
        """Return to main supervisor."""
        return True
    
    def do_switch(self, arg):
        """Switch endpoint (e.g. switch ollama)"""
        arg = arg.strip()
        if arg in ENDPOINTS:
            self.endpoint = arg
            print(f"{C_GREEN}Switched to {arg}{C_RESET}")
        else:
            print(f"{C_RED}Unknown endpoint. Available: {', '.join(ENDPOINTS.keys())}{C_RESET}")

    def default(self, line):
        if line == 'EOF':
            return True
        self.history.append({"role": "user", "content": line})
        cfg = ENDPOINTS[self.endpoint]
        
        req_data = {}
        headers = {'Content-Type': 'application/json'}
        if cfg['key']:
            headers['Authorization'] = f"Bearer {cfg['key']}"
            
        if self.endpoint == "ollama":
            req_data = {"model": cfg["model"], "messages": self.history, "stream": False}
        else:
            req_data = {"model": cfg["model"], "messages": self.history}
            
        try:
            req = urllib.request.Request(cfg['url'], data=json.dumps(req_data).encode('utf-8'), headers=headers, method='POST')
            with urllib.request.urlopen(req) as response:
                res = json.loads(response.read().decode('utf-8'))
                if self.endpoint == "ollama":
                    reply = res["message"]["content"]
                else:
                    reply = res["choices"][0]["message"]["content"]
                print(f"\n{C_CYAN}[{self.endpoint.upper()}]{C_RESET} {reply}\n")
                self.history.append({"role": "assistant", "content": reply})
        except urllib.error.URLError as e:
            if hasattr(e, 'code') and e.code == 404:
                print(f"{C_RED}Endpoint not found. Make sure {self.endpoint} is running on your PC.{C_RESET}")
            else:
                print(f"{C_RED}API Connection Error: {e}{C_RESET}")
        except Exception as e:
            print(f"{C_RED}API Error: {e}{C_RESET}")

class OmniCLI(cmd.Cmd):
    intro = f"""
{C_BOLD}{C_MAGENTA}
    ██████╗ ███╗   ███╗███╗   ██╗██╗
   ██╔═══██╗████╗ ████║████╗  ██║██║
   ██║   ██║██╔████╔██║██╔██╗ ██║██║
   ██║   ██║██║╚██╔╝██║██║╚██╗██║██║
   ╚██████╔╝██║ ╚═╝ ██║██║ ╚████║██║
    ╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═══╝╚═╝
{C_RESET}
{C_CYAN}Advanced Supervisor CLI for ShanLab, Hermes, Havoc & Codex Orch{C_RESET}
Type {C_YELLOW}help{C_RESET} or {C_YELLOW}?{C_RESET} to list commands.
"""
    prompt = f"{C_BOLD}{C_CYAN}Omni>{C_RESET} "

    def do_status(self, arg):
        """Check status of all background services."""
        print(f"\n{C_BOLD}--- System Status ---{C_RESET}")
        for name, info in services.items():
            state = f"{C_GREEN}RUNNING{C_RESET}" if check_port(info['port']) else f"{C_RED}STOPPED{C_RESET}"
            print(f"[{info['port']}] {name.ljust(20)} : {state}")
        print()

    def do_mcp(self, arg):
        """List registered MCP servers across workspaces."""
        print(f"\n{C_BOLD}--- MCP Servers Built In ---{C_RESET}")
        cfg = CODEX_DIR / "mcp-settings.json"
        if cfg.exists():
            try:
                data = json.loads(cfg.read_text())
                servers = data.get('mcpServers', {})
                for s, d in servers.items():
                    print(f"[{C_GREEN}v{C_RESET}] {C_CYAN}{s}{C_RESET}: {' '.join(d.get('cmd', []))} {' '.join(d.get('args', []))}")
                if not servers:
                    print(f"{C_YELLOW}No MCP Servers inside {cfg.name}{C_RESET}")
            except Exception as e:
                print(f"{C_RED}Failed to read mcp-settings: {e}{C_RESET}")
        else:
            print(f"{C_YELLOW}No mcp-settings.json found in {CODEX_DIR}.{C_RESET}")
            
        print(f"\n{C_BOLD}--- You can also add more endpoints dynamically via the Config files. ---{C_RESET}")
        print()

    def do_start(self, arg):
        """Start a service or 'all'. Usage: start <name|all>"""
        if arg == 'all':
            for name in services: self._start_service(name)
        elif arg in services:
            self._start_service(arg)
        else:
            print(f"{C_RED}Unknown service: {arg}{C_RESET}. Available: {', '.join(services.keys())}")

    def _start_service(self, name):
        svc = services[name]
        if check_port(svc['port']):
            print(f"{C_YELLOW}Service {name} is already running on port {svc['port']}.{C_RESET}")
            return
        print(f"Starting {name}...")
        proc = subprocess.Popen(svc['cmd'], cwd=svc['cwd'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
        svc['proc'] = proc
        time.sleep(2)
        if check_port(svc['port']): print(f"{C_GREEN}Started {name} successfully.{C_RESET}")
        else: print(f"{C_RED}Failed to start {name} or taking too long. Check the dashboard.{C_RESET}")

    def do_stop(self, arg):
        """Stop a service or 'all'. Usage: stop <name|all>"""
        if arg == 'all':
            for name in list(services.keys()): self._stop_service(name)
        elif arg in services:
            self._stop_service(arg)
        else:
            print(f"{C_RED}Unknown service: {arg}{C_RESET}")

    def _stop_service(self, name):
        svc = services[name]
        port = svc['port']
        print(f"Stopping {name} on port {port}...")
        try:
            output = subprocess.check_output(f'netstat -ano | findstr ":{port} "', shell=True).decode()
            for line in output.strip().split('\n'):
                parts = line.strip().split()
                if len(parts) >= 5 and parts[-1] != '0':
                    subprocess.call(f'taskkill /f /pid {parts[-1]}', shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except: pass
        if svc['proc']:
            try: svc['proc'].kill()
            except: pass
            svc['proc'] = None
        print(f"{C_GREEN}Stopped {name}.{C_RESET}")

    def do_shannon(self, arg):
        """Drop into the interactive Shannon-Omega strict CLI."""
        subprocess.call([sys.executable, str(MCP_DIR / 'shannon-cli.py'), '--shell'], cwd=str(SHAN_LAB))

    def do_hermes(self, arg):
        """Drop into the interactive Hermes Agent CLI."""
        cli = str(HERMES_DIR / 'cli.py')
        uv = str(SHAN_LAB / "hermes_home" / "bin" / "uv.exe")
        if os.path.exists(uv): subprocess.call([uv, "run", "python", cli], cwd=str(HERMES_DIR))
        else: subprocess.call([sys.executable, cli], cwd=str(HERMES_DIR))
            
    def do_chat(self, arg):
        """Start the unified OmniChat prompt spanning any endpoint (Ollama, Shannon, Hermes, Custom)."""
        OmniChat().cmdloop()

    def do_havoc(self, arg):
        """Interact with the Havoc C2 framework components."""
        if check_port(40056): print(f"{C_GREEN}Havoc bridge is running on port 40056. Use client UI.{C_RESET}")
        else: print(f"{C_YELLOW}Havoc bridge is not running. Type 'start havoc_bridge'.{C_RESET}")

    def do_exit(self, arg):
        """Exit the Omni Supervisor."""
        print("Omni Shutdown Sequence Initiated...")
        return True

    def do_EOF(self, arg):
        print()
        return True

    def do_quit(self, arg):
        return self.do_exit(arg)

if __name__ == '__main__':
    try:
        OmniCLI().cmdloop()
    except KeyboardInterrupt:
        print("\nExiting...")
        sys.exit(0)