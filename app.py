"""
Luminary Reader — PDF, EPUB, CBZ/CBR all-in-one reader
Flask backend powering a rich browser-based UI
"""

import os, json, zipfile, re, io, base64, hashlib, struct, threading
from pathlib import Path
from flask import Flask, render_template, jsonify, request, send_file, abort
from PIL import Image
import pypdfium2 as pdfium
from bs4 import BeautifulSoup

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB

# ── Paths ────────────────────────────────────────────────────────────────────
BASE_DIR   = Path(__file__).parent
LIBRARY_DB = BASE_DIR / "library" / "library.json"
LIBRARY_DB.parent.mkdir(exist_ok=True)
UPLOADS_DIR = BASE_DIR / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)

# ── Library persistence ──────────────────────────────────────────────────────
_lock = threading.Lock()

def load_library():
    if LIBRARY_DB.exists():
        with open(LIBRARY_DB) as f:
            return json.load(f)
    return {}

def save_library(lib):
    with _lock:
        with open(LIBRARY_DB, "w") as f:
            json.dump(lib, f, indent=2)

def book_id(path: str) -> str:
    return hashlib.md5(path.encode()).hexdigest()[:12]

def detect_type(path: str) -> str:
    ext = Path(path).suffix.lower()
    if ext == ".pdf":   return "pdf"
    if ext == ".epub":  return "epub"
    if ext in (".cbz",".cbr",".zip"): return "manga"
    return "unknown"

# ── Routes ───────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")

# ─── Library API ─────────────────────────────────────────────────────────────

@app.route("/api/library")
def api_library():
    lib = load_library()
    # Attach live existence check
    items = []
    for bid, book in lib.items():
        book["id"] = bid
        book["exists"] = Path(book["path"]).exists()
        items.append(book)
    items.sort(key=lambda x: x.get("added", 0), reverse=True)
    return jsonify(items)

@app.route("/api/library/add", methods=["POST"])
def api_add():
    data = request.json
    raw  = data.get("path", "").strip().strip('"').strip("'")  # strip accidental quotes
    if not raw:
        return jsonify({"error": "No path provided"}), 400

    # Normalise path separators and expand ~
    path = str(Path(raw).expanduser().resolve())

    if not Path(path).exists():
        return jsonify({
            "error": f"File not found: {path}",
            "tip":   "Make sure the path is absolute and the file exists on this machine."
        }), 404
    if not Path(path).is_file():
        return jsonify({"error": f"Not a file: {path}"}), 400

    bid   = book_id(path)
    btype = detect_type(path)
    if btype == "unknown":
        exts = Path(path).suffix.lower()
        return jsonify({"error": f"Unsupported format '{exts}'. Supported: .pdf .epub .cbz .cbr"}), 400

    lib   = load_library()
    if bid not in lib:
        # Try to get page/chapter count
        total = _get_total_pages(path, btype)
        lib[bid] = {
            "path":     path,
            "title":    Path(path).stem,
            "type":     btype,
            "total":    total,
            "progress": 0,
            "added":    __import__("time").time(),
            "cover":    None,
        }
    save_library(lib)
    return jsonify({"id": bid, **lib[bid]})

@app.route("/api/library/remove/<bid>", methods=["DELETE"])
def api_remove(bid):
    lib = load_library()
    lib.pop(bid, None)
    save_library(lib)
    return jsonify({"ok": True})

@app.route("/api/library/upload", methods=["POST"])
def api_upload():
    """Accept an actual uploaded file, save it to uploads/, then add to library."""
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    f = request.files['file']
    if not f.filename:
        return jsonify({"error": "No filename"}), 400

    filename = Path(f.filename).name  # strip any directory component
    dest = UPLOADS_DIR / filename
    # Avoid overwriting: append counter if needed
    counter = 1
    while dest.exists():
        stem = Path(filename).stem
        ext  = Path(filename).suffix
        dest = UPLOADS_DIR / f"{stem}_{counter}{ext}"
        counter += 1

    f.save(str(dest))
    path  = str(dest.resolve())
    btype = detect_type(path)
    if btype == "unknown":
        dest.unlink(missing_ok=True)
        return jsonify({"error": f"Unsupported format. Use .pdf .epub .cbz .cbr"}), 400

    bid = book_id(path)
    lib = load_library()
    if bid not in lib:
        total = _get_total_pages(path, btype)
        lib[bid] = {
            "path":     path,
            "title":    Path(filename).stem,
            "type":     btype,
            "total":    total,
            "progress": 0,
            "added":    __import__("time").time(),
            "cover":    None,
        }
    save_library(lib)
    return jsonify({"id": bid, **lib[bid]})

