import React, { useRef, useState } from "react";
import {
  ChevronDown,
  Check,
  Download,
  Loader2,
  Plus,
  Trash2,
  X,
  AlertCircle,
} from "lucide-react";

const MODES = [
  { id: "image", label: "Image", accept: "image/*", noun: "images" },
  { id: "video", label: "Video", accept: "video/*", noun: "videos" },
  { id: "bg-remove", label: "Remove Background", accept: "image/*", noun: "images" },
];

const IMAGE_FORMATS = [
  { value: "image/png", label: "PNG", ext: "png" },
  { value: "image/jpeg", label: "JPEG", ext: "jpg" },
  { value: "image/webp", label: "WEBP", ext: "webp" },
];

// Browsers can only *encode* video client-side as WebM (via MediaRecorder).
const VIDEO_FORMATS = [
  { value: "video/webm;codecs=vp9", label: "WEBM (VP9)", ext: "webm" },
  { value: "video/webm;codecs=vp8", label: "WEBM (VP8)", ext: "webm" },
];

let idCounter = 0;
const nextId = () => `f${++idCounter}`;

const baseName = (name) => name.replace(/\.[^/.]+$/, "");

// ---------- Per-file processors (each returns a Promise<string objectUrl>) ----------

const processImage = (previewUrl, format) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");

      // JPEG has no alpha channel, so fill with white first
      if (format === "image/jpeg") {
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(URL.createObjectURL(blob))
            : reject(new Error("Encoding failed")),
        format,
        0.92
      );
    };
    img.onerror = () => reject(new Error("Couldn't read that image."));
    img.src = previewUrl;
  });

const processVideo = (previewUrl, mimeType) =>
  new Promise((resolve, reject) => {
    const videoEl = document.createElement("video");
    videoEl.src = previewUrl;
    videoEl.muted = false;

    videoEl.onerror = () => reject(new Error("Couldn't read that video."));

    videoEl.onloadedmetadata = () => {
      videoEl
        .play()
        .then(() => {
          const stream =
            videoEl.captureStream?.() ?? videoEl.mozCaptureStream?.();

          if (!stream) {
            reject(new Error("This browser can't re-encode video client-side."));
            return;
          }

          let recorder;
          try {
            recorder = new MediaRecorder(stream, { mimeType });
          } catch {
            recorder = new MediaRecorder(stream); // browser default
          }

          const chunks = [];
          recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
          };
          recorder.onstop = () => {
            const blob = new Blob(chunks, { type: "video/webm" });
            resolve(URL.createObjectURL(blob));
          };

          videoEl.onended = () => recorder.stop();
          recorder.start();
        })
        .catch((err) => reject(new Error(`Couldn't process that video: ${err.message}`)));
    };
  });

const processBackground = async (file) => {
  // Loaded on demand from a CDN; runs fully client-side via WASM.
  const { removeBackground: runRemoval } = await import(
    "https://esm.sh/@imgly/background-removal@1.5.5"
  );
  const blob = await runRemoval(file);
  return URL.createObjectURL(blob);
};

// ---------- Small UI pieces ----------

