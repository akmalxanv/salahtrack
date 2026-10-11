import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateQiblaBearing,
  calculateDistanceToKaaba,
  calculateShortestAngleDiff,
  unwrapAngle,
  adaptiveCircularEma,
  applyDeadband,
  computeTiltMetrics,
  calculateTurnGuidance,
  normalizeAngle,
  KAABA_COORDS,
  DEFAULT_DEADBAND_THRESHOLD,
  DEFAULT_ALIGNMENT_TOLERANCE,
  EMA_ALPHA_MIN,
  EMA_ALPHA_MAX,
  TILT_LEVEL_THRESHOLD,
  TILT_SLIGHT_THRESHOLD,
} from '../../src/lib/qibla.ts';

// Earth radius reference matching Haversine constant
const EARTH_RADIUS_KM = 6371;
const HALF_CIRCUMFERENCE_KM = Math.round(Math.PI * EARTH_RADIUS_KM); // ~20,015 km

describe('Deep Sensor & Geodesic Mathematical Test Suite', () => {
  // =========================================================================
  // 1. Geodesic Edge Cases & Terrestrial Singularities
  // =========================================================================
  describe('1. Geodesic Edge Cases & Terrestrial Singularities', () => {
    it('handles Kaaba origin (self-location) with zero distance and valid bearing', () => {
      const distance = calculateDistanceToKaaba(KAABA_COORDS.lat, KAABA_COORDS.lng);
      assert.equal(distance, 0, 'Distance from Kaaba to Kaaba must be exactly 0 km');

      const bearing = calculateQiblaBearing(KAABA_COORDS.lat, KAABA_COORDS.lng);
      assert.ok(
        Number.isFinite(bearing) && bearing >= 0 && bearing < 360,
        `Bearing at Kaaba origin must be a valid finite angle in [0, 360), received ${bearing}`
      );
      assert.equal(bearing, 0, 'At self-coordinates, bearing defaults cleanly to 0°');
    });

    it('evaluates exact antipodal point (-21.422487°, -140.173794°) at half Earth circumference', () => {
      // Antipodal point is (-lat, lng - 180°)
      const antipodalLat = -KAABA_COORDS.lat;
      const antipodalLng = KAABA_COORDS.lng - 180; // -140.173794°

      const distance = calculateDistanceToKaaba(antipodalLat, antipodalLng);
      // Half circumference of spherical Earth (π * 6371 km) ≈ 20,015 km
      assert.ok(
        Math.abs(distance - HALF_CIRCUMFERENCE_KM) <= 25,
        `Antipodal distance should equal half Earth circumference (~${HALF_CIRCUMFERENCE_KM} km), got ${distance} km`
      );

      const bearing = calculateQiblaBearing(antipodalLat, antipodalLng);
      assert.ok(
        Number.isFinite(bearing) && bearing >= 0 && bearing < 360,
        `Bearing at antipodal point must be finite and within [0, 360), received ${bearing}`
      );

      // Micro-perturbations away from the antipode resolve cleanly into unambiguous bearings
      const perturbedEastBearing = calculateQiblaBearing(antipodalLat, antipodalLng + 0.05);
      const perturbedNorthBearing = calculateQiblaBearing(antipodalLat + 0.05, antipodalLng);
      assert.ok(Number.isFinite(perturbedEastBearing));
      assert.ok(Number.isFinite(perturbedNorthBearing));
    });

    it('evaluates North Pole singularity (90° N) with all meridians directed South', () => {
      // Along Kaaba meridian (39.826206° E) at North Pole
      const bearingAligned = calculateQiblaBearing(90, KAABA_COORDS.lng);
      assert.equal(
        bearingAligned,
        180.0,
        'From North Pole along destination meridian, initial bearing must point exactly South (180.0°)'
      );

      // Distance from 90° N to 21.422487° N: angular arc = 90 - 21.422487 = 68.577513°
      // Arc distance = (68.577513 / 180) * π * 6371 ≈ 7,625 km
      const poleDistance = calculateDistanceToKaaba(90, KAABA_COORDS.lng);
      assert.ok(
        poleDistance >= 7615 && poleDistance <= 7635,
        `Expected North Pole distance ~7,625 km, got ${poleDistance} km`
      );

      // Observer at Prime Meridian North Pole (90° N, 0° E)
      const bearingPrime = calculateQiblaBearing(90, 0);
      assert.ok(
        bearingPrime >= 139.5 && bearingPrime <= 140.5,
        `Expected bearing around 140.2° from (90, 0), got ${bearingPrime}`
      );
      assert.equal(calculateDistanceToKaaba(90, 0), poleDistance);
    });

    it('evaluates South Pole singularity (-90° S) with all meridians directed North', () => {
      // Along Kaaba meridian at South Pole
      const bearingAligned = calculateQiblaBearing(-90, KAABA_COORDS.lng);
      assert.equal(
        bearingAligned,
        0.0,
        'From South Pole along destination meridian, initial bearing must point exactly North (0.0°)'
      );

      // Distance from -90° S to 21.422487° N: angular arc = 90 + 21.422487 = 111.422487°
      // Arc distance = (111.422487 / 180) * π * 6371 ≈ 12,390 km
      const southPoleDistance = calculateDistanceToKaaba(-90, KAABA_COORDS.lng);
      assert.ok(
        southPoleDistance >= 12380 && southPoleDistance <= 12400,
        `Expected South Pole distance ~12,390 km, got ${southPoleDistance} km`
      );
    });

    it('evaluates International Date Line & Antimeridian crossings (-179° to 179° and ±180°)', () => {
      // +180° and -180° represent the exact same physical terrestrial meridian
      const bearing180E = calculateQiblaBearing(60, 180);
      const bearing180W = calculateQiblaBearing(60, -180);
      assert.equal(bearing180E, bearing180W, 'Bearings at +180° and -180° longitudes must be identical');

      const dist180E = calculateDistanceToKaaba(60, 180);
      const dist180W = calculateDistanceToKaaba(60, -180);
      assert.equal(dist180E, dist180W, 'Distances at +180° and -180° longitudes must be identical');

      // Stepping across the International Date Line near equator: (0°, 179°) vs (0°, -179°)
      const bearingEastIDL = calculateQiblaBearing(0, 179);
      const bearingWestIDL = calculateQiblaBearing(0, -179);
      assert.ok(
        Math.abs(bearingEastIDL - bearingWestIDL) <= 2.0,
        `Bearings across 2° IDL step should be continuous without sign-flip artifacts: got ${bearingEastIDL}° and ${bearingWestIDL}°`
      );

      const distEastIDL = calculateDistanceToKaaba(0, 179);
      const distWestIDL = calculateDistanceToKaaba(0, -179);
      assert.ok(
        Math.abs(distEastIDL - distWestIDL) <= 250,
        `Distance delta across 2° IDL jump should be small: got ${distEastIDL} km vs ${distWestIDL} km`
      );

      // Micro-step boundary continuity at 179.999° vs -179.999°
      const bPlus = calculateQiblaBearing(45, 179.999);
      const bMinus = calculateQiblaBearing(45, -179.999);
      assert.ok(
        Math.abs(bPlus - bMinus) <= 0.2,
        `Continuous transition expected across antimeridian: ${bPlus}° vs ${bMinus}°`
      );
    });
  });

  // =========================================================================
  // 2. Angle Unwrapping & Continuous Accumulation (Zero Reverse-Spin)
  // =========================================================================
  describe('2. Angle Unwrapping & Continuous Accumulation', () => {
    it('unwraps single 360°/0° boundary crossings without reverse spin jumps', () => {
      // Clockwise crossing: 355° -> 5° must accumulate to 365° (+10° step, NOT -350°)
      const cwUnwrapped = unwrapAngle(355, 5);
      assert.equal(cwUnwrapped, 365);
      const cwDiff = cwUnwrapped - 355;
      assert.equal(cwDiff, 10, 'Clockwise crossing must step forward by shortest delta +10°');

      // Counter-clockwise crossing: 5° -> 355° must accumulate to -5° (-10° step, NOT +350°)
      const ccwUnwrapped = unwrapAngle(5, 355);
      assert.equal(ccwUnwrapped, -5);
      const ccwDiff = ccwUnwrapped - 5;
      assert.equal(ccwDiff, -10, 'Counter-clockwise crossing must step backward by shortest delta -10°');
    });

    it('accumulates multiple clockwise revolutions (1080°) with monotonic continuity', () => {
      let continuous = 0;
      // 3 full continuous clockwise revolutions passing through multiple 360° seams
      const waypoints = [
        90, 180, 270, 350, 10,
        90, 180, 270, 350, 10,
        90, 180, 270, 350, 10,
      ];

      let prevAccumulator = continuous;
      for (const target of waypoints) {
        continuous = unwrapAngle(continuous, target);
        const stepDelta = continuous - prevAccumulator;
        const expectedDiff = calculateShortestAngleDiff(prevAccumulator, target);
        assert.equal(stepDelta, expectedDiff, 'Step delta must match calculateShortestAngleDiff exactly');
        assert.ok(
          stepDelta > 0,
          `Every step in clockwise sequence must be positive (got delta ${stepDelta} from ${prevAccumulator} to ${continuous})`
        );
        assert.ok(
          stepDelta <= 180,
          `Step delta must never exceed 180° shortest path (got ${stepDelta})`
        );
        // Normalized angle of the continuous accumulator must equal target
        assert.equal(
          normalizeAngle(continuous),
          normalizeAngle(target),
          `Normalized continuous angle ${normalizeAngle(continuous)} must match target ${target}`
        );
        prevAccumulator = continuous;
      }

      // After 3 full loops through 10°: continuous accumulator must be 1090° (3 * 360 + 10)
      assert.equal(continuous, 1090);
    });

    it('accumulates multiple counter-clockwise revolutions (-1080°) with monotonic continuity', () => {
      let continuous = 0;
      // 3 full continuous counter-clockwise revolutions passing through multiple negative seams
      const waypoints = [
        270, 180, 90, 10, 350,
        270, 180, 90, 10, 350,
        270, 180, 90, 10, 350,
      ];

      let prevAccumulator = continuous;
      for (const target of waypoints) {
        continuous = unwrapAngle(continuous, target);
        const stepDelta = continuous - prevAccumulator;
        assert.ok(
          stepDelta < 0,
          `Every step in counter-clockwise sequence must be negative (got delta ${stepDelta} from ${prevAccumulator} to ${continuous})`
        );
        assert.ok(
          Math.abs(stepDelta) <= 180,
          `Step delta must never exceed 180° shortest path (got ${stepDelta})`
        );
        assert.equal(
          normalizeAngle(continuous),
          normalizeAngle(target),
          `Normalized continuous angle ${normalizeAngle(continuous)} must match target ${target}`
        );
        prevAccumulator = continuous;
      }

      // After 3 full counter-clockwise loops through 350°: continuous accumulator must be -1090° (-3 * 360 - 10)
      assert.equal(continuous, -1090);
    });

    it('handles oscillatory boundary wobble without winding divergence', () => {
      let continuous = 0;
      // Wobbling back and forth across 0°/360° boundary: 359° <-> 1°
      const wobble = [359, 1, 359, 1, 359, 1, 359, 1];
      for (const target of wobble) {
        continuous = unwrapAngle(continuous, target);
      }
      // After even number of oscillations, continuous value must remain bounded near 0 (not wind up to 2880°)
      assert.ok(
        Math.abs(continuous) <= 2,
        `Continuous angle after boundary wobble must stay bounded within ~2°, got ${continuous}`
      );
    });

    it('guards against non-finite values and preserves safe accumulator state', () => {
      assert.equal(unwrapAngle(45, NaN), 45);
      assert.equal(unwrapAngle(45, Infinity), 45);
      assert.equal(unwrapAngle(45, -Infinity), 45);
      assert.equal(unwrapAngle(NaN, 90), 90);
      assert.equal(unwrapAngle(NaN, NaN), 0);
    });
  });

  // =========================================================================
  // 3. Velocity-Adaptive Circular EMA Filter
  // =========================================================================
  describe('3. Velocity-Adaptive Circular EMA Filter', () => {
    it('applies strong damping (alpha ≈ EMA_ALPHA_MIN = 0.12) under small hand tremor (delta < 2°)', () => {
      const initial = 100.0;

      // Tremor delta = 0.5°
      const filtered05 = adaptiveCircularEma(initial, 100.5);
      const expected05 = 100.0 + EMA_ALPHA_MIN * 0.5; // 100.06
      assert.equal(filtered05, expected05, 'Micro-tremor <= 1° must use base minimum alpha = 0.12');

      // Tremor delta = 1.0°
      const filtered10 = adaptiveCircularEma(initial, 101.0);
      const expected10 = 100.0 + EMA_ALPHA_MIN * 1.0; // 100.12
      assert.equal(filtered10, expected10);

      // Tremor delta = 1.8°: factor = (1.8 - 1) / 19 ≈ 0.0421
      // alpha = 0.12 + (0.45 - 0.12) * 0.0421 ≈ 0.1339
      const filtered18 = adaptiveCircularEma(initial, 101.8);
      const effectiveAlpha18 = (filtered18 - initial) / 1.8;
      assert.ok(
        effectiveAlpha18 >= EMA_ALPHA_MIN && effectiveAlpha18 <= 0.14,
        `Alpha for small hand tremor < 2° must stay tightly bounded near ${EMA_ALPHA_MIN}, got ${effectiveAlpha18}`
      );

      // Verify that over 8 frames of ±1.2° random jitter, filtered signal remains heavily damped
      let currentFiltered = 100.0;
      const jitterSteps = [101.2, 98.9, 100.8, 99.3, 101.1, 99.5, 100.7, 99.8];
      for (const noisyInput of jitterSteps) {
        currentFiltered = adaptiveCircularEma(currentFiltered, noisyInput);
        const deviationFromCenter = Math.abs(currentFiltered - 100.0);
        assert.ok(
          deviationFromCenter < 0.4,
          `Filtered value deviation ${deviationFromCenter} should be much smaller than raw noise ~1.2°`
        );
      }
    });

    it('engages rapid responsive tracking (alpha = EMA_ALPHA_MAX = 0.45) during fast rotation (delta > 30°)', () => {
      assert.equal(EMA_ALPHA_MIN, 0.12);
      assert.equal(EMA_ALPHA_MAX, 0.45);
      const initial = 0.0;

      // Intentional rapid turn: delta = 30°
      const filtered30 = adaptiveCircularEma(initial, 30.0);
      const step30 = filtered30 - initial;
      assert.equal(step30, 13.5, 'Delta 30° must use max alpha = 0.45 (step = 0.45 * 30 = 13.5°)');

      // Large sweep: delta = 60°
      const filtered60 = adaptiveCircularEma(initial, 60.0);
      assert.equal(filtered60 - initial, 27.0, 'Delta 60° must use max alpha = 0.45 (step = 27.0°)');

      // Large sweep: delta = 90°
      const filtered90 = adaptiveCircularEma(initial, 90.0);
      assert.equal(filtered90 - initial, 40.5, 'Delta 90° must use max alpha = 0.45 (step = 40.5°)');

      // Convergence test: a 45° step achieves >90% convergence within 6 iterations, then smoothly settles
      let pos = 0;
      const target = 45;
      for (let frame = 1; frame <= 6; frame++) {
        pos = adaptiveCircularEma(pos, target);
      }
      assert.ok(
        pos >= 40.5,
        `Adaptive filter must achieve >90% convergence within 6 iterations (target: 45, reached: ${pos})`
      );

      // Continues to settle within 2°
      for (let frame = 7; frame <= 12; frame++) {
        pos = adaptiveCircularEma(pos, target);
      }
      assert.ok(
        target - pos < 2.0,
        `Adaptive filter must settle within 2° within 12 iterations (target: 45, reached: ${pos})`
      );
    });

    it('interpolates smoothly across circular 0°/360° boundaries without reverse jumping', () => {
      // Clockwise circular step: from 359° towards 1° (shortest diff = +2°)
      const smoothedCW = adaptiveCircularEma(359.0, 1.0);
      assert.ok(
        smoothedCW > 359.0 && smoothedCW < 360.0,
        `Clockwise boundary step must move forward between 359° and 360°, got ${smoothedCW}`
      );

      // Counter-clockwise circular step: from 1° towards 359° (shortest diff = -2°)
      const smoothedCCW = adaptiveCircularEma(1.0, 359.0);
      assert.ok(
        smoothedCCW < 1.0 && smoothedCCW > 0.5,
        `Counter-clockwise boundary step must move backward between 0.5° and 1.0°, got ${smoothedCCW}`
      );
    });

    it('scales alpha accurately based on physical angular velocity when dtSeconds is provided', () => {
      // High angular velocity: 20° change in 0.02s (1,000°/s >> 60°/s) -> alpha clamped to max (0.45)
      const fastStep = adaptiveCircularEma(0, 20, 0.02);
      assert.equal(fastStep, 9.0, 'High angular velocity must use max alpha = 0.45 (0 + 0.45 * 20 = 9)');

      // Low angular velocity: 2° change in 1.0s (2°/s << 5°/s) -> alpha clamped to min (0.12)
      const slowStep = adaptiveCircularEma(0, 2, 1.0);
      assert.equal(slowStep, 0.24, 'Low angular velocity must use min alpha = 0.12 (0 + 0.12 * 2 = 0.24)');

      // Mid-range velocity: 32.5°/s (exact midpoint between 5°/s and 60°/s: factor = 0.5)
      // dt = 0.1s, diff = 3.25° -> velocity = 32.5°/s
      // Expected alpha = 0.12 + 0.33 * 0.5 = 0.285
      // Expected step = 0.285 * 3.25 ≈ 0.92625 -> rounded to 0.926
      const midStep = adaptiveCircularEma(0, 3.25, 0.1);
      assert.equal(midStep, 0.926);
    });
  });

  // =========================================================================
  // 4. Deadband Noise Gate Suppression
  // =========================================================================
  describe('4. Deadband Noise Gate Suppression', () => {
    it('suppresses micro-movements strictly below default 0.6° threshold', () => {
      const stable = 180.0;

      // Positive sub-threshold variations
      assert.equal(applyDeadband(stable, 180.1), stable);
      assert.equal(applyDeadband(stable, 180.3), stable);
      assert.equal(applyDeadband(stable, 180.5), stable);
      assert.equal(applyDeadband(stable, 180.59), stable);

      // Negative sub-threshold variations
      assert.equal(applyDeadband(stable, 179.9), stable);
      assert.equal(applyDeadband(stable, 179.7), stable);
      assert.equal(applyDeadband(stable, 179.5), stable);
      assert.equal(applyDeadband(stable, 179.41), stable);
    });

    it('passes intentional movements at or above default 0.6° threshold', () => {
      const stable = 180.0;

      // Exact boundary threshold: 0.6° change passes
      assert.equal(applyDeadband(stable, 180.6), 180.6);
      assert.equal(applyDeadband(stable, 179.4), 179.4);

      // Super-threshold variations
      assert.equal(applyDeadband(stable, 180.8), 180.8);
      assert.equal(applyDeadband(stable, 182.0), 182.0);
      assert.equal(applyDeadband(stable, 178.5), 178.5);
    });

    it('applies deadband noise gate correctly across 0°/360° seam', () => {
      // Sub-threshold across 0°/360° boundary (+0.3° diff from 359.8° to 0.1°)
      assert.equal(applyDeadband(359.8, 0.1, DEFAULT_DEADBAND_THRESHOLD), 359.8);

      // Super-threshold across 0°/360° boundary (+0.6° diff from 359.8° to 0.4°)
      assert.equal(applyDeadband(359.8, 0.4, DEFAULT_DEADBAND_THRESHOLD), 0.4);

      // Negative sub-threshold across seam (-0.3° diff from 0.2° to 359.9°)
      assert.equal(applyDeadband(0.2, 359.9, DEFAULT_DEADBAND_THRESHOLD), 0.2);

      // Negative super-threshold across seam (-0.7° diff from 0.2° to 359.5°)
      assert.equal(applyDeadband(0.2, 359.5, DEFAULT_DEADBAND_THRESHOLD), 359.5);
    });

    it('respects custom deadband thresholds accurately', () => {
      assert.equal(applyDeadband(50.0, 50.8, 1.0), 50.0, '0.8° diff should be filtered by 1.0° deadband');
      assert.equal(applyDeadband(50.0, 51.1, 1.0), 51.1, '1.1° diff should pass 1.0° deadband');

      assert.equal(applyDeadband(50.0, 50.15, 0.2), 50.0, '0.15° diff filtered by 0.2° deadband');
      assert.equal(applyDeadband(50.0, 50.25, 0.2), 50.25, '0.25° diff passes 0.2° deadband');
    });
  });

  // =========================================================================
  // 5. 3D Spirit Level Metrics & Pythagorean Tilt Engine
  // =========================================================================
  describe('5. 3D Spirit Level Metrics & Pythagorean Tilt Engine', () => {
    it('calculates exact Pythagorean combined tilt magnitude sqrt(beta^2 + gamma^2)', () => {
      // Flat device
      assert.equal(computeTiltMetrics(0, 0).tiltMagnitude, 0);

      // Pure pitch (beta)
      assert.equal(computeTiltMetrics(10, 0).tiltMagnitude, 10);

      // Pure roll (gamma)
      assert.equal(computeTiltMetrics(0, 15).tiltMagnitude, 15);

      // Pythagorean triples:
      // 3-4-5 triangle
      assert.equal(computeTiltMetrics(3, 4).tiltMagnitude, 5);

      // 5-12-13 triangle
      assert.equal(computeTiltMetrics(5, 12).tiltMagnitude, 13);

      // 12-16-20 triangle: sqrt(144 + 256) = sqrt(400) = 20.0
      assert.equal(computeTiltMetrics(12, 16).tiltMagnitude, 20);

      // Negative angle coordinates (quadrant symmetry)
      assert.equal(computeTiltMetrics(-3, -4).tiltMagnitude, 5);
      assert.equal(computeTiltMetrics(3, -4).tiltMagnitude, 5);
    });

    it('categorizes tilt statuses with strict threshold boundaries (LEVEL <= 8°, SLIGHT 8-20°, EXCESSIVE > 20°)', () => {
      assert.equal(TILT_LEVEL_THRESHOLD, 8.0);
      assert.equal(TILT_SLIGHT_THRESHOLD, 20.0);

      // LEVEL: tiltMagnitude <= 8.0°
      assert.equal(computeTiltMetrics(0, 0).tiltStatus, 'LEVEL');
      assert.equal(computeTiltMetrics(5, 5).tiltStatus, 'LEVEL'); // ~7.1°
      assert.equal(computeTiltMetrics(8.0, 0).tiltStatus, 'LEVEL'); // Boundary 8.0°

      // SLIGHT_TILT: tiltMagnitude > 8.0° and <= 20.0°
      assert.equal(computeTiltMetrics(8.1, 0).tiltStatus, 'SLIGHT_TILT'); // Just above 8.0°
      assert.equal(computeTiltMetrics(10, 5).tiltStatus, 'SLIGHT_TILT'); // ~11.2°
      assert.equal(computeTiltMetrics(12, 16).tiltStatus, 'SLIGHT_TILT'); // Exactly 20.0°
      assert.equal(computeTiltMetrics(20.0, 0).tiltStatus, 'SLIGHT_TILT'); // Boundary 20.0°

      // EXCESSIVE_TILT: tiltMagnitude > 20.0°
      assert.equal(computeTiltMetrics(20.1, 0).tiltStatus, 'EXCESSIVE_TILT'); // Just above 20.0°
      assert.equal(computeTiltMetrics(25, 0).tiltStatus, 'EXCESSIVE_TILT');
      assert.equal(computeTiltMetrics(30, 20).tiltStatus, 'EXCESSIVE_TILT'); // ~36.1°
      assert.equal(computeTiltMetrics(90, 0).tiltStatus, 'EXCESSIVE_TILT');
    });

    it('normalizes bubble position coordinates strictly within [-1, 1]', () => {
      // Centered bubble on flat device
      const center = computeTiltMetrics(0, 0);
      assert.equal(center.bubbleX, 0);
      assert.equal(center.bubbleY, 0);

      // Partial deflection: gamma (roll) maps to X; beta (pitch) maps to Y (scale: 20° = 1.0)
      const partial = computeTiltMetrics(10, -10);
      assert.equal(partial.bubbleX, -0.5, 'Gamma -10° / 20° must yield bubbleX = -0.5');
      assert.equal(partial.bubbleY, 0.5, 'Beta 10° / 20° must yield bubbleY = 0.5');

      // Full edge deflection at 20° threshold
      const edge = computeTiltMetrics(20, -20);
      assert.equal(edge.bubbleX, -1.0);
      assert.equal(edge.bubbleY, 1.0);

      // Over-deflection clamped strictly to [-1, 1]
      const excessive = computeTiltMetrics(60, -45);
      assert.equal(excessive.bubbleX, -1.0, 'Bubble X must be clamped at -1.0');
      assert.equal(excessive.bubbleY, 1.0, 'Bubble Y must be clamped at 1.0');

      // Clamping to physical accelerometer bounds (beta in [-180, 180], gamma in [-90, 90])
      const extreme = computeTiltMetrics(360, -200);
      assert.equal(extreme.bubbleX, -1.0);
      assert.equal(extreme.bubbleY, 1.0);
      assert.ok(extreme.tiltMagnitude <= Math.sqrt(180 * 180 + 90 * 90));
    });

    it('safely handles missing, null, undefined, or non-finite sensor values', () => {
      const nullRes = computeTiltMetrics(null, null);
      assert.equal(nullRes.tiltStatus, 'LEVEL');
      assert.equal(nullRes.tiltMagnitude, 0);
      assert.equal(nullRes.bubbleX, 0);
      assert.equal(nullRes.bubbleY, 0);

      const nanRes = computeTiltMetrics(NaN, 15);
      assert.equal(nanRes.tiltStatus, 'LEVEL');
      assert.equal(nanRes.tiltMagnitude, 0);

      const infRes = computeTiltMetrics(10, Infinity);
      assert.equal(infRes.tiltStatus, 'LEVEL');
      assert.equal(infRes.tiltMagnitude, 0);
    });
  });

  // =========================================================================
  // 6. Turn Guidance Engine & Tolerance Boundaries
  // =========================================================================
  describe('6. Kaaba Turn Guidance Engine', () => {
    it('identifies exact shortest turn deltas and directions', () => {
      // Observer at heading 200°, target Qibla at 240.3° -> shortest turn is +40.3° (clockwise / right)
      const guideRight = calculateTurnGuidance(200, 240.3);
      assert.equal(guideRight.state, 'TURN_RIGHT');
      assert.equal(guideRight.deltaDegrees, 40.3);
      assert.equal(guideRight.remainingTurnDeg, 40.3);
      assert.equal(guideRight.isAligned, false);
      assert.ok(guideRight.directionLabel?.includes('Turn right'));

      // Observer at heading 280°, target Qibla at 240.3° -> shortest turn is -39.7° (counter-clockwise / left)
      const guideLeft = calculateTurnGuidance(280, 240.3);
      assert.equal(guideLeft.state, 'TURN_LEFT');
      assert.equal(guideLeft.deltaDegrees, -39.7);
      assert.equal(guideLeft.remainingTurnDeg, 39.7);
      assert.equal(guideLeft.isAligned, false);
      assert.ok(guideLeft.directionLabel?.includes('Turn left'));
    });

    it('chooses the shortest circular path across 0°/360° discontinuity', () => {
      // Heading 10°, Qibla 350° -> shortest path is left by 20° (NOT right by 340°)
      const wrapLeft = calculateTurnGuidance(10, 350);
      assert.equal(wrapLeft.state, 'TURN_LEFT');
      assert.equal(wrapLeft.deltaDegrees, -20.0);
      assert.equal(wrapLeft.remainingTurnDeg, 20.0);

      // Heading 350°, Qibla 10° -> shortest path is right by 20° (NOT left by 340°)
      const wrapRight = calculateTurnGuidance(350, 10);
      assert.equal(wrapRight.state, 'TURN_RIGHT');
      assert.equal(wrapRight.deltaDegrees, 20.0);
      assert.equal(wrapRight.remainingTurnDeg, 20.0);
    });

    it('enforces exact alignment status within +/- 3.5° tolerance window', () => {
      assert.equal(DEFAULT_ALIGNMENT_TOLERANCE, 3.5);
      const qibla = 150.0;

      // Perfectly aligned at 0° deviation
      const zeroDev = calculateTurnGuidance(150.0, qibla);
      assert.equal(zeroDev.state, 'ALIGNED');
      assert.equal(zeroDev.isAligned, true);
      assert.equal(zeroDev.deltaDegrees, 0);
      assert.equal(zeroDev.remainingTurnDeg, 0);

      // Upper positive boundary: +3.5° is ALIGNED
      const upperBoundary = calculateTurnGuidance(146.5, qibla); // delta = +3.5°
      assert.equal(upperBoundary.state, 'ALIGNED');
      assert.equal(upperBoundary.isAligned, true);
      assert.equal(upperBoundary.deltaDegrees, 3.5);

      // Just past upper positive boundary: +3.6° is TURN_RIGHT
      const upperExceeded = calculateTurnGuidance(146.4, qibla); // delta = +3.6°
      assert.equal(upperExceeded.state, 'TURN_RIGHT');
      assert.equal(upperExceeded.isAligned, false);
      assert.equal(upperExceeded.deltaDegrees, 3.6);

      // Lower negative boundary: -3.5° is ALIGNED
      const lowerBoundary = calculateTurnGuidance(153.5, qibla); // delta = -3.5°
      assert.equal(lowerBoundary.state, 'ALIGNED');
      assert.equal(lowerBoundary.isAligned, true);
      assert.equal(lowerBoundary.deltaDegrees, -3.5);

      // Just past lower negative boundary: -3.6° is TURN_LEFT
      const lowerExceeded = calculateTurnGuidance(153.6, qibla); // delta = -3.6°
      assert.equal(lowerExceeded.state, 'TURN_LEFT');
      assert.equal(lowerExceeded.isAligned, false);
      assert.equal(lowerExceeded.deltaDegrees, -3.6);
    });

    it('evaluates ALIGNED status across the 0°/360° boundary', () => {
      // Heading 358.5°, Qibla 1.0° (diff = +2.5° <= 3.5°) -> ALIGNED
      const wrapAlignedPositive = calculateTurnGuidance(358.5, 1.0);
      assert.equal(wrapAlignedPositive.state, 'ALIGNED');
      assert.equal(wrapAlignedPositive.isAligned, true);
      assert.equal(wrapAlignedPositive.deltaDegrees, 2.5);

      // Heading 1.5°, Qibla 359.0° (diff = -2.5° >= -3.5°) -> ALIGNED
      const wrapAlignedNegative = calculateTurnGuidance(1.5, 359.0);
      assert.equal(wrapAlignedNegative.state, 'ALIGNED');
      assert.equal(wrapAlignedNegative.isAligned, true);
      assert.equal(wrapAlignedNegative.deltaDegrees, -2.5);

      // Heading 355.0°, Qibla 2.0° (diff = +7.0° > 3.5°) -> TURN_RIGHT by 7.0°
      const wrapRight = calculateTurnGuidance(355.0, 2.0);
      assert.equal(wrapRight.state, 'TURN_RIGHT');
      assert.equal(wrapRight.isAligned, false);
      assert.equal(wrapRight.deltaDegrees, 7.0);

      // Heading 3.0°, Qibla 354.0° (diff = -9.0° < -3.5°) -> TURN_LEFT by 9.0°
      const wrapLeft = calculateTurnGuidance(3.0, 354.0);
      assert.equal(wrapLeft.state, 'TURN_LEFT');
      assert.equal(wrapLeft.isAligned, false);
      assert.equal(wrapLeft.deltaDegrees, -9.0);
    });

    it('handles non-finite headings and bearings with safe fallback state', () => {
      const fallback1 = calculateTurnGuidance(NaN, 180);
      assert.equal(fallback1.isAligned, false);
      assert.equal(fallback1.deltaDegrees, 0);

      const fallback2 = calculateTurnGuidance(180, Infinity);
      assert.equal(fallback2.isAligned, false);
      assert.equal(fallback2.deltaDegrees, 0);
    });
  });
});