@app.route("/api/library/progress", methods=["POST"])
def api_progress():
    data = request.json
    bid  = data.get("id")
    page = data.get("page", 0)
    lib  = load_library()
    if bid in lib:
        lib[bid]["progress"] = page
        save_library(lib)
    return jsonify({"ok": True})

# ─── Cover images ────────────────────────────────────────────────────────────

@app.route("/api/cover/<bid>")
def api_cover(bid):
    lib = load_library()
    book = lib.get(bid)
    if not book:
        abort(404)
    img_bytes = _get_cover(book["path"], book["type"])
    if img_bytes is None:
        abort(404)
    return send_file(io.BytesIO(img_bytes), mimetype="image/jpeg")

# ─── PDF ─────────────────────────────────────────────────────────────────────

@app.route("/api/pdf/page")
def api_pdf_page():
    path  = request.args.get("path", "")
    page  = int(request.args.get("page", 0))
    scale = float(request.args.get("scale", 1.5))
    if not Path(path).exists():
        abort(404)
    try:
        doc    = pdfium.PdfDocument(path)
        pg     = doc[page]
        bitmap = pg.render(scale=scale, rotation=0)
        pil    = bitmap.to_pil()
        buf    = io.BytesIO()
        pil.save(buf, "JPEG", quality=85)
        buf.seek(0)
        return send_file(buf, mimetype="image/jpeg")
    except Exception as e:
        abort(500)

@app.route("/api/pdf/info")
def api_pdf_info():
    path = request.args.get("path", "")
    if not Path(path).exists():
        abort(404)
    doc = pdfium.PdfDocument(path)
    return jsonify({"pages": len(doc)})

# ─── EPUB ─────────────────────────────────────────────────────────────────────

def _parse_epub(path: str):
    """Return list of chapters: [{title, html, images:{name:b64}}]"""
    chapters = []
    with zipfile.ZipFile(path) as zf:
        names = zf.namelist()
        # Parse container.xml → OPF path
        container = zf.read("META-INF/container.xml")
        soup = BeautifulSoup(container, "xml")
        opf_path = soup.find("rootfile")["full-path"]
        opf_dir  = str(Path(opf_path).parent)
        opf_dir  = opf_dir if opf_dir != "." else ""

        opf = BeautifulSoup(zf.read(opf_path), "xml")

        # Build id→href map
        manifest = {}
        for item in opf.find_all("item"):
            manifest[item["id"]] = item["href"]

        # Spine order
        spine_items = [s["idref"] for s in opf.find("spine").find_all("itemref")]

        # NCX / nav for titles
        titles = {}
        try:
            ncx_id   = opf.find("spine")["toc"]
            ncx_href = manifest.get(ncx_id, "")
            ncx_full = (opf_dir + "/" + ncx_href).lstrip("/") if opf_dir else ncx_href
            ncx = BeautifulSoup(zf.read(ncx_full), "xml")
            for np in ncx.find_all("navPoint"):
                src  = np.find("content")["src"].split("#")[0]
                lbl  = np.find("text").get_text(strip=True) if np.find("text") else ""
                titles[src] = lbl
        except Exception:
            pass

        # Collect images as base64
        images = {}
        for name in names:
            ext = Path(name).suffix.lower()
            if ext in (".png",".jpg",".jpeg",".gif",".webp",".svg"):
                try:
                    raw = zf.read(name)
                    mime = "image/svg+xml" if ext==".svg" else f"image/{ext[1:]}"
                    images[Path(name).name] = f"data:{mime};base64," + base64.b64encode(raw).decode()
                except Exception:
                    pass

        # Read HTML content
        for idref in spine_items:
            href = manifest.get(idref, "")
            if not href:
                continue
            full = (opf_dir + "/" + href).lstrip("/") if opf_dir else href
            full = full.split("#")[0]
            try:
                raw_html = zf.read(full).decode("utf-8", errors="replace")
            except Exception:
                continue

            # Embed images with base64
            soup_ch = BeautifulSoup(raw_html, "html.parser")
            for tag in soup_ch.find_all(["img","image"]):
                src = tag.get("src") or tag.get("xlink:href") or ""
                fname = Path(src).name
                if fname in images:
                    tag["src"] = images[fname]

            body = soup_ch.find("body")
            html_content = str(body) if body else str(soup_ch)
            title = titles.get(Path(href).name, f"Chapter {len(chapters)+1}")
            chapters.append({"title": title, "html": html_content})
    return chapters

