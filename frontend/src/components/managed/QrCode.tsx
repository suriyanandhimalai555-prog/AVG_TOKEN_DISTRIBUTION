/**
 * Managed Wallets — QR code image for a wallet address (holder page).
 * Renders nothing if generation fails.
 */
import { useEffect, useState } from "react";
import QRCode from "qrcode";

interface QrCodeProps {
  /** Text to encode (the wallet address). */
  value: string;
  /** Rendered width/height in CSS pixels. */
  size?: number;
  alt?: string;
  className?: string;
}

export default function QrCode({ value, size = 160, alt, className }: QrCodeProps) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    if (!value) return undefined;
    QRCode.toDataURL(value, {
      width: size * 2, // crisp on HiDPI; scaled down by the <img> size
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#000000ff", light: "#ffffffff" },
    })
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!src) return null;

  return (
    <img
      src={src}
      width={size}
      height={size}
      alt={alt ?? `QR code for ${value}`}
      className={className}
      draggable={false}
      style={{ width: size, height: size, imageRendering: "pixelated" }}
    />
  );
}
