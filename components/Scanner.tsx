'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { identifyCard } from '@/lib/scanner/identify';
import { identifyWithVision } from '@/lib/scanner/identify-vision';
import type { CardRead } from '@/lib/scanner/vision-types';
import { warmUpOcr } from '@/lib/scanner/ocr-client';
import type { ApiCard, IdentifyResult, ScanDiagnostics } from '@/lib/scanner/types';
import { frameScore, READABLE_SHARPNESS, GLARE_FRACTION } from '@/lib/scanner/sharpness';

type Phase = 'idle' | 'camera' | 'working' | 'result';

/** Format a price honestly, or say plainly that it is unavailable.
 *  Never invent, estimate, or fall back to a stale number (rule 2). */
function priceLabel(c: ApiCard): string {
  return typeof c.marketPrice === 'number' ? `$${c.marketPrice.toFixed(2)}` : 'Value unavailable';
}

/** Show WHEN a price was true, not just what it was. */
function priceAge(c: ApiCard): string | null {
  if (!c.priceUpdatedAt) return null;
  const then = new Date(c.priceUpdatedAt).getTime();
  if (Number.isNaN(then)) return null;
  const hours = Math.round((Date.now() - then) / 3_600_000);
  if (hours < 1) return 'updated just now';
  if (hours < 24) return `updated ${hours}h ago`;
  return `updated ${Math.round(hours / 24)}d ago`;
}

