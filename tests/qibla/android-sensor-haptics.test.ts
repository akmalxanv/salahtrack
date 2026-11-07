import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  compensateScreenOrientation,
  extractCompassHeading,
  shouldTriggerHaptic,
  triggerHapticFeedback,
  applyDeadband,
  adaptiveCircularEma,
  DEFAULT_DEADBAND_THRESHOLD,
  type RawOrientationInput,
} from '../../src/lib/qibla.ts';

describe('Requirement 13: Android Compass Instability, Screen Compensation & Haptics Regression Suite', () => {
  // =========================================================================
  // 1. Android Absolute Event Prioritization Over Relative Events
  // =========================================================================
  describe('1. Android Absolute Event Prioritization Over Relative Events', () => {
    it('prioritizes absolute orientation events and ignores interleaved relative events', () => {
      // Simulation of Android Chrome event stream:
      // Both deviceorientation (relative) and deviceorientationabsolute (absolute) fire in parallel at 60Hz.
      // - Relative event sends alpha = 120° (relative heading = 240°) with absolute: false
      // - Absolute event sends alpha = 20° (true heading = 340°) with absolute: true

      let hasReceivedAbsolute = false;
      const supportsAbsoluteApi = true;
      let authoritativeHeading: number | null = null;

      const processEvent = (event: RawOrientationInput) => {
        const isAbsolute =
          (typeof event.webkitCompassHeading === 'number' && Number.isFinite(event.webkitCompassHeading)) ||
          event.absolute === true ||
          event.type === 'deviceorientationabsolute';

        if (isAbsolute) {
          hasReceivedAbsolute = true;
          authoritativeHeading = extractCompassHeading(event, 0);
          return;
        }

        // Deconfliction guard: ignore non-absolute events once absolute events are active or supported
        if (hasReceivedAbsolute || supportsAbsoluteApi) {
          return;
        }

        // Fallback relative heading
        authoritativeHeading = extractCompassHeading(event, 0);
      };

      // Frame 1: Relative event arrives first
      processEvent({ type: 'deviceorientation', alpha: 120, absolute: false });
      assert.equal(
        authoritativeHeading,
        null,
        'Relative event must not set heading when absolute API is supported'
      );

      // Frame 2: Absolute event arrives
      processEvent({ type: 'deviceorientationabsolute', alpha: 20, absolute: true });
      assert.equal(
        authoritativeHeading,
        340,
        'Absolute event must set authoritative magnetic heading (360 - 20 = 340°)'
      );
      assert.equal(hasReceivedAbsolute, true);

      // Frame 3: Relative event arrives interleaved 8ms later
      processEvent({ type: 'deviceorientation', alpha: 120, absolute: false });
      assert.equal(
        authoritativeHeading,
        340,
        'Relative event must be strictly ignored: heading must NOT jump to 240°'
      );

      // Frame 4: Next absolute event arrives
      processEvent({ type: 'deviceorientationabsolute', alpha: 19, absolute: true });
      assert.equal(authoritativeHeading, 341);

      // Frame 5: Another relative event arrives
      processEvent({ type: 'deviceorientation', alpha: 121, absolute: false });
      assert.equal(
        authoritativeHeading,
        341,
        'Relative event must remain strictly ignored preventing 60Hz violent shaking'
      );
    });

    it('falls back to relative orientation gracefully on devices lacking absolute sensor hardware', () => {
      let hasReceivedAbsolute = false;
      const supportsAbsoluteApi = false; // Older device without absolute magnetometer
      let authoritativeHeading: number | null = null;

      const processEvent = (event: RawOrientationInput) => {
        const isAbsolute =
          (typeof event.webkitCompassHeading === 'number' && Number.isFinite(event.webkitCompassHeading)) ||
          event.absolute === true ||
          event.type === 'deviceorientationabsolute';

        if (isAbsolute) {
          hasReceivedAbsolute = true;
          authoritativeHeading = extractCompassHeading(event, 0);
          return;
        }

        if (hasReceivedAbsolute || supportsAbsoluteApi) {
          return;
        }

        authoritativeHeading = extractCompassHeading(event, 0);
      };

      // Relative event on legacy hardware sets fallback heading
      processEvent({ type: 'deviceorientation', alpha: 90, absolute: false });
      assert.equal(
        authoritativeHeading,
        270,
        'Fallback relative heading (360 - 90 = 270°) must work when absolute hardware is absent'
      );
    });

    it('correctly extracts iOS Safari webkitCompassHeading as absolute priority', () => {
      const iosEvent: RawOrientationInput = {
        webkitCompassHeading: 42.5,
        alpha: 317.5, // Even if alpha is present, webkitCompassHeading takes precedence
        absolute: false,
      };

      const heading = extractCompassHeading(iosEvent, 0);
      assert.equal(heading, 42.5, 'iOS webkitCompassHeading must be extracted directly');
    });
  });

  // =========================================================================
  // 2. Screen Orientation Compensation
  // =========================================================================
  describe('2. Screen Orientation Compensation Engine', () => {
    it('compensates compass heading correctly across all 4 screen rotation angles', () => {
      const baseHeading = 45; // Phone physical top points North-East (45°)

      // 1. Portrait (0°): No rotation
      assert.equal(compensateScreenOrientation(baseHeading, 0), 45);

      // 2. Landscape-primary (90°): Top of screen is right side
      // User aligns top of display towards target -> compensated heading is 45° + 90° = 135°
      assert.equal(compensateScreenOrientation(baseHeading, 90), 135);

      // 3. Inverted Portrait (180°): Phone held upside down
      assert.equal(compensateScreenOrientation(baseHeading, 180), 225);

      // 4. Landscape-secondary (270° or -90°):
      assert.equal(compensateScreenOrientation(baseHeading, 270), 315);
      assert.equal(compensateScreenOrientation(baseHeading, -90), 315);
    });

    it('wraps seamlessly across 0°/360° circular seam under screen rotation', () => {
      // 300° + 90° = 390° -> wraps to 30°
      assert.equal(compensateScreenOrientation(300, 90), 30);

      // 10° - 90° = -80° -> wraps to 280°
      assert.equal(compensateScreenOrientation(10, 270), 280);
      assert.equal(compensateScreenOrientation(10, -90), 280);
    });

    it('safely handles non-finite inputs in screen orientation compensation', () => {
      assert.equal(compensateScreenOrientation(NaN, 90), 0);
      assert.equal(compensateScreenOrientation(Infinity, 90), 0);
      assert.equal(compensateScreenOrientation(45, NaN), 45);
    });

    it('extractCompassHeading applies screen orientation angle accurately', () => {
      // Android: alpha = 180° -> raw heading = 180°. Screen rotation = 90° -> compensated = 270°
      const androidResult = extractCompassHeading({ alpha: 180 }, 90);
      assert.equal(androidResult, 270);

      // iOS: webkitCompassHeading = 270°. Screen rotation = 90° -> compensated = (270 + 90) % 360 = 0° (North)
      const iosResult = extractCompassHeading({ webkitCompassHeading: 270 }, 90);
      assert.equal(iosResult, 0);
    });
  });

  // =========================================================================
  // 3. Deadband Suppression of Stationary Sensor Jitter
  // =========================================================================
  describe('3. Deadband Suppression of Stationary Sensor Jitter', () => {
    it('guarantees 100% frozen stability when phone is stationary with sub-1.2° noise', () => {
      const stableHeading = 215.0; // Device stationary on a desk
      let currentFiltered = stableHeading;

      // Simulate 60 consecutive frames (1 second at 60Hz) of random Android magnetometer jitter
      // Fluttering within +/- 1.15° of 215.0° (strictly < tuned 1.2° threshold)
      const jitterSequence = [
        215.3, 214.2, 215.8, 214.1, 215.9, 214.4, 216.1, 213.9, 215.5, 214.6,
        215.2, 214.3, 215.7, 214.0, 216.0, 214.5, 215.1, 214.7, 215.6, 214.8,
        215.4, 214.2, 215.9, 214.1, 216.1, 213.9, 215.5, 214.6, 215.2, 214.3,
        215.7, 214.0, 216.0, 214.5, 215.1, 214.7, 215.6, 214.8, 215.3, 214.2,
        215.8, 214.1, 215.9, 214.4, 216.1, 213.9, 215.5, 214.6, 215.2, 214.3,
        215.7, 214.0, 216.0, 214.5, 215.1, 214.7, 215.6, 214.8, 215.0, 215.1,
      ];

      for (const noisyReading of jitterSequence) {
        // Dual-stage deadband + velocity EMA filtering pipeline
        const gatedTarget = applyDeadband(currentFiltered, noisyReading, DEFAULT_DEADBAND_THRESHOLD);
        const smoothed = adaptiveCircularEma(currentFiltered, gatedTarget, 0.016);
        currentFiltered = applyDeadband(currentFiltered, smoothed, DEFAULT_DEADBAND_THRESHOLD);

        // Every frame must remain EXACTLY equal to stableHeading
        assert.equal(
          currentFiltered,
          stableHeading,
          `Heading must remain 100% frozen at ${stableHeading}°, but deviated to ${currentFiltered}° on reading ${noisyReading}°`
        );
      }
    });

    it('smoothly unlocks and tracks deliberate turns exceeding 1.2°', () => {
      let currentFiltered = 100.0;
      const intentionalTurnTarget = 120.0; // Deliberate 20° turn

      // First step with delta = 20° (> 1.2° deadband)
      const gatedTarget = applyDeadband(currentFiltered, intentionalTurnTarget, DEFAULT_DEADBAND_THRESHOLD);
      assert.equal(gatedTarget, 120.0, 'Intentional turn delta (20°) must pass deadband noise gate');

      const smoothed = adaptiveCircularEma(currentFiltered, gatedTarget, 0.016);
      currentFiltered = applyDeadband(currentFiltered, smoothed, DEFAULT_DEADBAND_THRESHOLD);

      // Must move decisively towards 120.0°
      assert.ok(
        currentFiltered > 105.0,
        `Filter must adapt smoothly towards turn target, reached: ${currentFiltered}°`
      );
    });
  });

  // =========================================================================
  // 4. Edge-Triggered Alignment Haptics Engine
  // =========================================================================
  describe('4. Edge-Triggered Alignment Haptics Engine', () => {
    it('vibrates exactly ONCE on rising edge from unaligned to aligned', () => {
      let wasAligned = false;

      // Frame 1: User approaching alignment (delta = 5.0°, outside +/- 3.5° tolerance)
      const isAlignedFrame1 = false;
      const shouldVibrate1 = shouldTriggerHaptic(wasAligned, isAlignedFrame1, true, true);
      assert.equal(shouldVibrate1, false, 'No vibration while approaching alignment');
      wasAligned = isAlignedFrame1;

      // Frame 2: User enters green zone (delta = 2.0°, inside +/- 3.5° tolerance)
      const isAlignedFrame2 = true;
      const shouldVibrate2 = shouldTriggerHaptic(wasAligned, isAlignedFrame2, true, true);
      assert.equal(shouldVibrate2, true, 'Discrete rising edge must trigger haptic pulse');
      wasAligned = isAlignedFrame2;

      // Frame 3: User stays aligned in green zone
      const isAlignedFrame3 = true;
      const shouldVibrate3 = shouldTriggerHaptic(wasAligned, isAlignedFrame3, true, true);
      assert.equal(shouldVibrate3, false, 'Must NOT re-trigger vibration while remaining aligned');
      wasAligned = isAlignedFrame3;
    });

    it('NEVER vibrates continuously while worshipper remains aligned in green zone for 100+ frames', () => {
      let wasAligned = true; // User is already settled and praying towards Qibla
      let vibrationTriggerCount = 0;

      // Simulate 100 consecutive frames (10 seconds) held aligned within green zone (+/- 3.5°)
      for (let frame = 1; frame <= 100; frame++) {
        const isAligned = true;
        const shouldVibrate = shouldTriggerHaptic(wasAligned, isAligned, true, true);
        if (shouldVibrate) {
          vibrationTriggerCount++;
        }
        wasAligned = isAligned;
      }

      assert.equal(
        vibrationTriggerCount,
        0,
        `Expected exactly 0 vibrations while continuously aligned, received: ${vibrationTriggerCount}`
      );
    });

    it('fires a new vibration only after user exits green zone and re-enters', () => {
      let wasAligned = false;
      const vibrationLog: number[] = [];

      // Step A: Enter alignment -> Trigger 1
      if (shouldTriggerHaptic(wasAligned, true, true, true)) vibrationLog.push(1);
      wasAligned = true;

      // Step B: Hold alignment for 10 frames -> 0 triggers
      for (let i = 0; i < 10; i++) {
        if (shouldTriggerHaptic(wasAligned, true, true, true)) vibrationLog.push(2);
        wasAligned = true;
      }

      // Step C: Turn away from Qibla (unaligned) -> 0 triggers
      if (shouldTriggerHaptic(wasAligned, false, true, true)) vibrationLog.push(3);
      wasAligned = false;

      // Step D: Re-enter green zone -> Trigger 2
      if (shouldTriggerHaptic(wasAligned, true, true, true)) vibrationLog.push(4);
      wasAligned = true;

      // Verify sequence of triggers
      assert.deepEqual(
        vibrationLog,
        [1, 4],
        'Haptics must fire exactly once on first entry and once on re-entry'
      );
    });

    it('suppresses vibration when device is excessively tilted (> 20°)', () => {
      let wasAligned = false;

      // Aligned with Kaaba bearing, but device is tilted at 28° (excessive tilt distortion)
      const isAligned = true;
      const isLevel = false; // tiltStatus === 'EXCESSIVE_TILT'
      const shouldVibrateTilted = shouldTriggerHaptic(wasAligned, isAligned, true, isLevel);
      assert.equal(
        shouldVibrateTilted,
        false,
        'Haptics must be blocked when magnetic field is distorted by excessive tilt'
      );
      wasAligned = isAligned && isLevel; // remains false

      // User lays phone flat (level optimal)
      const isLevelNow = true;
      const shouldVibrateLevel = shouldTriggerHaptic(wasAligned, isAligned, true, isLevelNow);
      assert.equal(
        shouldVibrateLevel,
        true,
        'Haptics must fire on rising edge once phone is laid flat and level'
      );
    });

    it('suppresses vibration when sensor is not actively reading', () => {
      assert.equal(
        shouldTriggerHaptic(false, true, false, true),
        false,
        'Must not vibrate if sensor is not actively reading'
      );
    });

    it('gracefully handles missing navigator.vibrate or security rejections without throwing', () => {
      // In Node.js environment, navigator.vibrate is undefined
      assert.doesNotThrow(() => {
        const result = triggerHapticFeedback(30);
        assert.equal(result, false, 'Should safely return false in environments without vibration hardware');
      });
    });
  });
});
