"use client";

/**
 * Client-side thumbnail capture for published clusters.
 * Uses html2canvas-pro to screenshot the canvas DOM element,
 * then uploads to the server.
 */

export async function captureAndUploadThumbnail(
  canvasElement: HTMLElement,
  slug: string
): Promise<string | null> {
  try {
    // Dynamic import to keep html2canvas out of the server bundle
    const { default: html2canvas } = await import("html2canvas-pro");

    const canvas = await html2canvas(canvasElement, {
      backgroundColor: "#0c0c0c",
      scale: 0.5, // Lower resolution for thumbnails (speed + file size)
      width: canvasElement.offsetWidth,
      height: canvasElement.offsetHeight,
      logging: false,
      useCORS: true,
    });

    // Convert to JPEG for smaller file size
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);

    // Upload to the API
    const res = await fetch(`/api/community/${encodeURIComponent(slug)}/thumbnail`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: dataUrl }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    return data.thumbnail_url || null;
  } catch (err) {
    console.error("Thumbnail capture failed:", err);
    return null;
  }
}
