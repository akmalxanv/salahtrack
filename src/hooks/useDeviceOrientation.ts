'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { TiltStatus, TurnGuidance } from '@/types/qibla';
import {
  unwrapAngle,
  adaptiveCircularEma,
  applyDeadband,
  computeTiltMetrics,
  calculateTurnGuidance,
  normalizeAngle,
  compensateScreenOrientation,
  getScreenOrientationAngle,
  shouldTriggerHaptic,
  triggerHapticFeedback,
  DEFAULT_DEADBAND_THRESHOLD,
  DEFAULT_ALIGNMENT_TOLERANCE,
} from '@/lib/qibla';

export type PermissionState = 'prompt' | 'granted' | 'denied' | 'unsupported';

export interface UseDeviceOrientationOptions {
  qiblaBearing: number;
  initialSimulatedHeading?: number | null;
  throttleMs?: number;
  deadbandThreshold?: number;
  alignmentTolerance?: number;
}

export interface UseDeviceOrientationReturn {
  // Throttled React State (5-10Hz) for semantic badges, labels, and accessibility
  heading: number;
  rawHeading: number | null;
  turnGuidance: TurnGuidance;
  tiltMetrics: {
    tiltMagnitude: number;
    tiltStatus: TiltStatus;
    bubbleX: number;
    bubbleY: number;
  };
  isAligned: boolean;
  permissionState: PermissionState;
  isSensorAvailable: boolean | null;
  isSecureContext: boolean;
  isSimulating: boolean;

  // Manual simulation controls (desktop testing / manual fallback)
  simulatedHeading: number | null;
  setSimulatedHeading: (heading: number | null) => void;

  // Permissions
  requestPermission: () => Promise<boolean>;

  // Direct DOM Element Refs for 60/120fps direct hardware-accelerated transforms
  dialRef: React.RefObject<HTMLDivElement | null>;
  needleRef: React.RefObject<HTMLDivElement | null>;

  // Continuous smoothed angles for reactive fallbacks
  unwrappedDialAngle: number;
  unwrappedNeedleAngle: number;
}

const DEFAULT_THROTTLE_MS = 100; // 10Hz updates for React UI state
const HAPTIC_DEBOUNCE_MS = 1000; // Minimum interval between discrete re-entries