export default function Scanner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  /** Whether this camera exposes a torch at all, and whether it is lit. */
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const guideRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** A degraded-but-working state is NOT an error. Showing "Something went
   *  wrong" in red for a fallback made a working scan look broken. */
  const [notice, setNotice] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<IdentifyResult | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [vision, setVision] = useState<CardRead | null>(null);

  // Warm the OCR engine at load: it downloads several MB, and without this the
  // first scan looks like a hang rather than a download.
  useEffect(() => { warmUpOcr(); }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);
  useEffect(() => stopCamera, [stopCamera]);

  async function startCamera() {
    setError(null);
    try {
      // Ask for as much resolution as the phone will give.
      //
      // This is the single most important line in the scanner, and it was
      // wrong. It used to ask for 1080p. A collector number is about 2% of a
      // card's height, and a card fills maybe half the frame, so at 1080p the
      // digits are captured about 20 pixels tall -- right at the edge of
      // legible. Run 02 measured exactly that: the model read the number on
      // one card in five and called the rest "too blurry". It was not blur.
      // The detail was never captured.
      //
      // At 2160p those digits are ~40px and comfortably readable. It costs
      // nothing per scan, because the upload is downscaled either way; the
      // extra pixels are used for the magnified bottom crop and then thrown
      // away. `ideal` rather than `exact` so a phone that cannot do it simply
      // gives its best instead of failing to open the camera at all.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 3840 },
          height: { ideal: 2160 },
        },
      });
      streamRef.current = stream;

      // Keep the lens hunting for focus rather than locking on whatever was in
      // front of it when the camera opened. Non-standard and absent on
      // desktop, so it is attempted and ignored if unsupported -- never let it
      // stop a scan.
      try {
        const track = stream.getVideoTracks()[0];
        const caps = track?.getCapabilities?.() as
          (MediaTrackCapabilities & { focusMode?: string[] }) | undefined;
        if (caps?.focusMode?.includes('continuous')) {
          await track.applyConstraints(
            { advanced: [{ focusMode: 'continuous' }] } as unknown as MediaTrackConstraints,
          );
        }
      } catch (e) {
        console.warn('Continuous focus unavailable:', e);
      }

      // Does this camera have a torch? Sterling found that switching the phone
      // flash on turned an unreadable collector number into a perfect read,
      // which fits what the failures kept saying: the bad scans complained of
      // glare and overexposure, both symptoms of the camera fighting for light
      // and using a slow shutter and high gain to get it. Constant light means
      // a faster shutter, less motion blur and less noise.
      //
      // Non-standard, and Android Chrome supports it where iOS Safari
      // generally does not, so the control only appears when the device
      // actually reports the capability rather than offering a button that
      // silently does nothing.
      try {
        const track = stream.getVideoTracks()[0];
        const caps = track?.getCapabilities?.() as
          (MediaTrackCapabilities & { torch?: boolean }) | undefined;
        setTorchAvailable(Boolean(caps?.torch));
      } catch (e) {
        console.warn('Torch capability unknown:', e);
        setTorchAvailable(false);
      }
      setTorchOn(false);
      setPhase('camera');
      // Wait for React to render the <video> before attaching.
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch (e) {
      // Show the real reason: denied, no camera, or insecure context are very
      // different problems and the user can only act if told which.
      setError(
        e instanceof Error
          ? `Camera unavailable: ${e.message}`
          : 'Camera unavailable for an unknown reason',
      );
    }
  }

  /**
   * Map the on-screen guide rectangle to native video pixels, accounting for
   * object-fit: cover scaling.
   *
   * This is why scanning works at all. OCR crops the top ~24% of the image
   * looking for the card's name. If we hand it the whole camera frame, that
   * top 24% is ceiling and wall, not the card -- so it reads nothing no matter
   * how good the photo is. Cropping to the guide first is what puts the name
   * where the reader expects it.
   */
  function getGuideVideoRect(): { x: number; y: number; w: number; h: number } | null {
    const video = videoRef.current;
    const guide = guideRef.current;
    if (!video || !guide || !video.videoWidth || !video.videoHeight) return null;

    const videoBox = video.getBoundingClientRect();
    const guideBox = guide.getBoundingClientRect();
    if (videoBox.width === 0 || videoBox.height === 0) return null;

    const coverScale = Math.max(videoBox.width / video.videoWidth, videoBox.height / video.videoHeight);
    const renderedW = video.videoWidth * coverScale;
    const renderedH = video.videoHeight * coverScale;
    const cropOffsetX = (renderedW - videoBox.width) / 2;
    const cropOffsetY = (renderedH - videoBox.height) / 2;

    // Pad outward before mapping. Real-world alignment is never pixel-perfect,
    // and a tight crop that clips the TOP edge cuts the name off before OCR
    // ever sees it -- the one failure that cannot be recovered from.
    const PAD = 0.22;
    const padX = guideBox.width * PAD, padY = guideBox.height * PAD;
    const guideDisplayX = (guideBox.left - videoBox.left) - padX;
    const guideDisplayY = (guideBox.top - videoBox.top) - padY;
    const guideW = guideBox.width + padX * 2, guideH = guideBox.height + padY * 2;

    const srcX = Math.max(0, (guideDisplayX + cropOffsetX) / coverScale);
    const srcY = Math.max(0, (guideDisplayY + cropOffsetY) / coverScale);
    const srcW = Math.min(video.videoWidth - srcX, guideW / coverScale);
    const srcH = Math.min(video.videoHeight - srcY, guideH / coverScale);
    if (srcW < 20 || srcH < 20) return null;
    return { x: srcX, y: srcY, w: srcW, h: srcH };
  }

  async function toggleTorch() {
    if (!(await setTorch(!torchOn))) {
      // Rule 4: the camera refused, so say so rather than leaving a button
      // that appears to do nothing.
      setTorchAvailable(false);
      setError('This camera would not turn its light on. Some phones only allow it for the ' +
        'built-in camera app, not for web pages.');
    }
  }

  /**
   * Score how much fine detail sits in the bottom of the guide frame, where
   * the collector number is printed. Small and cheap: the strip is drawn into
   * a 320px-wide scratch canvas, because ranking frames needs relative scores,
   * not absolute ones.
   */
  function scoreNumberRegion(
    video: HTMLVideoElement,
    r: { x: number; y: number; w: number; h: number },
  ): { sharpness: number; clipped: number; score: number } {
    const none = { sharpness: 0, clipped: 0, score: 0 };
    const SW = 320;
    const cut = Math.round(r.h * 0.68);
    const sy = r.y + cut;
    const sh = r.h - cut;
    if (sh < 8) return none;
    const c = document.createElement('canvas');
    c.width = SW;
    c.height = Math.max(3, Math.round((sh / r.w) * SW));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return none;
    ctx.drawImage(video, r.x, sy, r.w, sh, 0, 0, c.width, c.height);
    return frameScore(ctx.getImageData(0, 0, c.width, c.height));
  }

  /**
   * Take several frames and keep the sharpest, rather than whatever instant
   * the user's finger landed on.
   *
   * Two scans of the same card, seconds apart through the same build, read
   * `190/165` perfectly and then nothing at all -- "severely out of focus and
   * overexposed". The code was identical; only the photo differed. Once
   * capture resolution stopped being the limit, this variance became the whole
   * problem, and a scanner that works on one press and not the next is not a
   * product.
   *
   * Frames are ranked on the bottom of the card specifically. A photo can be
   * pin-sharp on the artwork and useless where the small print is, and it is
   * the small print that decides which of fifty Flareons you own.
   */
  /** Set the torch and say whether it took. Never throws. */
  async function setTorch(on: boolean): Promise<boolean> {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return false;
    try {
      await track.applyConstraints({ advanced: [{ torch: on }] } as unknown as MediaTrackConstraints);
      setTorchOn(on);
      return true;
    } catch (e) {
      console.warn('Torch refused:', e);
      return false;
    }
  }

  interface Burst {
    card: string;
    full: string;
    score: number;
    sharpness: number;
    clipped: number;
    frames: number;
  }

  /** Take several frames and keep the best one for reading small print. */
  async function takeBurst(video: HTMLVideoElement, frames = 6, gapMs = 90): Promise<Burst | null> {
    let best: Burst | null = null;
    for (let i = 0; i < frames; i++) {
      let r: { x: number; y: number; w: number; h: number } | null = null;
      try { r = getGuideVideoRect(); } catch (e) { console.warn('Guide rect failed:', e); }
      const m = r ? scoreNumberRegion(video, r) : { sharpness: 0, clipped: 0, score: 0 };

      // Draw the keepers in the SAME synchronous block as the scoring, so the
      // pixels kept are the pixels measured -- the video advances between
      // ticks, not within one.
      if (!best || m.score > best.score) {
        const fullCanvas = document.createElement('canvas');
        fullCanvas.width = video.videoWidth;
        fullCanvas.height = video.videoHeight;
        fullCanvas.getContext('2d')?.drawImage(video, 0, 0);
        const full = fullCanvas.toDataURL('image/jpeg', 0.92);

        // The guided crop: just the card, background removed.
        let card = full;
        if (r) {
          try {
            const c = document.createElement('canvas');
            c.width = r.w; c.height = r.h;
            c.getContext('2d')?.drawImage(video, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
            card = c.toDataURL('image/jpeg', 0.92);
          } catch (e) {
            console.warn('Guided crop failed, using full frame:', e);
          }
        }
        best = { card, full, score: m.score, sharpness: m.sharpness, clipped: m.clipped, frames: i + 1 };
      }
      if (i < frames - 1) await new Promise((res) => setTimeout(res, gapMs));
    }
    return best ? { ...best, frames } : null;
  }

  /**
   * Capture: a burst, and a second burst under the light if glare is blocking
   * the number.
   *
   * Sterling, after testing from a fixed seat under a ceiling light: "there's
   * glare that's covering the number, the image is not clear enough. It 100%
   * works when none of those things are interrupting the picture." The scanner
   * does not fail randomly -- it fails when a reflection sits on the one part
   * of the card that decides which print you own.
   *
   * A torch overpowers that reflection: the ambient glare stays as bright as it
   * was while everything else gets brighter, so the number stops being the
   * dimmest thing under the brightest spot.
   *
   * Automatic rather than a setting, because the user should not have to know
   * any of this. And SELF-CORRECTING rather than trusted: a light on foil can
   * make a mirror worse, so both bursts are scored and the better one wins. If
   * the light hurts, its frames simply lose.
   */
  async function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    setStatus('Focusing…');
    const first = await takeBurst(video);
    if (!first) return;

    let chosen = first;
    let lightUsed = false;

    if (first.clipped >= GLARE_FRACTION && torchAvailable && !torchOn) {
      setStatus('Glare on the number — trying with the light…');
      if (await setTorch(true)) {
        // Give auto-exposure a moment to settle, or the first frames are
        // measured mid-adjustment and score badly for the wrong reason.
        await new Promise((res) => setTimeout(res, 320));
        const second = await takeBurst(video);
        if (second && second.score > first.score) {
          chosen = second;
          lightUsed = true;
        }
        await setTorch(false);
      }
    }

    stopCamera();
    await run(chosen.card, chosen.full, {
      focusScore: Math.round(chosen.sharpness),
      glareFraction: Math.round(chosen.clipped * 100) / 100,
      framesScored: first.frames + (lightUsed ? chosen.frames : 0),
      lightUsed,
    });
  }

  /**
   * Shared path for a camera capture and an uploaded photo.
   *
   * Vision first, OCR as fallback. Real user photos are blurry, glared and
   * tilted; a vision model reads them the way a person does, where letter-shape
   * OCR simply has nothing to match. OCR is kept as a safety net for when the
   * vision service is unreachable -- degraded recognition beats none.
   */
  async function run(
    cardPhoto: string,
    fullFrame?: string | null,
    captureInfo?: {
      focusScore: number; glareFraction: number; framesScored: number; lightUsed: boolean;
    },
  ) {
    setPhoto(cardPhoto);
    setVision(null);
    setNotice(null);
    setError(null);
    setPhase('working');
    setStatus('Reading card…');

    try {
      const { result, vision: v } = await identifyWithVision(cardPhoto);
      setVision(v);
      setOutcome(captureInfo && result.diagnostics
        ? { ...result, diagnostics: { ...result.diagnostics, ...captureInfo } }
        : result);
      setPhase('result');
      // Rule 4: say what was actually wrong. "Try again" teaches nothing; "the
      // bottom of the card never came into focus" tells them what to change.
      // A NOTICE, not an error -- the scan ran, and the name alone is often
      // useful even when the number is not readable.
      // Glare and blur need OPPOSITE responses, so name the one that actually
      // happened. Telling someone to hold steadier when the problem is a
      // reflection sends them to do more of what already failed (rule 4).
      if (captureInfo && captureInfo.glareFraction >= GLARE_FRACTION) {
        setNotice(
          `Glare covered ${Math.round(captureInfo.glareFraction * 100)}% of the bottom of the ` +
          `card in all ${captureInfo.framesScored} frames, which is where the collector number ` +
          'is printed, so several prints may be offered. Tilt the card a few degrees to move ' +
          'the reflection off the number, or turn away from the light behind you.',
        );
      } else if (captureInfo && captureInfo.focusScore < READABLE_SHARPNESS) {
        setNotice(
          `The bottom of the card never came into focus across ${captureInfo.framesScored} ` +
          'frames, so the collector number may not be readable and several prints may be ' +
          'offered. Hold the card so it fills the blue frame — the further away it is, the ' +
          'smaller the number, and it is already the smallest thing on the card.',
        );
      }
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('Vision identification unavailable, falling back to OCR:', msg);
      setStatus('Vision unavailable — trying on-device reading…');
      try {
        const result = await identifyCard({ cardPhoto, fullFrame: fullFrame ?? cardPhoto });
        setOutcome(result);
        setPhase('result');
        // Surface why the better path was skipped, rather than silently
        // serving worse results and letting it look like poor accuracy.
        // A NOTICE, not an error: the scan ran, just with the weaker reader.
        setNotice(
          msg.includes('ANTHROPIC_API_KEY')
            // The validation messages in lib/vision.ts are already written for
            // a human, so pass them through rather than burying them.
            ? `Scanned with the older on-device reader, which struggles with real photos. ${msg}`
            : `Scanned with the older on-device reader because the vision service was unavailable: ${msg}`,
        );
        return;
      } catch (e2) {
        setError(e2 instanceof Error ? e2.message : String(e2));
        setPhase('result');
      }
    }
  }

  /**
   * Upload an existing photo instead of using the camera.
   *
   * Deliberately not a convenience feature. It makes a scan REPEATABLE: the
   * same image can be run against the same build twice, and against the next
   * build after a change. With the camera alone every test is a different
   * photo, so an improvement and a lucky shot look identical.
   */
  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const reader = new FileReader();
    reader.onload = () => { void run(String(reader.result)); };
    reader.onerror = () => setError(`Could not read that file: ${reader.error?.message ?? 'unknown error'}`);
    reader.readAsDataURL(file);
  }

  function reset() {
    setOutcome(null); setPhoto(null); setError(null); setNotice(null);
    setVision(null); setPhase('idle');
  }

  return (
    <div>
      {notice && (
        <div style={{
          background: 'rgba(255,194,77,0.10)', border: '1px solid rgba(255,194,77,0.35)',
          borderRadius: 10, padding: '12px 14px', marginBottom: 16, fontSize: 13, lineHeight: 1.5,
        }}>
          <strong style={{ color: '#FFC24D' }}>Reduced accuracy</strong>
          <div style={{ marginTop: 6, opacity: 0.9 }}>{notice}</div>
        </div>
      )}

      {error && (
        <div style={{
          background: 'rgba(232,72,58,0.12)', border: '1px solid rgba(232,72,58,0.4)',
          borderRadius: 10, padding: '12px 14px', marginBottom: 16, fontSize: 14,
        }}>
          {/* The real error text, deliberately. Rule 4. */}
          <strong style={{ color: '#E8483A' }}>Something went wrong</strong>
          <div style={{ fontFamily: 'monospace', fontSize: 12, opacity: 0.85, marginTop: 6, wordBreak: 'break-word' }}>
            {error}
          </div>
        </div>
      )}

      {phase === 'idle' && (
        <div>
          <button onClick={startCamera} style={btn}>Scan a card</button>
          <label style={{ ...ghost, display: 'block', textAlign: 'center' }}>
            Or upload a photo
            <input type="file" accept="image/*" onChange={onUpload} style={{ display: 'none' }} />
          </label>
        </div>
      )}

      {phase === 'camera' && (
        <div>
          <div style={{ position: 'relative' }}>
            <video ref={videoRef} playsInline muted style={{
              width: '100%', borderRadius: 12, background: '#000',
              aspectRatio: '3/4', objectFit: 'cover', display: 'block',
            }} />
            {/* The card guide. Not decoration -- the capture is cropped to it,
                which is what lets OCR find the name. */}
            <div style={{
              position: 'absolute', inset: 0, display: 'flex',
              alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
            }}>
              <div ref={guideRef} style={{
                width: '62%', aspectRatio: '63/88',
                border: '3px solid rgba(57,169,255,0.9)', borderRadius: 12,
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)',
              }} />
            </div>
            <div style={{
              position: 'absolute', bottom: 10, left: 0, right: 0, textAlign: 'center',
              fontSize: 13, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.8)', pointerEvents: 'none',
            }}>
              Fill the frame with the card
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={capture} style={{ ...btn, flex: 1 }}>Capture</button>
            {torchAvailable && (
              <button
                onClick={toggleTorch}
                aria-pressed={torchOn}
                style={{
                  ...btn, flex: '0 0 auto', padding: '0 16px',
                  background: torchOn ? 'var(--accent)' : 'var(--panel)',
                  color: torchOn ? '#000' : 'var(--fg)',
                  border: '1px solid var(--border)',
                }}
              >
                {torchOn ? 'Light on' : 'Light off'}
              </button>
            )}
          </div>
          {torchAvailable && (
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
              The light helps most on shiny foil cards, where the collector number
              is hardest to read.
            </p>
          )}
          <button onClick={() => { stopCamera(); setPhase('idle'); }} style={ghost}>Cancel</button>
        </div>
      )}

      {phase === 'working' && (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>{status}</div>
      )}

      {phase === 'result' && outcome && (
        <ResultView outcome={outcome} photo={photo} vision={vision} onRetake={reset} />
      )}
    </div>
  );
}

