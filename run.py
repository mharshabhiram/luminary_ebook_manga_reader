#!/usr/bin/env python3
"""
Luminary Reader — Launcher
Checks dependencies, then starts the Flask app and opens the browser.
"""

import sys
import subprocess

REQUIRED = {
    "flask":       "Flask",
    "pypdfium2":   "pypdfium2",
    "PIL":         "Pillow",
    "bs4":         "beautifulsoup4",
    "lxml":        "lxml",
}

def check_deps():
    missing = []
    for mod, pkg in REQUIRED.items():
        try:
            __import__(mod)
        except ImportError:
            missing.append(pkg)
    if missing:
        print(f"Installing missing packages: {', '.join(missing)}")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "--break-system-packages", *missing])
    print("✓ All dependencies satisfied")

if __name__ == "__main__":
    check_deps()
    import threading, webbrowser, time, os

    # Optionally open browser after a short delay
    def open_browser():
        time.sleep(1.2)
        webbrowser.open("http://localhost:5000")

    threading.Thread(target=open_browser, daemon=True).start()

    # Change to app dir and run
    os.chdir(os.path.dirname(__file__))
    from app import app
    print("\n✦ Luminary Reader")
    print("  → http://localhost:5000")
    print("  Press Ctrl+C to quit\n")
    app.run(debug=False, port=5000, host="0.0.0.0")
