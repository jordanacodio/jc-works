'use client';

import { useEffect, useRef, useState } from 'react';
import type { NormalizedLandmark, PoseLandmarker as PoseLandmarkerType } from '@mediapipe/tasks-vision';

export type PoseSummary = {
  frames: number;
  minKneeAngle: number;
  maxElbowAngle: number;
  maxWristLift: number;
  averageTorsoLean: number;
  averageConfidence: number;
};

type LiveMetrics = {
  kneeAngle: number;
  elbowAngle: number;
  torsoLean: number;
  confidence: number;
};

type Props = {
  clip: 'make' | 'miss';
  cue: string;
  onTimeChange: (time: number) => void;
  onSummaryChange: (clip: 'make' | 'miss', summary: PoseSummary) => void;
};

const VIDEO_SOURCES = {
  make: '/free-throw-make.mp4?v=3',
  miss: '/free-throw-miss.mp4?v=3',
};

const VIDEO_POSTERS = {
  make: '/free-throw-make-poster.jpg',
  miss: '/free-throw-miss-poster.jpg',
};

const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm';
const MODEL_PATH = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const angle = (a: NormalizedLandmark, b: NormalizedLandmark, c: NormalizedLandmark) => {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const denominator = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);
  if (!denominator) return 0;
  const cosine = Math.max(-1, Math.min(1, (ab.x * cb.x + ab.y * cb.y) / denominator));
  return Math.acos(cosine) * (180 / Math.PI);
};

const rounded = (value: number) => Math.round(value);

