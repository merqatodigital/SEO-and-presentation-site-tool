import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Check,
} from 'lucide-react';
import {
  ScreenshotAsset,
  WalkthroughData,
  WalkthroughScene,
  calculateSceneDurationSec,
  countWords,
} from '../types/tour';

interface WalkthroughPlayerProps {
  walkthrough: WalkthroughData;
  screenshots: ScreenshotAsset[];
  brandColor: string;
  onUpdateScene: (index: number, next: WalkthroughScene) => void;
}

export const WalkthroughPlayer: React.FC<WalkthroughPlayerProps> = ({
  walkthrough,
  screenshots,
  brandColor,
  onUpdateScene,
}) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [sceneProgress, setSceneProgress] = useState(0); // 0 to 1
  const [editingScene, setEditingScene] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);

  const scenes = walkthrough.scenes;
  const safeIndex = Math.min(activeIndex, Math.max(0, scenes.length - 1));
  const currentScene = scenes[safeIndex];

  const sceneDurations = useMemo(
    () => scenes.map((s) => calculateSceneDurationSec(s.narration)),
    [scenes]
  );

  const totalDuration = useMemo(
    () => sceneDurations.reduce((acc, d) => acc + d, 0),
    [sceneDurations]
  );

  const elapsedTotal = useMemo(() => {
    const prior = sceneDurations.slice(0, safeIndex).reduce((acc, d) => acc + d, 0);
    const currentDur = sceneDurations[safeIndex] || 5;
    return prior + currentDur * sceneProgress;
  }, [sceneDurations, safeIndex, sceneProgress]);

  // Reset to first scene whenever a brand-new walkthrough title loads
  useEffect(() => {
    setActiveIndex(0);
    setSceneProgress(0);
    setIsPlaying(true);
    setEditingScene(false);
  }, [walkthrough.title]);

  // Smooth 60fps progress & slow zoom driver based on 150 WPM narration duration
  useEffect(() => {
    if (!isPlaying || editingScene || scenes.length === 0) return;

    const currentDurationMs = (sceneDurations[safeIndex] || 5) * 1000;
    let frameId = 0;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const delta = now - lastTime;
      lastTime = now;

      setSceneProgress((prev) => {
        const next = prev + delta / currentDurationMs;
        if (next >= 1) {
          if (safeIndex < scenes.length - 1) {
            setActiveIndex(safeIndex + 1);
            return 0;
          } else {
            setIsPlaying(false);
            return 1;
          }
        }
        return next;
      });

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [isPlaying, editingScene, safeIndex, scenes.length, sceneDurations]);

  if (!currentScene || screenshots.length === 0) {
    return null;
  }

  const shotIndex = Math.min(
    Math.max(0, currentScene.screenshotIndex),
    screenshots.length - 1
  );
  const activeScreenshot = screenshots[shotIndex];

  const highlight = currentScene.highlight;
  const centerX = Math.min(96, Math.max(4, highlight.x + highlight.w / 2));
  const centerY = Math.min(96, Math.max(4, highlight.y + highlight.h / 2));

  // Ease-in-out slow zoom from 1.0 to 1.3
  const easedZoom = 1 + 0.3 * (sceneProgress < 0.5 ? 2 * sceneProgress * sceneProgress : 1 - Math.pow(-2 * sceneProgress + 2, 2) / 2);

  const selectScene = (idx: number, autoPlay = true) => {
    setActiveIndex(idx);
    setSceneProgress(0);
    if (autoPlay && !editingScene) {
      setIsPlaying(true);
    }
  };

  const handleRestart = () => {
    setActiveIndex(0);
    setSceneProgress(0);
    setIsPlaying(true);
  };

  const handleStageClickToPlace = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!editingScene || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * 100;
    const clickY = ((e.clientY - rect.top) / rect.height) * 100;
    const newX = Math.max(0, Math.min(100 - highlight.w, Math.round(clickX - highlight.w / 2)));
    const newY = Math.max(0, Math.min(100 - highlight.h, Math.round(clickY - highlight.h / 2)));
    onUpdateScene(safeIndex, {
      ...currentScene,
      highlight: { ...highlight, x: newX, y: newY },
    });
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const wordCount = countWords(currentScene.narration);
  const currentDur = sceneDurations[safeIndex] || 5;

  return (
    <section id="walkthrough" className="no-print scroll-mt-20">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-wide text-slate-500 dark:text-slate-400">
            Interactive Client Walkthrough · {scenes.length} Scenes · {Math.round(totalDuration)}s total
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 [text-wrap:balance]">
            {walkthrough.title}
          </h2>
        </div>

        <button
          type="button"
          onClick={() => {
            setEditingScene((prev) => {
              const next = !prev;
              if (next) setIsPlaying(false);
              return next;
            });
          }}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
            editingScene
              ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
          }`}
        >
          {editingScene ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
          {editingScene ? 'Done editing scene' : 'Edit scene'}
        </button>
      </div>

      {/* Full-width cinematic stage */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-950 shadow-sm dark:border-slate-800">
        <div
          ref={stageRef}
          onClick={handleStageClickToPlace}
          className={`relative aspect-[16/10] w-full overflow-hidden bg-slate-950 select-none ${
            editingScene ? 'cursor-crosshair' : ''
          }`}
        >
          {/* Zooming Canvas Layer (1.0 -> 1.3) */}
          <div
            className="relative h-full w-full will-change-transform"
            style={{
              transform: `scale(${editingScene ? 1 : easedZoom})`,
              transformOrigin: `${centerX}% ${centerY}%`,
              transition: editingScene ? 'transform 220ms ease-out' : 'none',
            }}
          >
            <img
              src={activeScreenshot.dataUrl}
              alt={currentScene.caption}
              className="h-full w-full object-contain bg-slate-900"
              draggable={false}
            />

            {/* Highlight Ring & Spotlight Mask */}
            <motion.div
              key={`ring-${safeIndex}`}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              style={{
                left: `${highlight.x}%`,
                top: `${highlight.y}%`,
                width: `${highlight.w}%`,
                height: `${highlight.h}%`,
                borderColor: brandColor,
                boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.32)',
              }}
              className="pointer-events-none absolute rounded-lg border-[3px] ring-2 ring-white/80"
            />

            {/* Smooth Gliding Cursor */}
            <motion.div
              animate={{
                left: `${centerX}%`,
                top: `${centerY}%`,
              }}
              transition={{
                duration: 0.95,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="pointer-events-none absolute z-20 -translate-x-1 -translate-y-1"
            >
              {/* Arrival pulse ring on target */}
              <motion.span
                key={`pulse-${safeIndex}`}
                initial={{ opacity: 0.75, scale: 0.4 }}
                animate={{ opacity: 0, scale: 1.9 }}
                transition={{ delay: 0.75, duration: 0.9, ease: 'easeOut' }}
                style={{ borderColor: brandColor }}
                className="absolute -left-3 -top-3 h-8 w-8 rounded-full border-2"
              />
              <svg
                width="28"
                height="28"
                viewBox="0 0 28 28"
                fill="none"
                aria-hidden="true"
                className="drop-shadow-[0_3px_8px_rgba(0,0,0,0.45)]"
              >
                <path
                  d="M4.5 3.5L11.2 23.2L14.4 15.1L22.5 11.9L4.5 3.5Z"
                  fill="#0F172A"
                  stroke="#FFFFFF"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
              </svg>
            </motion.div>
          </div>

          {editingScene && (
            <div className="pointer-events-none absolute left-4 top-4 z-30 rounded-md bg-slate-950/85 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-xs">
              Click anywhere on the screenshot to move the highlight target
            </div>
          )}

          {/* Measured Contrast Scrim Caption Bar at Bottom */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-slate-950/95 via-slate-950/80 to-transparent px-5 pb-5 pt-14 sm:px-8 sm:pb-6">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-300 tabular-nums">
              <span>
                Scene {safeIndex + 1} of {scenes.length}
              </span>
              <span aria-hidden="true">·</span>
              <span>{wordCount} words</span>
              <span aria-hidden="true">·</span>
              <span>{currentDur.toFixed(1)}s</span>
              {currentScene.findingRefs && currentScene.findingRefs.length > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Audit evidence: {currentScene.findingRefs.join(', ')}</span>
                </>
              )}
              {currentScene.needsReview && (
                <span className="rounded border border-amber-400/70 bg-amber-950/80 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
                  Check numbers
                </span>
              )}
            </div>
            <p className="mt-1 text-lg font-semibold tracking-tight text-white sm:text-xl [text-wrap:balance]">
              {currentScene.caption}
            </p>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-200 sm:text-base">
              {currentScene.narration}
            </p>
          </div>
        </div>

        {/* Controls & Interactive Progress Bar */}
        <div className="border-t border-slate-800 bg-slate-900 px-4 py-3 text-slate-100 sm:px-6">
          {/* Segmented Progress Bar */}
          <div
            className="mb-3 flex h-2 w-full gap-1 overflow-hidden rounded-full bg-slate-800"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={Math.round(totalDuration)}
            aria-valuenow={Math.round(elapsedTotal)}
          >
            {scenes.map((_, idx) => {
              const segWeight = sceneDurations[idx] / Math.max(0.1, totalDuration);
              const fillPct =
                idx < safeIndex ? 100 : idx === safeIndex ? Math.min(100, sceneProgress * 100) : 0;

              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => selectScene(idx, isPlaying)}
                  aria-label={`Jump to scene ${idx + 1}`}
                  style={{ width: `${segWeight * 100}%` }}
                  className="relative h-full bg-slate-700/70 transition-opacity hover:opacity-90 focus:outline-none"
                >
                  <span
                    className="block h-full transition-none"
                    style={{
                      width: `${fillPct}%`,
                      backgroundColor: brandColor,
                    }}
                  />
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsPlaying((p) => !p)}
                aria-label={isPlaying ? 'Pause walkthrough' : 'Play walkthrough'}
                style={{ backgroundColor: brandColor }}
                className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-95 whitespace-nowrap shrink-0"
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                <span>{isPlaying ? 'Pause' : 'Play'}</span>
              </button>

              <button
                type="button"
                onClick={() => selectScene(Math.max(0, safeIndex - 1), isPlaying)}
                disabled={safeIndex === 0}
                aria-label="Previous scene"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700 disabled:opacity-40 whitespace-nowrap shrink-0"
              >
                <ChevronLeft className="h-4 w-4" />
                <span className="hidden sm:inline">Previous</span>
              </button>

              <button
                type="button"
                onClick={() => selectScene(Math.min(scenes.length - 1, safeIndex + 1), isPlaying)}
                disabled={safeIndex >= scenes.length - 1}
                aria-label="Next scene"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700 disabled:opacity-40 whitespace-nowrap shrink-0"
              >
                <span className="hidden sm:inline">Next</span>
                <ChevronRight className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={handleRestart}
                aria-label="Restart walkthrough"
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white whitespace-nowrap shrink-0"
              >
                <RotateCcw className="h-4 w-4" />
                <span className="hidden md:inline">Restart</span>
              </button>
            </div>

            <div className="text-xs font-medium text-slate-400 tabular-nums">
              {formatTime(elapsedTotal)} / {formatTime(totalDuration)} · 150 WPM autoplay
            </div>
          </div>
        </div>
      </div>

      {/* Inline Scene Editor Panel */}
      {editingScene && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          {currentScene.needsReview && (
            <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
              <div className="flex items-center gap-2">
                <span className="rounded border border-amber-400 bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:border-amber-700 dark:bg-amber-900 dark:text-amber-100">
                  Check numbers
                </span>
                <span>Verify any figures in this scene against your audit evidence.</span>
              </div>
              <button
                type="button"
                onClick={() =>
                  onUpdateScene(safeIndex, { ...currentScene, needsReview: false })
                }
                className="text-xs font-semibold underline underline-offset-4 hover:opacity-80 whitespace-nowrap"
              >
                Mark checked
              </button>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="md:col-span-5">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                Outcome Caption
              </label>
              <input
                type="text"
                value={currentScene.caption}
                onChange={(e) =>
                  onUpdateScene(safeIndex, { ...currentScene, caption: e.target.value })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <div className="md:col-span-3">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                Screenshot
              </label>
              <select
                value={shotIndex}
                onChange={(e) =>
                  onUpdateScene(safeIndex, {
                    ...currentScene,
                    screenshotIndex: Number(e.target.value),
                  })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                {screenshots.map((s, idx) => (
                  <option key={s.id} value={idx}>
                    Screen {idx + 1}: {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2 md:col-span-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Highlight Width (%)
                </label>
                <input
                  type="number"
                  min={5}
                  max={100}
                  value={Math.round(highlight.w)}
                  onChange={(e) =>
                    onUpdateScene(safeIndex, {
                      ...currentScene,
                      highlight: {
                        ...highlight,
                        w: Math.max(5, Math.min(100, Number(e.target.value) || 20)),
                      },
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Highlight Height (%)
                </label>
                <input
                  type="number"
                  min={5}
                  max={100}
                  value={Math.round(highlight.h)}
                  onChange={(e) =>
                    onUpdateScene(safeIndex, {
                      ...currentScene,
                      highlight: {
                        ...highlight,
                        h: Math.max(5, Math.min(100, Number(e.target.value) || 20)),
                      },
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="md:col-span-12">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                Narration Line (max 30 words recommended)
              </label>
              <textarea
                rows={2}
                value={currentScene.narration}
                onChange={(e) =>
                  onUpdateScene(safeIndex, { ...currentScene, narration: e.target.value })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>
        </div>
      )}

      {/* Chapter List */}
      <div className="mt-5">
        <div className="mb-2.5 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Chapters</h3>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Select any chapter to inspect
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {scenes.map((scene, idx) => {
            const thumbIdx = Math.min(Math.max(0, scene.screenshotIndex), screenshots.length - 1);
            const thumb = screenshots[thumbIdx];
            const isActive = idx === safeIndex;
            const dur = sceneDurations[idx];

            return (
              <button
                key={idx}
                type="button"
                onClick={() => selectScene(idx, true)}
                style={isActive ? { borderColor: brandColor } : undefined}
                className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                  isActive
                    ? 'bg-white shadow-xs dark:bg-slate-900'
                    : 'border-slate-200 bg-white/70 hover:border-slate-300 hover:bg-white dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-slate-700 dark:hover:bg-slate-900'
                }`}
              >
                <img
                  src={thumb.dataUrl}
                  alt={`Chapter ${idx + 1}`}
                  className="h-12 w-18 shrink-0 rounded border border-slate-200 object-cover object-top dark:border-slate-700"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      0{idx + 1}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{dur.toFixed(1)}s</span>
                    {scene.needsReview && (
                      <span className="ml-auto rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                        Check numbers
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs font-medium leading-snug text-slate-800 dark:text-slate-200">
                    {scene.caption}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
};