@app.route("/api/epub/chapters")
def api_epub_chapters():
    path = request.args.get("path", "")
    if not Path(path).exists():
        abort(404)
    try:
        chapters = _parse_epub(path)
        # Return without full HTML for TOC listing
        toc = [{"index": i, "title": c["title"]} for i, c in enumerate(chapters)]
        return jsonify({"chapters": toc, "total": len(chapters)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/epub/chapter")
def api_epub_chapter():
    path  = request.args.get("path", "")
    index = int(request.args.get("index", 0))
    if not Path(path).exists():
        abort(404)
    try:
        chapters = _parse_epub(path)
        if index >= len(chapters):
            abort(404)
        return jsonify(chapters[index])
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/epub/chapter_pair")
def api_epub_chapter_pair():
    """Return two consecutive chapters for two-page spread mode."""
    path   = request.args.get("path", "")
    index  = int(request.args.get("index", 0))
    if not Path(path).exists():
        abort(404)
    try:
        chapters = _parse_epub(path)
        left  = chapters[index]       if index < len(chapters)     else None
        right = chapters[index + 1]   if index + 1 < len(chapters) else None
        return jsonify({
            "left":  left,
            "right": right,
            "total": len(chapters),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ─── Manga (CBZ/CBR) ─────────────────────────────────────────────────────────

def _manga_pages(path: str):
    """Return sorted list of image filenames inside the archive."""
    IMAGE_EXTS = {".jpg",".jpeg",".png",".gif",".webp"}
    pages = []
    try:
        with zipfile.ZipFile(path) as zf:
            for name in sorted(zf.namelist()):
                if Path(name).suffix.lower() in IMAGE_EXTS and not name.endswith("/"):
                    pages.append(name)
    except zipfile.BadZipFile:
        # CBR = RAR — try basic RAR parsing
        pages = _rar_list(path)
    return pages

def _rar_list(path: str):
    """Minimal RAR file lister (RAR4 only, no extraction — fallback)."""
    IMAGE_EXTS = {".jpg",".jpeg",".png",".gif",".webp"}
    names = []
    try:
        import rarfile
        with rarfile.RarFile(path) as rf:
            for info in rf.infolist():
                if Path(info.filename).suffix.lower() in IMAGE_EXTS:
                    names.append(info.filename)
    except Exception:
        pass
    return sorted(names)

@app.route("/api/manga/pages")
def api_manga_pages():
    path = request.args.get("path", "")
    if not Path(path).exists():
        abort(404)
    pages = _manga_pages(path)
    return jsonify({"pages": pages, "total": len(pages)})

@app.route("/api/manga/page")
def api_manga_page():
    path  = request.args.get("path", "")
    index = int(request.args.get("index", 0))
    if not Path(path).exists():
        abort(404)
    pages = _manga_pages(path)
    if index >= len(pages):
        abort(404)
    name = pages[index]
    try:
        with zipfile.ZipFile(path) as zf:
            data = zf.read(name)
        ext  = Path(name).suffix.lower()
        mime = f"image/{ext[1:]}" if ext != ".jpg" else "image/jpeg"
        return send_file(io.BytesIO(data), mimetype=mime)
    except Exception:
        abort(500)

# ─── Helpers ─────────────────────────────────────────────────────────────────

def _get_total_pages(path: str, btype: str) -> int:
    try:
        if btype == "pdf":
            return len(pdfium.PdfDocument(path))
        if btype == "epub":
            return len(_parse_epub(path))
        if btype == "manga":
            return len(_manga_pages(path))
    except Exception:
        pass
    return 0

def _get_cover(path: str, btype: str) -> bytes | None:
    try:
        if btype == "pdf":
            doc    = pdfium.PdfDocument(path)
            pg     = doc[0]
            bm     = pg.render(scale=0.5)
            pil    = bm.to_pil()
            buf    = io.BytesIO()
            pil.save(buf, "JPEG", quality=70)
            return buf.getvalue()
        if btype == "epub":
            with zipfile.ZipFile(path) as zf:
                for name in zf.namelist():
                    low = name.lower()
                    if ("cover" in low or low.endswith("cover.jpg") or low.endswith("cover.png")):
                        ext = Path(name).suffix.lower()
                        if ext in (".jpg",".jpeg",".png"):
                            raw = zf.read(name)
                            img = Image.open(io.BytesIO(raw)).convert("RGB")
                            img.thumbnail((300, 450))
                            buf = io.BytesIO()
                            img.save(buf, "JPEG", quality=70)
                            return buf.getvalue()
        if btype == "manga":
            pages = _manga_pages(path)
            if pages:
                with zipfile.ZipFile(path) as zf:
                    raw = zf.read(pages[0])
                img = Image.open(io.BytesIO(raw)).convert("RGB")
                img.thumbnail((300, 450))
                buf = io.BytesIO()
                img.save(buf, "JPEG", quality=70)
                return buf.getvalue()
    except Exception:
        pass
    return None

if __name__ == "__main__":
    print("✦ Luminary Reader — http://localhost:5000")
    app.run(debug=True, port=5000)
