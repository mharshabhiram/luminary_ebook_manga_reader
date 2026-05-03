# ✦ Luminary Reader

A beautiful, feature-rich local reader for **PDF**, **EPUB**, **CBZ**, and **CBR** files — with a stunning web UI served by Flask.

---

## Features

| Feature | Details |
|---------|---------|
| 📄 **PDF Reader** | Page-by-page rendering via pypdfium2, zoom, keyboard nav |
| 📖 **EPUB Reader** | Chapter navigation, embedded images, TOC panel, clean typography |
| 📚 **Manga Reader** | CBZ/CBR support, two-page spread, LTR/RTL direction |
| 🎨 **6 Themes** | Dark · Light · Sepia · Forest · Midnight · Rose |
| 🔆 **Brightness Control** | Overlay-based, works across all themes |
| 📊 **Progress Tracking** | Per-book progress, % completion shown in library |
| 🗂 **Library** | Persistent JSON library, cover thumbnails, search & filter |
| ⌨️ **Keyboard Shortcuts** | Arrow keys, Space, +/−/0 for zoom, Escape to go back |
| 📱 **Touch Swipe** | Swipe left/right to turn pages on touch devices |

---

## Quick Start

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Run

```bash
python run.py
```

The app opens automatically at **http://localhost:5000**

Or run directly:
```bash
python app.py
```

---

## Adding Books

**Method 1 — Path input (recommended):**
- Click **Add Book** → paste the full file path → press Enter

**Method 2 — Drag & Drop:**
- Open the Add Book modal → drag files onto the drop zone
- *(Note: file paths via drag-drop work best in Electron/desktop wrappers)*

**Supported formats:** `.pdf` · `.epub` · `.cbz` · `.cbr`

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `→` / `Space` | Next page / chapter |
| `←` | Previous page / chapter |
| `+` / `=` | Zoom in |
| `-` | Zoom out |
| `0` | Reset zoom |
| `Escape` | Back to library / close TOC |

---

## Project Structure

```
reader_app/
├── app.py              ← Flask backend (PDF/EPUB/Manga rendering APIs)
├── run.py              ← Launcher with auto-browser open
├── requirements.txt    ← Python dependencies
├── library/
│   └── library.json    ← Your persistent library (auto-created)
├── templates/
│   └── index.html      ← Main UI template
└── static/
    ├── css/
    │   └── main.css    ← All themes + component styles
    └── js/
        └── app.js      ← Full client-side application logic
```

---

## Themes

Switch between themes using the emoji buttons in the sidebar:

- 🌙 **Dark** — Deep charcoal with golden accents
- ☀️ **Light** — Warm parchment tones
- 📜 **Sepia** — Classic book aesthetic
- 🌿 **Forest** — Deep green nature vibes
- 🌌 **Midnight** — Deep blue cosmic feel
- 🌸 **Rose** — Elegant dark rose

---

## CBR Support

For CBR (RAR archives), install `rarfile` and ensure `unrar` is on your PATH:

```bash
pip install rarfile
# Ubuntu/Debian:
sudo apt install unrar
# macOS:
brew install unrar
```

CBZ files (ZIP-based) work out of the box.

---

## Tech Stack

- **Backend:** Python + Flask
- **PDF:** pypdfium2 (fast native rendering)
- **EPUB:** Built-in zipfile + BeautifulSoup4 (no external deps)
- **Manga:** zipfile (CBZ) + rarfile (CBR)
- **Images:** Pillow
- **Frontend:** Vanilla JS + CSS custom properties (zero framework)
- **Fonts:** Playfair Display + DM Sans + JetBrains Mono (Google Fonts)