export default function PoseTracker({ clip, cue, onTimeChange, onSummaryChange }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<PoseLandmarkerType | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const lastUiUpdateRef = useRef(0);
  const smoothedMetricsRef = useRef<LiveMetrics | null>(null);
  const smoothedLandmarksRef = useRef<NormalizedLandmark[] | null>(null);
  const accumulatorRef = useRef({ frames: 0, minKnee: 180, maxElbow: 0, maxWristLift: 0, torsoTotal: 0, confidenceTotal: 0 });
  const [status, setStatus] = useState<'loading' | 'ready' | 'tracking' | 'error'>('loading');
  const [metrics, setMetrics] = useState<LiveMetrics | null>(null);

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      try {
        const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
        const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
        let tracker: PoseLandmarkerType;
        try {
          tracker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
            runningMode: 'VIDEO',
            numPoses: 1,
            minPoseDetectionConfidence: 0.45,
            minPosePresenceConfidence: 0.45,
            minTrackingConfidence: 0.45,
          });
        } catch {
          tracker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
            runningMode: 'VIDEO',
            numPoses: 1,
          });
        }
        if (cancelled) return tracker.close();
        landmarkerRef.current = tracker;
        setStatus('ready');
      } catch {
        setStatus('error');
      }
    };
    initialize();
    return () => {
      cancelled = true;
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    accumulatorRef.current = { frames: 0, minKnee: 180, maxElbow: 0, maxWristLift: 0, torsoTotal: 0, confidenceTotal: 0 };
    smoothedMetricsRef.current = null;
    smoothedLandmarksRef.current = null;
    lastVideoTimeRef.current = -1;
    setMetrics(null);
    const context = canvasRef.current?.getContext('2d');
    if (context && canvasRef.current) context.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  }, [clip]);

  useEffect(() => {
    const render = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const landmarker = landmarkerRef.current;
      if (video && canvas && landmarker && video.readyState >= 2 && !video.paused && video.currentTime !== lastVideoTimeRef.current) {
        lastVideoTimeRef.current = video.currentTime;
        setStatus('tracking');
        onTimeChange(video.currentTime);
        const result = landmarker.detectForVideo(video, performance.now());
        const landmarks = result.landmarks[0];
        const context = canvas.getContext('2d');
        if (context) {
          canvas.width = video.videoWidth || 720;
          canvas.height = video.videoHeight || 1280;
          context.clearRect(0, 0, canvas.width, canvas.height);
          if (landmarks) {
            const previousLandmarks = smoothedLandmarksRef.current;
            const landmarkSmoothing = .18;
            const stableLandmarks = previousLandmarks ? landmarks.map((landmark, index) => {
              const previous = previousLandmarks[index];
              if (!previous) return landmark;
              return {
                ...landmark,
                x: previous.x + (landmark.x - previous.x) * landmarkSmoothing,
                y: previous.y + (landmark.y - previous.y) * landmarkSmoothing,
                z: previous.z + (landmark.z - previous.z) * landmarkSmoothing,
              };
            }) : landmarks;
            smoothedLandmarksRef.current = stableLandmarks;

            const rightShoulder = stableLandmarks[12];
            const rightElbow = stableLandmarks[14];
            const rightWrist = stableLandmarks[16];
            const rightHip = stableLandmarks[24];
            const rightKnee = stableLandmarks[26];
            const rightAnkle = stableLandmarks[28];
            const leftShoulder = stableLandmarks[11];
            const leftHip = stableLandmarks[23];
            const kneeAngle = angle(rightHip, rightKnee, rightAnkle);
            const elbowAngle = angle(rightShoulder, rightElbow, rightWrist);
            const shoulderMid = { x: (rightShoulder.x + leftShoulder.x) / 2, y: (rightShoulder.y + leftShoulder.y) / 2 };
            const hipMid = { x: (rightHip.x + leftHip.x) / 2, y: (rightHip.y + leftHip.y) / 2 };
            const torsoLean = Math.atan2(Math.abs(shoulderMid.x - hipMid.x), Math.abs(shoulderMid.y - hipMid.y)) * (180 / Math.PI);
            const wristLift = Math.max(0, rightShoulder.y - rightWrist.y);
            const confidencePoints = [rightShoulder, rightElbow, rightWrist, rightHip, rightKnee, rightAnkle];
            const confidence = confidencePoints.reduce((sum, point) => sum + (point.visibility ?? 1), 0) / confidencePoints.length;
            const rawMetrics = { kneeAngle, elbowAngle, torsoLean, confidence };
            const previous = smoothedMetricsRef.current;
            const smoothing = .22;
            const nextMetrics = previous ? {
              kneeAngle: previous.kneeAngle + (rawMetrics.kneeAngle - previous.kneeAngle) * smoothing,
              elbowAngle: previous.elbowAngle + (rawMetrics.elbowAngle - previous.elbowAngle) * smoothing,
              torsoLean: previous.torsoLean + (rawMetrics.torsoLean - previous.torsoLean) * smoothing,
              confidence: previous.confidence + (rawMetrics.confidence - previous.confidence) * smoothing,
            } : rawMetrics;
            smoothedMetricsRef.current = nextMetrics;

            const acc = accumulatorRef.current;
            const reliableFrame = confidence > .65 && nextMetrics.kneeAngle >= 85 && nextMetrics.kneeAngle <= 180 && nextMetrics.elbowAngle >= 35 && nextMetrics.elbowAngle <= 180;
            if (reliableFrame) {
              acc.frames += 1;
              acc.minKnee = Math.min(acc.minKnee, nextMetrics.kneeAngle);
              acc.maxElbow = Math.max(acc.maxElbow, nextMetrics.elbowAngle);
              acc.maxWristLift = Math.max(acc.maxWristLift, wristLift);
              acc.torsoTotal += torsoLean;
              acc.confidenceTotal += confidence;
            }

            if (performance.now() - lastUiUpdateRef.current > 750) {
              lastUiUpdateRef.current = performance.now();
              setMetrics(nextMetrics);
              if (acc.frames) {
                onSummaryChange(clip, {
                  frames: acc.frames,
                  minKneeAngle: acc.minKnee,
                  maxElbowAngle: acc.maxElbow,
                  maxWristLift: acc.maxWristLift,
                  averageTorsoLean: acc.torsoTotal / acc.frames,
                  averageConfidence: acc.confidenceTotal / acc.frames,
                });
              }
            }
          }
        }
      }
      frameRef.current = requestAnimationFrame(render);
    };
    frameRef.current = requestAnimationFrame(render);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [clip, onSummaryChange, onTimeChange]);

  return <>
    <div className="pose-video-stage">
      <video ref={videoRef} key={clip} controls muted playsInline preload="auto" poster={VIDEO_POSTERS[clip]} crossOrigin="anonymous" src={VIDEO_SOURCES[clip]} onPause={() => status !== 'error' && setStatus('ready')} />
      <canvas ref={canvasRef} aria-hidden="true" />
      <div className="pose-status" data-status={status}><span></span>{status === 'loading' ? 'Loading motion analysis' : status === 'ready' ? 'Ready — press play' : status === 'tracking' ? 'Analyzing shooting motion' : 'Motion analysis unavailable'}</div>
      <div className="video-cue"><small>JC WORKS CUE</small><strong>{cue}</strong></div>
    </div>
    <div className="live-metrics" aria-live="polite">
      <div><small>RIGHT KNEE</small><strong>{metrics ? `${rounded(metrics.kneeAngle)}°` : '—'}</strong><span>Smoothed movement estimate</span></div>
      <div><small>RIGHT ELBOW</small><strong>{metrics ? `${rounded(metrics.elbowAngle)}°` : '—'}</strong><span>Smoothed movement estimate</span></div>
      <div><small>HAND PATH</small><strong>{clip === 'make' ? 'Centered' : 'Right → center'}</strong><span>Observed release path</span></div>
      <div><small>POSE QUALITY</small><strong>{metrics ? metrics.confidence >= .8 ? 'Strong' : metrics.confidence >= .65 ? 'Good' : 'Low' : '—'}</strong><span>Based on visible body joints</span></div>
    </div>
  </>;
}