export function useDeviceOrientation({
  qiblaBearing,
  initialSimulatedHeading = null,
  throttleMs = DEFAULT_THROTTLE_MS,
  deadbandThreshold = DEFAULT_DEADBAND_THRESHOLD,
  alignmentTolerance = DEFAULT_ALIGNMENT_TOLERANCE,
}: UseDeviceOrientationOptions): UseDeviceOrientationReturn {
  // Direct DOM Refs for buttery smooth 60fps transform updates without re-renders
  const dialRef = useRef<HTMLDivElement | null>(null);
  const needleRef = useRef<HTMLDivElement | null>(null);

  // Raw sensor values stored in refs to decouple from React rendering pipeline
  const rawHeadingRef = useRef<number | null>(null);
  const rawBetaRef = useRef<number | null>(null);
  const rawGammaRef = useRef<number | null>(null);
  const simulatedHeadingRef = useRef<number | null>(initialSimulatedHeading);

  // Absolute sensor detection & deconfliction tracking refs
  const hasReceivedAbsoluteRef = useRef<boolean>(false);
  const supportsAbsoluteApiRef = useRef<boolean>(false);

  // Filter & animation tracking refs
  const filteredHeadingRef = useRef<number>(initialSimulatedHeading ?? 0);
  const unwrappedDialRef = useRef<number>(0);
  const unwrappedNeedleRef = useRef<number>(qiblaBearing);
  const lastRafTimestampRef = useRef<number>(0);
  const lastThrottleTimestampRef = useRef<number>(0);
  const lastVibrateTimestampRef = useRef<number>(0);
  const wasAlignedRef = useRef<boolean>(false);
  const sensorEventFiredRef = useRef<boolean>(false);

  // React states (throttled to 5-10Hz for text readouts and semantic indicators)
  const [simulatedHeading, setSimulatedHeadingState] = useState<number | null>(initialSimulatedHeading);
  const [headingState, setHeadingState] = useState<number>(initialSimulatedHeading ?? 0);
  const [rawHeadingState, setRawHeadingState] = useState<number | null>(null);
  const [unwrappedDialAngleState, setUnwrappedDialAngleState] = useState<number>(0);
  const [unwrappedNeedleAngleState, setUnwrappedNeedleAngleState] = useState<number>(qiblaBearing);

  const [tiltMetricsState, setTiltMetricsState] = useState<{
    tiltMagnitude: number;
    tiltStatus: TiltStatus;
    bubbleX: number;
    bubbleY: number;
  }>({
    tiltMagnitude: 0,
    tiltStatus: 'LEVEL',
    bubbleX: 0,
    bubbleY: 0,
  });

  const [turnGuidanceState, setTurnGuidanceState] = useState<TurnGuidance>(() =>
    calculateTurnGuidance(initialSimulatedHeading ?? 0, qiblaBearing, alignmentTolerance)
  );

  const [isSensorAvailable, setIsSensorAvailable] = useState<boolean | null>(() => {
    if (typeof window !== 'undefined' && 'isSecureContext' in window && !window.isSecureContext) {
      return false;
    }
    return null;
  });

  const [permissionState, setPermissionState] = useState<PermissionState>(() => {
    if (typeof window === 'undefined') return 'prompt';
    if ('isSecureContext' in window && !window.isSecureContext) {
      return 'unsupported';
    }
    type DeviceOrientationEventWithPermission = {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    const DeviceOrientation = DeviceOrientationEvent as unknown as DeviceOrientationEventWithPermission;
    if (typeof DeviceOrientation?.requestPermission === 'function') {
      return 'prompt';
    }
    if ('DeviceOrientationEvent' in window) {
      return 'granted';
    }
    return 'unsupported';
  });

  // Sync simulated heading state with ref
  const setSimulatedHeading = useCallback((value: number | null) => {
    simulatedHeadingRef.current = value;
    setSimulatedHeadingState(value);
  }, []);

  // iOS Safari permission handler
  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (typeof window === 'undefined') return false;

    if ('isSecureContext' in window && !window.isSecureContext) {
      console.warn('DeviceOrientation requires a secure context (HTTPS).');
      setPermissionState('unsupported');
      setIsSensorAvailable(false);
      return false;
    }

    type DeviceOrientationEventWithPermission = {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };

    const DeviceOrientation = DeviceOrientationEvent as unknown as DeviceOrientationEventWithPermission;

    if (typeof DeviceOrientation.requestPermission === 'function') {
      try {
        const response = await DeviceOrientation.requestPermission();
        if (response === 'granted') {
          setPermissionState('granted');
          setIsSensorAvailable(true);
          return true;
        } else {
          setPermissionState('denied');
          setIsSensorAvailable(false);
          return false;
        }
      } catch (err) {
        console.warn('DeviceOrientation permission request failed:', err);
        setPermissionState('denied');
        setIsSensorAvailable(false);
        return false;
      }
    }

    // Permission API not needed (Android, desktop browsers)
    setPermissionState('granted');
    return true;
  }, []);

  // Sensor Event Listener Registration with Android deconfliction and screen orientation compensation
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if ('isSecureContext' in window && !window.isSecureContext) {
      return;
    }

    // Detect if device/browser exposes explicit absolute orientation API
    supportsAbsoluteApiRef.current =
      'ondeviceorientationabsolute' in window || 'DeviceOrientationAbsoluteEvent' in window;

    // 1. Dedicated Absolute Orientation Handler (Android Chrome deviceorientationabsolute)
    const handleAbsoluteOrientationEvent = (event: DeviceOrientationEvent) => {
      sensorEventFiredRef.current = true;
      hasReceivedAbsoluteRef.current = true;

      // Extract raw pitch and roll for 3D spirit level
      rawBetaRef.current = event.beta ?? null;
      rawGammaRef.current = event.gamma ?? null;

      const webkitHeading = (event as unknown as { webkitCompassHeading?: number }).webkitCompassHeading;
      if (typeof webkitHeading === 'number' && Number.isFinite(webkitHeading)) {
        const screenAngle = getScreenOrientationAngle();
        rawHeadingRef.current = compensateScreenOrientation(webkitHeading, screenAngle);
        setIsSensorAvailable(true);
        return;
      }

      if (typeof event.alpha === 'number' && Number.isFinite(event.alpha)) {
        const screenAngle = getScreenOrientationAngle();
        const heading = (360 - event.alpha) % 360;
        rawHeadingRef.current = compensateScreenOrientation(heading, screenAngle);
        setIsSensorAvailable(true);
      }
    };

    // 2. Standard Device Orientation Handler
    const handleStandardOrientationEvent = (event: DeviceOrientationEvent) => {
      sensorEventFiredRef.current = true;

      // Extract raw pitch and roll
      rawBetaRef.current = event.beta ?? null;
      rawGammaRef.current = event.gamma ?? null;

      // iOS Safari provides webkitCompassHeading directly (0 = North, clockwise, absolute)
      const webkitHeading = (event as unknown as { webkitCompassHeading?: number }).webkitCompassHeading;
      if (typeof webkitHeading === 'number' && Number.isFinite(webkitHeading)) {
        hasReceivedAbsoluteRef.current = true;
        const screenAngle = getScreenOrientationAngle();
        rawHeadingRef.current = compensateScreenOrientation(webkitHeading, screenAngle);
        setIsSensorAvailable(true);
        return;
      }

      // Android event with explicit absolute flag
      if (event.absolute === true) {
        hasReceivedAbsoluteRef.current = true;
        if (typeof event.alpha === 'number' && Number.isFinite(event.alpha)) {
          const screenAngle = getScreenOrientationAngle();
          const heading = (360 - event.alpha) % 360;
          rawHeadingRef.current = compensateScreenOrientation(heading, screenAngle);
          setIsSensorAvailable(true);
        }
        return;
      }

      // Deconfliction: Once an absolute event is received or the absolute API is active,
      // STRICTLY IGNORE non-absolute events for heading!
      // On Android Chrome, deviceorientation (relative) and deviceorientationabsolute (absolute)
      // fire in parallel at 60Hz. Ignoring non-absolute events prevents violent dial oscillation!
      if (hasReceivedAbsoluteRef.current || supportsAbsoluteApiRef.current) {
        return;
      }

      // Fallback relative heading only if absolute API is completely unsupported
      if (typeof event.alpha === 'number' && Number.isFinite(event.alpha)) {
        const screenAngle = getScreenOrientationAngle();
        const heading = (360 - event.alpha) % 360;
        rawHeadingRef.current = compensateScreenOrientation(heading, screenAngle);
        setIsSensorAvailable(true);
      }
    };

    // Screen orientation angle change listener (portrait <-> landscape)
    const handleScreenOrientationChange = () => {
      // Re-read orientation angle on display rotation
      if (rawHeadingRef.current !== null) {
        // Will be updated on subsequent 60fps raf tick or next sensor event
      }
    };

    // Attach listeners
    window.addEventListener('deviceorientation', handleStandardOrientationEvent, true);
    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener(
        'deviceorientationabsolute' as unknown as keyof WindowEventMap,
        handleAbsoluteOrientationEvent as EventListener,
        true
      );
    }

    if (window.screen?.orientation) {
      window.screen.orientation.addEventListener('change', handleScreenOrientationChange);
    } else {
      window.addEventListener('orientationchange', handleScreenOrientationChange);
    }

    // Fallback sensor availability check (1.5s grace window for unsupported devices)
    const timeoutId = window.setTimeout(() => {
      if (!sensorEventFiredRef.current && simulatedHeadingRef.current === null) {
        setIsSensorAvailable(false);
      }
    }, 1500);

    return () => {
      window.removeEventListener('deviceorientation', handleStandardOrientationEvent, true);
      if ('ondeviceorientationabsolute' in window) {
        window.removeEventListener(
          'deviceorientationabsolute' as unknown as keyof WindowEventMap,
          handleAbsoluteOrientationEvent as EventListener,
          true
        );
      }
      if (window.screen?.orientation) {
        window.screen.orientation.removeEventListener('change', handleScreenOrientationChange);
      } else {
        window.removeEventListener('orientationchange', handleScreenOrientationChange);
      }
      window.clearTimeout(timeoutId);
    };
  }, []);

  // High-Performance 60fps RequestAnimationFrame Animation & Damping Loop
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let rafId: number;

    const animateLoop = (timestamp: number) => {
      const dtSeconds =
        lastRafTimestampRef.current > 0
          ? Math.min(0.1, (timestamp - lastRafTimestampRef.current) / 1000)
          : 0.016;
      lastRafTimestampRef.current = timestamp;

      // Determine current target heading (simulation takes precedence if active)
      const targetHeading =
        simulatedHeadingRef.current !== null
          ? simulatedHeadingRef.current
          : rawHeadingRef.current;

      if (targetHeading !== null && Number.isFinite(targetHeading)) {
        // 1. Deadband filter on raw target to suppress stationary sensor noise (< deadbandThreshold, e.g. 1.2°)
        const gatedTarget = applyDeadband(
          filteredHeadingRef.current,
          targetHeading,
          deadbandThreshold
        );

        // 2. Velocity-Adaptive Circular EMA Filter
        const smoothed = adaptiveCircularEma(
          filteredHeadingRef.current,
          gatedTarget,
          dtSeconds
        );

        // 3. Second-stage deadband to prevent fractional EMA creep
        const stableHeading = applyDeadband(
          filteredHeadingRef.current,
          smoothed,
          deadbandThreshold
        );
        filteredHeadingRef.current = stableHeading;

        // 4. Continuous Angular Unwrapping for Jitter-Free 360°/0° Transitions
        const targetDial = -stableHeading;
        const targetNeedle = qiblaBearing - stableHeading;

        const nextDial = unwrapAngle(unwrappedDialRef.current, targetDial);
        const nextNeedle = unwrapAngle(unwrappedNeedleRef.current, targetNeedle);

        unwrappedDialRef.current = nextDial;
        unwrappedNeedleRef.current = nextNeedle;

        // 5. Direct Hardware-Accelerated DOM Transforms (60/120fps)
        if (dialRef.current) {
          dialRef.current.style.transform = `rotate(${nextDial}deg) translateZ(0)`;
        }
        if (needleRef.current) {
          needleRef.current.style.transform = `rotate(${nextNeedle}deg) translateZ(0)`;
        }
      }

      // 6. Throttled React State Update (10Hz) for text readouts and semantic indicators
      if (timestamp - lastThrottleTimestampRef.current >= throttleMs) {
        lastThrottleTimestampRef.current = timestamp;

        const normHeading = normalizeAngle(filteredHeadingRef.current);
        const roundedHeading = Math.round(normHeading * 10) / 10;
        const guidance = calculateTurnGuidance(roundedHeading, qiblaBearing, alignmentTolerance);
        const tilt = computeTiltMetrics(rawBetaRef.current, rawGammaRef.current);

        // Discrete edge-triggered haptic feedback:
        // Fires ONLY on the discrete edge transition from NOT aligned (!wasAlignedRef.current) to ALIGNED (guidance.isAligned).
        // While the user remains aligned in the green zone (+/- 3.5°), NEVER re-trigger vibration!
        // Only if the user moves out of alignment and re-enters the green zone can another pulse fire.
        const isActivelyReading =
          simulatedHeadingRef.current !== null ||
          (rawHeadingRef.current !== null && sensorEventFiredRef.current);
        const isLevel = tilt.tiltStatus !== 'EXCESSIVE_TILT';

        if (shouldTriggerHaptic(wasAlignedRef.current, guidance.isAligned, isActivelyReading, isLevel)) {
          const now = performance.now();
          if (now - lastVibrateTimestampRef.current >= HAPTIC_DEBOUNCE_MS) {
            lastVibrateTimestampRef.current = now;
            triggerHapticFeedback(30);
          }
        }

        // Maintain discrete aligned state
        wasAlignedRef.current = guidance.isAligned && isActivelyReading && isLevel;

        setHeadingState(roundedHeading);
        setRawHeadingState(rawHeadingRef.current);
        setTurnGuidanceState(guidance);
        setTiltMetricsState(tilt);
        setUnwrappedDialAngleState(unwrappedDialRef.current);
        setUnwrappedNeedleAngleState(unwrappedNeedleRef.current);
      }

      rafId = window.requestAnimationFrame(animateLoop);
    };

    rafId = window.requestAnimationFrame(animateLoop);

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [
    qiblaBearing,
    throttleMs,
    deadbandThreshold,
    alignmentTolerance,
  ]);

  return {
    heading: headingState,
    rawHeading: rawHeadingState,
    turnGuidance: turnGuidanceState,
    tiltMetrics: tiltMetricsState,
    isAligned: turnGuidanceState.isAligned,
    isSensorAvailable,
    permissionState,
    isSecureContext:
      typeof window !== 'undefined'
        ? 'isSecureContext' in window
          ? window.isSecureContext
          : true
        : true,
    isSimulating: simulatedHeading !== null,
    simulatedHeading,
    setSimulatedHeading,
    requestPermission,
    dialRef,
    needleRef,
    unwrappedDialAngle: unwrappedDialAngleState,
    unwrappedNeedleAngle: unwrappedNeedleAngleState,
  };
}
