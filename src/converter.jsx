import React, { useState } from "react";

const MODES = [
  { id: "image", label: "Image", accept: "image/*" },
  { id: "video", label: "Video", accept: "video/*" },
  { id: "bg-remove", label: "Remove Background", accept: "image/*" },
];

const IMAGE_FORMATS = [
  { value: "image/png", label: "PNG" },
  { value: "image/jpeg", label: "JPEG" },
  { value: "image/webp", label: "WEBP" },
];

// Browsers can only *encode* video client-side as WebM (via MediaRecorder).
// True MP4 encoding needs a server or a heavy wasm encoder, so we're honest
// about that here instead of offering a format we can't actually produce.
const VIDEO_FORMATS = [
  { value: "video/webm;codecs=vp9", label: "WEBM (VP9)" },
  { value: "video/webm;codecs=vp8", label: "WEBM (VP8)" },
];

export default function Converter() {
  const [mode, setMode] = useState("image");
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [format, setFormat] = useState("image/png");
  const [videoFormat, setVideoFormat] = useState(VIDEO_FORMATS[0].value);
  const [convertedUrl, setConvertedUrl] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);

  const currentMode = MODES.find((m) => m.id === mode);

  const resetFile = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
    setConvertedUrl(null);
    setError(null);
  };

  const handleModeChange = (nextMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    resetFile();
  };

  const handleFileChange = (e) => {
    const selected = e.target.files[0];
    if (selected) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setFile(selected);
      setPreviewUrl(URL.createObjectURL(selected));
      setConvertedUrl(null);
      setError(null);
    }
  };

  const convertImage = () => {
    if (!file || !previewUrl) return;
    setProcessing(true);
    setError(null);

    const img = new Image();
    img.src = previewUrl;

    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");

      // Fill background with white if target format is JPEG (no alpha support)
      if (format === "image/jpeg") {
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      ctx.drawImage(img, 0, 0);
      const resultDataUrl = canvas.toDataURL(format, 0.92);
      setConvertedUrl(resultDataUrl);
      setProcessing(false);
    };

    img.onerror = () => {
      setError("Couldn't read that image.");
      setProcessing(false);
    };
  };

  const convertVideo = () => {
    if (!file || !previewUrl) return;
    setProcessing(true);
    setError(null);

    const videoEl = document.createElement("video");
    videoEl.src = previewUrl;
    videoEl.muted = false;

    videoEl.onloadedmetadata = () => {
      videoEl
        .play()
        .then(() => {
          const stream =
            videoEl.captureStream?.() ?? videoEl.mozCaptureStream?.();

          if (!stream) {
            setError("This browser can't re-encode video client-side.");
            setProcessing(false);
            return;
          }

          let recorder;
          try {
            recorder = new MediaRecorder(stream, { mimeType: videoFormat });
          } catch {
            recorder = new MediaRecorder(stream); // fall back to browser default
          }

          const chunks = [];
          recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
          };
          recorder.onstop = () => {
            const blob = new Blob(chunks, { type: "video/webm" });
            setConvertedUrl(URL.createObjectURL(blob));
            setProcessing(false);
          };

          videoEl.onended = () => recorder.stop();
          recorder.start();
        })
        .catch((err) => {
          setError(`Couldn't process that video: ${err.message}`);
          setProcessing(false);
        });
    };

    videoEl.onerror = () => {
      setError("Couldn't read that video.");
      setProcessing(false);
    };
  };

  const removeBackground = async () => {
    if (!file) return;
    setProcessing(true);
    setError(null);

    try {
      // Loaded on demand from a CDN so the app stays lightweight until this
      // mode is actually used; runs fully client-side via WASM.
      const { removeBackground: runRemoval } = await import(
        "https://esm.sh/@imgly/background-removal@1.5.5"
      );
      const blob = await runRemoval(file);
      setConvertedUrl(URL.createObjectURL(blob));
    } catch (err) {
      setError(`Background removal failed: ${err.message}`);
    } finally {
      setProcessing(false);
    }
  };

  const handleConvert = () => {
    if (mode === "image") convertImage();
    else if (mode === "video") convertVideo();
    else removeBackground();
  };

  const downloadExtension =
    mode === "image" ? format.split("/")[1] : mode === "video" ? "webm" : "png";

  return (
    <div className="max-w-2xl w-full mx-auto p-6 bg-slate-900 rounded-2xl shadow-xl shadow-black/30 border border-slate-800 font-sans">
      <h2 className="text-2xl font-bold text-center text-slate-100 mb-6">
        File Converter
      </h2>

      {/* Mode Tabs */}
      <div className="grid grid-cols-3 gap-2 p-1 mb-6 bg-slate-800 rounded-xl">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => handleModeChange(m.id)}
            className={`py-2 px-2 text-sm font-semibold rounded-lg transition duration-150 cursor-pointer ${
              mode === m.id
                ? "bg-slate-950 text-blue-200 shadow"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Upload area + conversion options, side by side */}
      <div className="flex flex-col sm:flex-row gap-4">
        <label className="flex-1 flex flex-col items-center justify-center p-6 border-2 border-dashed border-slate-700 rounded-xl cursor-pointer hover:border-blue-200 hover:bg-blue-500/5 transition duration-200 text-center">
          <span className="text-slate-300 font-medium mb-1">
            {file ? file.name : `Click to select a ${mode === "video" ? "video" : "image"}`}
          </span>
          <span className="text-xs text-slate-500">
            {mode === "video" ? "MP4, WEBM, MOV, etc." : "PNG, JPG, WEBP, etc."}
          </span>
          <input
            type="file"
            accept={currentMode.accept}
            className="hidden"
            onChange={handleFileChange}
          />
        </label>

        {/* Right-side options panel */}
        <div className="flex-1 p-4 bg-slate-800/60 border border-slate-700 rounded-xl flex flex-col justify-center">
          {mode === "image" && (
            <>
              <label className="text-sm font-medium text-slate-300 mb-2">
                Convert to
              </label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-200"
              >
                {IMAGE_FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </>
          )}

          {mode === "video" && (
            <>
              <label className="text-sm font-medium text-slate-300 mb-2">
                Convert to
              </label>
              <select
                value={videoFormat}
                onChange={(e) => setVideoFormat(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-200"
              >
                {VIDEO_FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500 mt-2">
                Browsers can only re-encode video to WebM client-side.
              </p>
            </>
          )}

          {mode === "bg-remove" && (
            <>
              <p className="text-sm font-medium text-slate-300 mb-1">Output</p>
              <p className="text-sm text-slate-400">
                Transparent PNG with the background removed.
              </p>
              <p className="text-xs text-slate-500 mt-2">
                Runs a small AI model right in your browser.
              </p>
            </>
          )}
        </div>
      </div>

      {/* Preview */}
      {previewUrl && (
        <div className="mt-4 w-full h-48 bg-slate-950 rounded-lg overflow-hidden flex items-center justify-center border border-slate-800">
          {mode === "video" ? (
            <video src={previewUrl} controls className="max-h-full max-w-full" />
          ) : (
            <img src={previewUrl} alt="Preview" className="max-h-full max-w-full object-contain" />
          )}
        </div>
      )}

      {file && (
        <button
          onClick={handleConvert}
          disabled={processing}
          className="w-full mt-4 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-700 disabled:text-slate-400 text-white font-semibold rounded-lg shadow transition duration-200 cursor-pointer disabled:cursor-not-allowed"
        >
          {processing
            ? "Processing…"
            : mode === "bg-remove"
              ? "Remove Background"
              : "Convert File"}
        </button>
      )}

      {error && (
        <div className="mt-4 p-3 bg-red-950/50 border border-red-800 rounded-xl text-sm text-red-300 text-center">
          {error}
        </div>
      )}

      {/* Download Section */}
      {convertedUrl && (
        <div className="mt-6 p-4 bg-emerald-950/40 border border-emerald-800 rounded-xl text-center">
          <p className="text-sm font-semibold text-emerald-300 mb-3">
            Conversion Complete!
          </p>
          <a
            href={convertedUrl}
            download={`converted-file.${downloadExtension}`}
            className="inline-block px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg text-sm transition duration-200"
          >
            Download File
          </a>
        </div>
      )}
    </div>
  );
}