function ResultView({ outcome, photo, vision, onRetake }: {
  outcome: IdentifyResult; photo: string | null; vision: CardRead | null; onRetake: () => void;
}) {
  if (outcome.ok) {
    const c = outcome.apiCard;
    return (
      <div>
        <div style={{ color: '#2FD9A0', fontSize: 13, marginBottom: 8 }}>
          Identified · {outcome.confidence}% confidence
        </div>
        <CardRow card={c} />
        <button onClick={onRetake} style={{ ...btn, marginTop: 16 }}>Scan another</button>
        <Diagnostics d={outcome.diagnostics} vision={vision} />
      </div>
    );
  }

  // Everything below is the never-guess path. It must always offer a way
  // forward: candidates when we have them, and never a bare dead end.
  const candidates = 'candidates' in outcome ? outcome.candidates ?? [] : [];
  const detail = 'errorDetail' in outcome ? outcome.errorDetail : null;
  const confidence = 'confidence' in outcome ? outcome.confidence : null;

  const heading = (() => {
    switch (outcome.reason) {
      case 'ambiguous':
        return `Found ${candidates.length} cards matching “${outcome.text}”${
          confidence != null ? ` (${confidence}% confidence)` : ''
        } — tap the one that matches your photo.`;
      case 'low_confidence':
        return `Not confident about “${outcome.text}”${
          confidence != null ? ` (${confidence}% confidence)` : ''
        } — tap your card below, or retake the photo with better lighting.`;
      case 'no_text':
        return 'Could not read any text on that card. Try again with better lighting, or search manually.';
      case 'no_match':
        return `Read “${outcome.text}” but found no matching card. Try searching manually.`;
      case 'ocr_unavailable':
        return 'Could not load the recognition engine (offline?). Search for the card manually.';
      default: {
        // A missing server key is a setup problem, not a scanning problem.
        // Saying so plainly saves whoever is testing from chasing the camera
        // or the photo when the real fault is one unset config value.
        if (detail && detail.includes('TCGAPI_KEY')) {
          return 'The card database is not configured on the server yet, so this scan could not look anything up. '
            + 'Set TCGAPI_KEY in the hosting environment variables and redeploy. '
            + 'Nothing is wrong with your photo or the camera.';
        }
        return 'Something went wrong while scanning — not just a low-confidence read.';
      }
    }
  })();

  return (
    <div>
      {photo && (
        <img src={photo} alt="Your scan" style={{ width: 120, borderRadius: 8, marginBottom: 12 }} />
      )}
      <p style={{ fontSize: 14, lineHeight: 1.5 }}>{heading}</p>
      {detail && (
        <div style={{ fontFamily: 'monospace', fontSize: 12, opacity: 0.75, marginBottom: 12, wordBreak: 'break-word' }}>
          {detail}
        </div>
      )}

      {candidates.length > 0 && (
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          {candidates.map((c) => <CardRow key={String(c.id)} card={c} />)}
        </div>
      )}

      <button onClick={onRetake} style={{ ...btn, marginTop: 16 }}>Retake photo</button>
      <Diagnostics d={outcome.diagnostics} vision={vision} />
    </div>
  );
}

