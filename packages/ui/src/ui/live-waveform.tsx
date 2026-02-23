/**
 * Adapted from ElevenLabs UI LiveWaveform (MIT) — https://ui.elevenlabs.io
 * Canvas-based scrolling waveform. Modified to accept an external MediaStream
 * so it shares the recorder's mic instead of opening a second one.
 */

import { useEffect, useRef, type HTMLAttributes } from "react";
import { cn } from "../lib/utils";

export type LiveWaveformProps = HTMLAttributes<HTMLDivElement> & {
  /** External MediaStream to visualize (from the voice recorder) */
  mediaStream?: MediaStream | null;
  /** Whether to actively visualize */
  active?: boolean;
  /** Show processing animation when not active */
  processing?: boolean;
  barWidth?: number;
  barHeight?: number;
  barGap?: number;
  barRadius?: number;
  barColor?: string;
  fadeEdges?: boolean;
  fadeWidth?: number;
  height?: string | number;
  sensitivity?: number;
  smoothingTimeConstant?: number;
  fftSize?: number;
  historySize?: number;
  updateRate?: number;
  mode?: "scrolling" | "static";
};

export const LiveWaveform = ({
  mediaStream,
  active = false,
  processing = false,
  barWidth = 3,
  barGap = 1,
  barRadius = 1.5,
  barColor,
  fadeEdges = true,
  fadeWidth = 24,
  barHeight: baseBarHeight = 4,
  height = 64,
  sensitivity = 1,
  smoothingTimeConstant = 0.8,
  fftSize = 256,
  historySize = 60,
  updateRate = 30,
  mode = "static",
  className,
  ...props
}: LiveWaveformProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const historyRef = useRef<number[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationRef = useRef<number>(0);
  const lastUpdateRef = useRef<number>(0);
  const processingAnimationRef = useRef<number | null>(null);
  const lastActiveDataRef = useRef<number[]>([]);
  const transitionProgressRef = useRef(0);
  const staticBarsRef = useRef<number[]>([]);
  const needsRedrawRef = useRef(true);
  const gradientCacheRef = useRef<CanvasGradient | null>(null);
  const lastWidthRef = useRef(0);

  const heightStyle = typeof height === "number" ? `${height}px` : height;

  // Handle canvas resizing
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resizeObserver = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(dpr, dpr);
      }

      gradientCacheRef.current = null;
      lastWidthRef.current = rect.width;
      needsRedrawRef.current = true;
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  // Processing animation
  useEffect(() => {
    if (processing && !active) {
      let time = 0;
      transitionProgressRef.current = 0;

      const animateProcessing = () => {
        time += 0.03;
        transitionProgressRef.current = Math.min(
          1,
          transitionProgressRef.current + 0.02,
        );

        const processingData: number[] = [];
        const barCount = Math.floor(
          (containerRef.current?.getBoundingClientRect().width || 200) /
            (barWidth + barGap),
        );

        if (mode === "static") {
          const halfCount = Math.floor(barCount / 2);
          for (let i = 0; i < barCount; i++) {
            const normalizedPosition = (i - halfCount) / halfCount;
            const centerWeight = 1 - Math.abs(normalizedPosition) * 0.4;
            const wave1 =
              Math.sin(time * 1.5 + normalizedPosition * 3) * 0.25;
            const wave2 =
              Math.sin(time * 0.8 - normalizedPosition * 2) * 0.2;
            const wave3 = Math.cos(time * 2 + normalizedPosition) * 0.15;
            const combinedWave = wave1 + wave2 + wave3;
            const processingValue = (0.2 + combinedWave) * centerWeight;

            let finalValue = processingValue;
            if (
              lastActiveDataRef.current.length > 0 &&
              transitionProgressRef.current < 1
            ) {
              const lastDataIndex = Math.min(
                i,
                lastActiveDataRef.current.length - 1,
              );
              const lastValue = lastActiveDataRef.current[lastDataIndex] || 0;
              finalValue =
                lastValue * (1 - transitionProgressRef.current) +
                processingValue * transitionProgressRef.current;
            }
            processingData.push(Math.max(0.05, Math.min(1, finalValue)));
          }
        } else {
          for (let i = 0; i < barCount; i++) {
            const normalizedPosition = (i - barCount / 2) / (barCount / 2);
            const centerWeight = 1 - Math.abs(normalizedPosition) * 0.4;
            const wave1 = Math.sin(time * 1.5 + i * 0.15) * 0.25;
            const wave2 = Math.sin(time * 0.8 - i * 0.1) * 0.2;
            const wave3 = Math.cos(time * 2 + i * 0.05) * 0.15;
            const combinedWave = wave1 + wave2 + wave3;
            const processingValue = (0.2 + combinedWave) * centerWeight;

            let finalValue = processingValue;
            if (
              lastActiveDataRef.current.length > 0 &&
              transitionProgressRef.current < 1
            ) {
              const lastDataIndex = Math.floor(
                (i / barCount) * lastActiveDataRef.current.length,
              );
              const lastValue = lastActiveDataRef.current[lastDataIndex] || 0;
              finalValue =
                lastValue * (1 - transitionProgressRef.current) +
                processingValue * transitionProgressRef.current;
            }
            processingData.push(Math.max(0.05, Math.min(1, finalValue)));
          }
        }

        if (mode === "static") {
          staticBarsRef.current = processingData;
        } else {
          historyRef.current = processingData;
        }

        needsRedrawRef.current = true;
        processingAnimationRef.current =
          requestAnimationFrame(animateProcessing);
      };

      animateProcessing();
      return () => {
        if (processingAnimationRef.current) {
          cancelAnimationFrame(processingAnimationRef.current);
        }
      };
    } else if (!active && !processing) {
      const hasData =
        mode === "static"
          ? staticBarsRef.current.length > 0
          : historyRef.current.length > 0;

      if (hasData) {
        let fadeProgress = 0;
        const fadeToIdle = () => {
          fadeProgress += 0.03;
          if (fadeProgress < 1) {
            if (mode === "static") {
              staticBarsRef.current = staticBarsRef.current.map(
                (value) => value * (1 - fadeProgress),
              );
            } else {
              historyRef.current = historyRef.current.map(
                (value) => value * (1 - fadeProgress),
              );
            }
            needsRedrawRef.current = true;
            requestAnimationFrame(fadeToIdle);
          } else {
            if (mode === "static") {
              staticBarsRef.current = [];
            } else {
              historyRef.current = [];
            }
          }
        };
        fadeToIdle();
      }
    }
  }, [processing, active, barWidth, barGap, mode]);

  // Connect external MediaStream to analyser (no mic request)
  useEffect(() => {
    if (!active || !mediaStream) {
      if (
        audioContextRef.current &&
        audioContextRef.current.state !== "closed"
      ) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      analyserRef.current = null;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = 0;
      }
      return;
    }

    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = fftSize;
    analyser.smoothingTimeConstant = smoothingTimeConstant;

    const source = audioContext.createMediaStreamSource(mediaStream);
    source.connect(analyser);

    audioContextRef.current = audioContext;
    analyserRef.current = analyser;
    historyRef.current = [];

    return () => {
      source.disconnect();
      if (audioContext.state !== "closed") {
        audioContext.close();
      }
      audioContextRef.current = null;
      analyserRef.current = null;
    };
  }, [active, mediaStream, fftSize, smoothingTimeConstant]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId: number;

    const animate = (currentTime: number) => {
      const rect = canvas.getBoundingClientRect();

      if (active && currentTime - lastUpdateRef.current > updateRate) {
        lastUpdateRef.current = currentTime;

        if (analyserRef.current) {
          const dataArray = new Uint8Array(
            analyserRef.current.frequencyBinCount,
          );
          analyserRef.current.getByteFrequencyData(dataArray);

          if (mode === "static") {
            const startFreq = Math.floor(dataArray.length * 0.05);
            const endFreq = Math.floor(dataArray.length * 0.4);
            const relevantData = dataArray.slice(startFreq, endFreq);

            const barCount = Math.floor(rect.width / (barWidth + barGap));
            const halfCount = Math.floor(barCount / 2);
            const newBars: number[] = [];

            for (let i = halfCount - 1; i >= 0; i--) {
              const dataIndex = Math.floor(
                (i / halfCount) * relevantData.length,
              );
              const value = Math.min(
                1,
                (relevantData[dataIndex] / 255) * sensitivity,
              );
              newBars.push(Math.max(0.05, value));
            }

            for (let i = 0; i < halfCount; i++) {
              const dataIndex = Math.floor(
                (i / halfCount) * relevantData.length,
              );
              const value = Math.min(
                1,
                (relevantData[dataIndex] / 255) * sensitivity,
              );
              newBars.push(Math.max(0.05, value));
            }

            staticBarsRef.current = newBars;
            lastActiveDataRef.current = newBars;
          } else {
            let sum = 0;
            const startFreq = Math.floor(dataArray.length * 0.05);
            const endFreq = Math.floor(dataArray.length * 0.4);
            const relevantData = dataArray.slice(startFreq, endFreq);

            for (let i = 0; i < relevantData.length; i++) {
              sum += relevantData[i];
            }
            const average = (sum / relevantData.length / 255) * sensitivity;

            historyRef.current.push(Math.min(1, Math.max(0.05, average)));
            lastActiveDataRef.current = [...historyRef.current];

            if (historyRef.current.length > historySize) {
              historyRef.current.shift();
            }
          }
          needsRedrawRef.current = true;
        }
      }

      if (!needsRedrawRef.current && !active) {
        rafId = requestAnimationFrame(animate);
        return;
      }

      needsRedrawRef.current = active;
      ctx.clearRect(0, 0, rect.width, rect.height);

      const computedBarColor =
        barColor ||
        (() => {
          const style = getComputedStyle(canvas);
          return style.color || getComputedStyle(document.documentElement).getPropertyValue("--color-foreground").trim() || "currentColor";
        })();

      const step = barWidth + barGap;
      const barCount = Math.floor(rect.width / step);
      const centerY = rect.height / 2;

      if (mode === "static") {
        const dataToRender =
          staticBarsRef.current.length > 0 ? staticBarsRef.current : [];

        for (let i = 0; i < barCount && i < dataToRender.length; i++) {
          const value = dataToRender[i] || 0.1;
          const x = i * step;
          const bh = Math.max(baseBarHeight, value * rect.height * 0.8);
          const y = centerY - bh / 2;

          ctx.fillStyle = computedBarColor;
          ctx.globalAlpha = 0.4 + value * 0.6;

          if (barRadius > 0) {
            ctx.beginPath();
            ctx.roundRect(x, y, barWidth, bh, barRadius);
            ctx.fill();
          } else {
            ctx.fillRect(x, y, barWidth, bh);
          }
        }
      } else {
        for (let i = 0; i < barCount && i < historyRef.current.length; i++) {
          const dataIndex = historyRef.current.length - 1 - i;
          const value = historyRef.current[dataIndex] || 0.1;
          const x = rect.width - (i + 1) * step;
          const bh = Math.max(baseBarHeight, value * rect.height * 0.8);
          const y = centerY - bh / 2;

          ctx.fillStyle = computedBarColor;
          ctx.globalAlpha = 0.4 + value * 0.6;

          if (barRadius > 0) {
            ctx.beginPath();
            ctx.roundRect(x, y, barWidth, bh, barRadius);
            ctx.fill();
          } else {
            ctx.fillRect(x, y, barWidth, bh);
          }
        }
      }

      if (fadeEdges && fadeWidth > 0 && rect.width > 0) {
        if (
          !gradientCacheRef.current ||
          lastWidthRef.current !== rect.width
        ) {
          const gradient = ctx.createLinearGradient(0, 0, rect.width, 0);
          const fadePercent = Math.min(0.3, fadeWidth / rect.width);

          gradient.addColorStop(0, "rgba(255,255,255,1)");
          gradient.addColorStop(fadePercent, "rgba(255,255,255,0)");
          gradient.addColorStop(1 - fadePercent, "rgba(255,255,255,0)");
          gradient.addColorStop(1, "rgba(255,255,255,1)");

          gradientCacheRef.current = gradient;
          lastWidthRef.current = rect.width;
        }

        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = gradientCacheRef.current;
        ctx.fillRect(0, 0, rect.width, rect.height);
        ctx.globalCompositeOperation = "source-over";
      }

      ctx.globalAlpha = 1;
      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [
    active,
    processing,
    sensitivity,
    updateRate,
    historySize,
    barWidth,
    baseBarHeight,
    barGap,
    barRadius,
    barColor,
    fadeEdges,
    fadeWidth,
    mode,
  ]);

  return (
    <div
      ref={containerRef}
      className={cn("relative w-full overflow-hidden", className)}
      style={{ height: heightStyle }}
      {...props}
    >
      {!active && !processing && (
        <div className="absolute inset-0 flex items-center justify-center" />
      )}
      <canvas ref={canvasRef} className="absolute inset-0 text-foreground" />
    </div>
  );
};