function FormatSelect({ value, onChange, options }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none cursor-pointer bg-neutral-100 text-neutral-900 font-semibold border border-neutral-100 rounded-lg pl-3 pr-9 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400 hover:bg-white transition"
      >
        {options.map((f) => (
          <option key={f.value} value={f.value} className="bg-white text-neutral-900">
            {f.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-700" />
    </div>
  );
}

function StatusIcon({ status }) {
  if (status === "processing")
    return <Loader2 className="w-4 h-4 text-neutral-300 animate-spin" />;
  if (status === "done") return <Check className="w-4 h-4 text-white" />;
  if (status === "error") return <AlertCircle className="w-4 h-4 text-neutral-400" />;
  return <span className="w-2 h-2 rounded-full bg-neutral-600" />;
}

export default function Converter() {
  const [mode, setMode] = useState("image");
  const [items, setItems] = useState([]);
  const [format, setFormat] = useState(IMAGE_FORMATS[0].value);
  const [videoFormat, setVideoFormat] = useState(VIDEO_FORMATS[0].value);
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const currentMode = MODES.find((m) => m.id === mode);

  const updateItem = (id, patch) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const revokeItem = (it) => {
    if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
    if (it.resultUrl) URL.revokeObjectURL(it.resultUrl);
  };

  const clearAll = () => {
    items.forEach(revokeItem);
    setItems([]);
  };

  const removeItem = (id) => {
    const target = items.find((it) => it.id === id);
    if (target) revokeItem(target);
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const handleModeChange = (nextMode) => {
    if (nextMode === mode || running) return;
    clearAll();
    setMode(nextMode);
  };

  const addFiles = (fileList) => {
    const prefix = currentMode.accept.split("/")[0]; // "image" | "video"
    const added = Array.from(fileList)
      .filter((f) => f.type.startsWith(prefix))
      .map((file) => ({
        id: nextId(),
        file,
        previewUrl: URL.createObjectURL(file),
        status: "idle",
        resultUrl: null,
        resultExt: null,
        error: null,
      }));
    if (added.length) setItems((prev) => [...prev, ...added]);
  };

  // Changing the output format invalidates any previous conversion, so
  // already-"done" files need to go back to "idle" to be picked up again.
  const resetDoneItems = () =>
    setItems((prev) =>
      prev.map((it) => {
        if (it.status !== "done") return it;
        if (it.resultUrl) URL.revokeObjectURL(it.resultUrl);
        return { ...it, status: "idle", resultUrl: null, resultExt: null };
      })
    );

  const handleFormatChange = (value) => {
    setFormat(value);
    resetDoneItems();
  };

  const handleVideoFormatChange = (value) => {
    setVideoFormat(value);
    resetDoneItems();
  };

  const handleFileChange = (e) => {
    addFiles(e.target.files);
    e.target.value = ""; // allow re-selecting the same files
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    if (!running) addFiles(e.dataTransfer.files);
  };

  const imageExt = IMAGE_FORMATS.find((f) => f.value === format)?.ext ?? "png";
  const videoExt = VIDEO_FORMATS.find((f) => f.value === videoFormat)?.ext ?? "webm";

  const processOne = async (it) => {
    updateItem(it.id, { status: "processing", error: null });
    try {
      let url;
      let ext;
      if (mode === "image") {
        url = await processImage(it.previewUrl, format);
        ext = imageExt;
      } else if (mode === "video") {
        url = await processVideo(it.previewUrl, videoFormat);
        ext = videoExt;
      } else {
        url = await processBackground(it.file);
        ext = "png";
      }
      if (it.resultUrl) URL.revokeObjectURL(it.resultUrl);
      updateItem(it.id, { status: "done", resultUrl: url, resultExt: ext });
    } catch (err) {
      updateItem(it.id, { status: "error", error: err.message });
    }
  };

  // Files are processed one at a time: video re-encoding is real-time and
  // background removal is memory-heavy, so running in parallel would hurt both.
  const handleConvertAll = async () => {
    const queue = items.filter((it) => it.status !== "done");
    if (!queue.length) return;
    setRunning(true);
    for (const it of queue) {
      await processOne(it);
    }
    setRunning(false);
  };

  const downloadName = (it) =>
    `${baseName(it.file.name)}${mode === "bg-remove" ? "-nobg" : "-converted"}.${it.resultExt}`;

  const doneItems = items.filter((it) => it.status === "done");
  const pendingCount = items.length - doneItems.length;

  const downloadAll = async () => {
    for (const it of doneItems) {
      const a = document.createElement("a");
      a.href = it.resultUrl;
      a.download = downloadName(it);
      document.body.appendChild(a);
      a.click();
      a.remove();
      await new Promise((r) => setTimeout(r, 250)); // browsers block instant multi-downloads
    }
  };

  return (
    <div className="max-w-2xl w-full mx-auto p-6 bg-neutral-900 rounded-2xl shadow-xl shadow-black/40 border border-neutral-800 font-sans">
      <h2 className="text-2xl font-bold text-center text-white mb-6">
        File Converter
      </h2>

      {/* Mode Tabs */}
      <div className="grid grid-cols-3 gap-2 p-1 mb-6 bg-neutral-800 rounded-xl">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => handleModeChange(m.id)}
            disabled={running}
            className={`py-2 px-2 text-sm font-semibold rounded-lg transition duration-150 cursor-pointer disabled:cursor-not-allowed ${
              mode === m.id
                ? "bg-white text-black shadow"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Upload area + options, side by side */}
      <div className="flex flex-col sm:flex-row gap-4">
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`flex-1 flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-xl cursor-pointer transition duration-200 text-center ${
            dragging
              ? "border-white bg-white/10"
              : "border-neutral-700 hover:border-neutral-400 hover:bg-white/5"
          }`}
        >
          <Plus className="w-5 h-5 text-neutral-400 mb-2" />
          <span className="text-neutral-200 font-medium mb-1">
            {items.length
              ? `Add more ${currentMode.noun}`
              : `Click or drop ${currentMode.noun}`}
          </span>
          <span className="text-xs text-neutral-500">
            {mode === "video"
              ? "MP4, WEBM, MOV, etc. — select multiple"
              : "PNG, JPG, WEBP, etc. — select multiple"}
          </span>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={currentMode.accept}
            className="hidden"
            onChange={handleFileChange}
            disabled={running}
          />
        </label>

        {/* Right-side options panel */}
        <div className="flex-1 p-4 bg-neutral-800/60 border border-neutral-700 rounded-xl flex flex-col justify-center">
          {mode === "image" && (
            <>
              <label className="text-sm font-medium text-neutral-300 mb-2">
                Convert to
              </label>
              <FormatSelect value={format} onChange={handleFormatChange} options={IMAGE_FORMATS} />
            </>
          )}

          {mode === "video" && (
            <>
              <label className="text-sm font-medium text-neutral-300 mb-2">
                Convert to
              </label>
              <FormatSelect
                value={videoFormat}
                onChange={handleVideoFormatChange}
                options={VIDEO_FORMATS}
              />
              <p className="text-xs text-neutral-500 mt-2">
                Browsers can only re-encode video to WebM client-side. Videos are
                processed one at a time, in real time.
              </p>
            </>
          )}

          {mode === "bg-remove" && (
            <>
              <p className="text-sm font-medium text-neutral-300 mb-1">Output</p>
              <p className="text-sm text-neutral-400">
                Transparent PNG with the background removed.
              </p>
              <p className="text-xs text-neutral-500 mt-2">
                Runs a small AI model right in your browser.
              </p>
            </>
          )}
        </div>
      </div>

      {/* File list */}
      {items.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-neutral-400">
              {items.length} file{items.length > 1 ? "s" : ""} · {doneItems.length} done
            </p>
            <button
              onClick={clearAll}
              disabled={running}
              className="flex items-center gap-1 text-xs text-neutral-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition"
            >
              <Trash2 className="w-3.5 h-3.5" /> Clear all
            </button>
          </div>

          <ul className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {items.map((it) => (
              <li
                key={it.id}
                className="flex items-center gap-3 p-2 bg-neutral-950 border border-neutral-800 rounded-lg"
              >
                <div className="w-12 h-12 shrink-0 rounded-md overflow-hidden bg-neutral-900 flex items-center justify-center">
                  {mode === "video" ? (
                    <video
                      src={it.previewUrl}
                      muted
                      className="max-w-full max-h-full object-cover"
                    />
                  ) : (
                    <img
                      src={it.resultUrl ?? it.previewUrl}
                      alt=""
                      className="max-w-full max-h-full object-cover"
                    />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-sm text-neutral-200 truncate">{it.file.name}</p>
                  <p className="text-xs text-neutral-500 flex items-center gap-1.5 mt-0.5">
                    <StatusIcon status={it.status} />
                    {it.status === "idle" && "Ready"}
                    {it.status === "processing" && "Processing…"}
                    {it.status === "done" && "Done"}
                    {it.status === "error" && (
                      <span className="text-neutral-400 truncate">{it.error}</span>
                    )}
                  </p>
                </div>

                {it.status === "done" && (
                  <a
                    href={it.resultUrl}
                    download={downloadName(it)}
                    title="Download"
                    className="p-2 rounded-lg text-black bg-white hover:bg-neutral-200 transition"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                )}
                <button
                  onClick={() => removeItem(it.id)}
                  disabled={it.status === "processing"}
                  title="Remove"
                  className="p-2 rounded-lg text-neutral-500 hover:text-white hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions */}
      {items.length > 0 && (
        <div className="mt-4 flex flex-col sm:flex-row gap-2">
          <button
            onClick={handleConvertAll}
            disabled={running || pendingCount === 0}
            className="flex-1 py-2.5 bg-white hover:bg-neutral-200 disabled:bg-neutral-700 disabled:text-neutral-400 text-black font-semibold rounded-lg shadow transition duration-200 cursor-pointer disabled:cursor-not-allowed"
          >
            {running
              ? "Processing…"
              : mode === "bg-remove"
                ? `Remove Background${pendingCount > 1 ? ` (${pendingCount})` : ""}`
                : `Convert ${pendingCount > 1 ? `${pendingCount} Files` : "File"}`}
          </button>

          {doneItems.length > 1 && (
            <button
              onClick={downloadAll}
              className="sm:w-auto py-2.5 px-5 border border-neutral-500 hover:border-white text-white font-semibold rounded-lg transition duration-200 cursor-pointer"
            >
              Download all ({doneItems.length})
            </button>
          )}
        </div>
      )}
    </div>
  );
}