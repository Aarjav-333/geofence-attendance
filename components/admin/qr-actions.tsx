"use client";

import { useState } from "react";
import { qrPath } from "@/lib/qr-path";

interface Props {
  rows: string[];
  quiet: number;
  url: string;
}

function download(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/** Download (PNG / SVG), copy link and print controls for the workplace QR code. */
export function QrActions({ rows, quiet, url }: Props) {
  const [copied, setCopied] = useState(false);
  const size = rows.length + quiet * 2;

  function downloadPng() {
    const scale = Math.max(8, Math.floor(1200 / size)); // ~1200 px, crisp integer module size
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000";
    rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) {
        if (row[c] === "1") ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
      }
    });
    canvas.toBlob((blob) => blob && download(blob, "attendance-qr.png"), "image/png");
  }

  function downloadSvg() {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="1024" height="1024" shape-rendering="crispEdges">` +
      `<rect width="${size}" height="${size}" fill="#fff"/><path d="${qrPath(rows, quiet)}" fill="#000"/></svg>`;
    download(new Blob([svg], { type: "image/svg+xml" }), "attendance-qr.svg");
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the URL is shown on the page */
    }
  }

  return (
    <div className="mt-6 grid gap-2 sm:grid-cols-4">
      <button type="button" className="btn-primary py-2 text-sm" onClick={downloadPng}>
        Download PNG
      </button>
      <button type="button" className="btn-secondary py-2 text-sm" onClick={downloadSvg}>
        Download SVG
      </button>
      <button type="button" className="btn-secondary py-2 text-sm" onClick={() => window.print()}>
        Print
      </button>
      <button type="button" className="btn-secondary py-2 text-sm" onClick={copyLink}>
        {copied ? "Copied ✓" : "Copy link"}
      </button>
    </div>
  );
}