/**
 * What the scanner actually saw.
 *
 * Every failure this project has hit was diagnosed by guesswork, because a
 * failed scan reported only that it failed. "OCR read nothing", "OCR read
 * FIREBREATHER instead of Charizard" and "read it correctly but 6 prints tied"
 * are three different bugs with three different fixes, and they look identical
 * from the outside.
 */
function Diagnostics({ d, vision }: { d?: ScanDiagnostics; vision?: CardRead | null }) {
  if (!d) return null;
  const rows: Array<[string, string]> = [
    ...(vision ? ([
      ['Read by', d.ocrStrategy?.startsWith('vision') ? 'AI vision model' : 'On-device OCR'],
      ['How legible the card was', vision.legibility],
      ['Model certainty of the name', `${vision.confidence}%`],
      ['Certainty of the card number', `${vision.number_confidence}%`],
      ['Set read', vision.set_name ?? '(not readable)'],
      ['Certainty of the set', `${vision.set_confidence}%`],
      ['Rarity read', vision.rarity ?? '(not readable)'],
      ...(vision.alternate_names.length
        ? ([['Other possible names', vision.alternate_names.join(', ')]] as Array<[string, string]>) : []),
      ...(vision.notes ? ([['Model notes', vision.notes]] as Array<[string, string]>) : []),
    ] as Array<[string, string]>) : []),
    ['Name read from the card', d.ocrText ? `"${d.ocrText}"` : '(nothing readable)'],
    ...(vision ? [] : ([['Which crop worked', d.ocrStrategy ?? '(none succeeded)']] as Array<[string, string]>)),
    ['Card number read', d.numberText ? `"${d.numberText.replace(/\s+/g, ' ').trim()}"` : '(not read)'],
    ...(d.focusScore != null ? ([[
      'Focus where the number is',
      `${d.focusScore}` + (d.framesScored ? ` (best of ${d.framesScored} frames)` : '') +
      (d.focusScore < READABLE_SHARPNESS ? ' — too soft for fine print' : ''),
    ]] as Array<[string, string]>) : []),
    ...(d.lightUsed ? ([[
      'Light',
      'switched on automatically, because glare was covering the number',
    ]] as Array<[string, string]>) : []),
    ...(d.glareFraction != null ? ([[
      'Glare where the number is',
      `${Math.round(d.glareFraction * 100)}% blown out` +
      (d.glareFraction >= GLARE_FRACTION ? ' — reflection is covering the number' : ''),
    ]] as Array<[string, string]>) : []),
    ...(d.numberDetail ? ([[
      'Detail where the number is',
      `${d.numberDetail.digitPx}px tall digits ` +
      `(photo ${d.numberDetail.sourceWidth}x${d.numberDetail.sourceHeight})` +
      // Below roughly 25px there is nothing to read, however good the model.
      // Saying so turns "the model failed" into "the camera did", which is a
      // different problem with a different fix.
      (d.numberDetail.digitPx < 25 ? ' — too little detail to read' : ''),
    ]] as Array<[string, string]>) : []),
    ['Cards found in database', String(d.candidatesFound)],
    ...(d.setTotalMatchCount ? ([[
      'Ranked first by set size',
      `${d.setTotalMatchCount} card${d.setTotalMatchCount === 1 ? '' : 's'} from a set that size`,
    ]] as Array<[string, string]>) : []),
    ['Best match', d.topName ?? '(none)'],
    ['Confidence in this scan', d.topScore != null ? `${d.topScore}%` : '—'],
    ['Score needed to accept automatically', d.autoAcceptFloor != null ? String(d.autoAcceptFloor) : '—'],
    ...(d.uniquelyResolved
      ? ([['Number + set agreed on', 'exactly one card']] as Array<[string, string]>) : []),
    ['Time taken', `${(d.elapsedMs / 1000).toFixed(1)}s`],
    ...(d.usage ? ([[
      'This scan cost',
      `$${d.usage.costUsd.toFixed(4)} (${d.usage.inputTokens.toLocaleString()} in / ${d.usage.outputTokens} out)`,
    ]] as Array<[string, string]>) : []),
  ];
  return (
    <details style={{ marginTop: 16, fontSize: 12 }}>
      <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>
        What the scanner saw
      </summary>
      <div style={{
        marginTop: 8, padding: 12, background: 'var(--panel)',
        border: '1px solid var(--border)', borderRadius: 8,
      }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', gap: 8, padding: '3px 0' }}>
            <span style={{ color: 'var(--muted)', flex: '0 0 46%' }}>{k}</span>
            <span style={{ fontFamily: 'monospace', wordBreak: 'break-word' }}>{v}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

function CardRow({ card }: { card: ApiCard }) {
  const age = priceAge(card);
  return (
    <div style={{
      display: 'flex', gap: 12, alignItems: 'center', padding: 10,
      background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10,
    }}>
      {card.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={card.imageUrl} alt="" width={44} height={60}
             style={{ borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{card.name}</div>
        <div style={{ color: 'var(--muted)', fontSize: 12 }}>
          {[card.setName, card.number, card.rarity].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{priceLabel(card)}</div>
        {/* Where the number came from and when, per docs/PRODUCT.md transparency. */}
        {age && <div style={{ color: 'var(--muted)', fontSize: 11 }}>{age}</div>}
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  width: '100%', padding: '12px 16px', borderRadius: 10, border: 'none',
  background: 'var(--accent)', color: '#04121F', fontWeight: 700, fontSize: 15, cursor: 'pointer',
};
const ghost: React.CSSProperties = {
  width: '100%', padding: '10px 16px', borderRadius: 10, marginTop: 8,
  background: 'transparent', color: 'var(--muted)',
  border: '1px solid var(--border)', fontSize: 14, cursor: 'pointer',
};
