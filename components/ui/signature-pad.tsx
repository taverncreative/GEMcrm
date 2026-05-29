"use client";

import { useRef, useEffect, useState, useCallback } from "react";

interface SignaturePadProps {
  label: string;
  onSignature: (dataUrl: string) => void;
  onClear: () => void;
}

/**
 * Canvas-based signature capture with pointer events (covers mouse + touch + pen).
 *
 * Why pointer events and not separate mouse/touch handlers:
 *   - Unified event model works on desktop, phones, tablets, styluses.
 *   - Eliminates mouse-then-touch double events that glitch drawing.
 *
 * Why ResizeObserver instead of a one-shot useEffect for sizing:
 *   - This component is often mounted inside a tab that starts with `display: none`.
 *     While hidden, getBoundingClientRect() returns 0×0 and the canvas is useless.
 *     When the tab becomes visible, ResizeObserver fires and we re-size + re-paint.
 *   - Fixes the bug where only the conditionally-mounted second signature worked.
 */
export function SignaturePad({ label, onSignature, onClear }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const [hasSignature, setHasSignature] = useState(false);

  const configureContext = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function resize() {
      if (!canvas || !ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const newW = Math.round(rect.width * dpr);
      const newH = Math.round(rect.height * dpr);
      // CRITICAL: assignment to `canvas.width` / `.height` clears the
      // bitmap (HTML5 spec). ResizeObserver fires on any sub-pixel
      // layout shift (mobile address-bar collapse, scroll-induced
      // viewport changes, sibling re-renders changing width by 1px).
      // Skip the assignment when dimensions already match — preserves
      // any in-progress signature across noop resizes. True resizes
      // (orientation change, window drag) still clear; the user would
      // need to re-sign in that rare case.
      if (canvas.width === newW && canvas.height === newH) return;
      canvas.width = newW;
      canvas.height = newH;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      configureContext(ctx);
    }

    resize();

    // ResizeObserver fires when the element transitions from 0×0 (hidden) to visible,
    // which is exactly the condition that was breaking signatures.
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [configureContext]);

  function getPos(e: React.PointerEvent): { x: number; y: number } | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pos = getPos(e);
    if (!pos) return;

    // Capture the pointer so we still get move/up events if the finger slides off-canvas.
    canvas.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    e.preventDefault();
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pos = getPos(e);
    if (!pos) return;
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // Safari occasionally throws "InvalidStateError" on release — safe to ignore.
    }
    drawingRef.current = false;
    setHasSignature(true);
    onSignature(canvas.toDataURL("image/png"));
  }

  function handleClear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    // clearRect uses the current transform (dpr-scaled), so passing rect dimensions
    // clears the full logical area.
    ctx.clearRect(0, 0, rect.width, rect.height);
    setHasSignature(false);
    onClear();
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-700">
          {label}
        </label>
        {hasSignature && (
          <button
            type="button"
            onClick={handleClear}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Clear
          </button>
        )}
      </div>
      <canvas
        ref={canvasRef}
        className="mt-1 h-32 w-full cursor-crosshair touch-none select-none rounded-lg border border-gray-300 bg-white"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      {!hasSignature && (
        <p className="mt-1 text-xs text-gray-400">Draw signature above</p>
      )}
    </div>
  );
}
