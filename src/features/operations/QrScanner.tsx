import { useEffect, useRef, useState } from "react";
import { Modal } from "../../ui/Modal";
import { parseQrToken, isValidQrToken } from "./qrToken";

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>>;
};

function getDetector(): BarcodeDetectorLike | null {
  const Ctor = (
    window as Window & {
      BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike;
    }
  ).BarcodeDetector;
  if (!Ctor) return null;
  try {
    return new Ctor({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

export function QrScanner({
  open,
  onClose,
  onDetected,
}: {
  open: boolean;
  onClose: () => void;
  onDetected: (token: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const supported = typeof window !== "undefined" && Boolean(getDetector());

  useEffect(() => {
    if (!open) return;
    setError("");
    const video = videoRef.current;
    const detector = getDetector();
    if (!video || !detector) return;

    let active = true;
    let stream: MediaStream | null = null;
    let frame = 0;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (!active || !video) return;
        video.srcObject = stream;
        await video.play();

        const tick = async () => {
          if (!active || !video) return;
          try {
            const codes = await detector.detect(video);
            const token = codes
              .map((code) => parseQrToken(code.rawValue))
              .find(isValidQrToken);
            if (token) {
              onDetected(token);
              onClose();
              return;
            }
          } catch {
            /* frame dropped */
          }
          frame = requestAnimationFrame(() => void tick());
        };
        frame = requestAnimationFrame(() => void tick());
      } catch {
        if (active)
          setError(
            "Caméra indisponible. Autorisez l’accès, ou scannez le QR avec l’appareil photo du téléphone.",
          );
      }
    }

    void start();
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      if (video) video.srcObject = null;
    };
  }, [open, onClose, onDetected]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Scanner le QR"
      subtitle="Cadrez le code affiché par le chef de station."
    >
      {!supported ? (
        <p className="ops-callout ops-callout--muted">
          Ce navigateur ne scanne pas en direct. Ouvrez l’appareil photo du
          téléphone et visez le QR : le lien s’ouvre tout seul.
        </p>
      ) : error ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : (
        <video
          ref={videoRef}
          className="ops-scan-video"
          playsInline
          muted
          autoPlay
        />
      )}
    </Modal>
  );
}
