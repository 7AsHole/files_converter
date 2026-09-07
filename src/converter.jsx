import React, { useState } from "react";

export default function Converter() {
    const [file, setFile] = useState(null);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [format, setFormat] = useState("image/png");
    const [convertedUrl, setConvertedUrl] = useState(null);

    const handleFileChange = (e) => {
        const selected = e.target.files[0];
        if (selected) {
            setFile(selected);
            setPreviewUrl(URL.createObjectURL(selected));
            setConvertedUrl(null);
        }
    };

    const handleConvert = () => {
        if (!file || !previewUrl) return;

        const img = new Image();
        img.src = previewUrl;

        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;

            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);

            const resultDataUrl = canvas.toDataURL(format);
            setConvertedUrl(resultDataUrl);
        }
    }
}
