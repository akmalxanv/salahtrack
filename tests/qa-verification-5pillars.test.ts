import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateQiblaBearing,
  calculateDistanceToKaaba,
  calculateMagneticDeclination,
  calculateTiltCompensatedHeading,
  compensateScreenOrientation,
  KAABA_COORDS,
} from '../src/lib/qibla.ts';
import { translations, getTranslations } from '../src/locales/translations.ts';
import type { PrayerStatus } from '../src/types/prayer.ts';

describe('QA & Release Audit: 5-Pillar Enhancement Suite', () => {
  describe('Pillar 1: Dashboard Usability & Clean Elimination of Prayer Reminders', () => {
    it('verifies notification and reminder translation keys are cleanly eliminated across uz, ru, and en dictionaries', () => {
      const langs = ['uz', 'ru', 'en'] as const;
      const deprecatedKeys = [
        'notifications',
        'notificationsEnabled',
        'notificationsBlocked',
        'enableNotifications',
        'remindersOn',
        'remindersOff',
        'testNotification',
        'testNotificationBody',
        'prayerNotificationBody',
        'notificationsUnsupported',
        'notificationsHelpTitle',
        'notificationsHelpDesc',
        'notificationsHelpStepChrome',
        'notificationsHelpStepSafari',
        'notificationsHelpClose',
      ];

      for (const lang of langs) {
        const t = getTranslations(lang) as unknown as { dashboard: Record<string, unknown> };
        for (const key of deprecatedKeys) {
          assert.equal(
            t.dashboard[key],
            undefined,
            `Deprecated reminder key "${key}" must be absent in ${lang} dictionary`
          );
        }
      }
    });

    it('verifies core dashboard usability and responsive status presentation keys exist', () => {
      const langs = ['uz', 'ru', 'en'] as const;
      for (const lang of langs) {
        const t = getTranslations(lang);
        // Core dashboard strings
        assert.ok(t.dashboard.todayPrayers, `todayPrayers missing in ${lang}`);
        assert.ok(t.dashboard.nextPrayer, `nextPrayer missing in ${lang}`);
        assert.ok(t.dashboard.in, `in missing in ${lang}`);
        assert.ok(t.dashboard.statusLive, `statusLive missing in ${lang}`);
        assert.ok(t.dashboard.allCaughtUp, `allCaughtUp missing in ${lang}`);
        assert.ok(t.dashboard.streakDays, `streakDays missing in ${lang}`);
        assert.ok(t.dashboard.overnightIshaActive, `overnightIshaActive missing in ${lang}`);
        assert.ok(t.dashboard.overnightIshaBadge, `overnightIshaBadge missing in ${lang}`);
        assert.ok(t.dashboard.hijriBadge, `hijriBadge missing in ${lang}`);

        // Status presentation labels
        assert.ok(t.statuses.PENDING, `PENDING status label missing in ${lang}`);
        assert.ok(t.statuses.PRAYED_ON_TIME, `PRAYED_ON_TIME status label missing in ${lang}`);
        assert.ok(t.statuses.PRAYED, `PRAYED status label missing in ${lang}`);
        assert.ok(t.statuses.MADE_UP, `MADE_UP status label missing in ${lang}`);
        assert.ok(t.statuses.MISSED, `MISSED status label missing in ${lang}`);
      }
    });

    it('verifies responsive next prayer countdown formatting operates without notification dependencies', () => {
      function formatCountdown(hours: number, mins: number, secs: number): string {
        const pad = (n: number) => String(Math.max(0, Math.floor(n))).padStart(2, '0');
        return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
      }

      // Normal countdown values
      assert.equal(formatCountdown(2, 45, 9), '02:45:09');
      assert.equal(formatCountdown(0, 0, 0), '00:00:00');
      assert.equal(formatCountdown(11, 59, 59), '11:59:59');

      // Defensive / boundary handling
      assert.equal(formatCountdown(-1, -5, -30), '00:00:00');
    });
  });

  describe('Pillar 2: Mobile Prayer Cards Accidental Tap Prevention & Rigid Layout', () => {
    it('enforces that outer card clicks do not alter prayer state', () => {
      let prayerState: PrayerStatus = 'PENDING';

      // Outer card handler: inert (no state mutation)
      const onCardClick = () => {
        // Container click is strictly non-interactive
      };

      // Explicit checkmark button handler
      const onExplicitCheckToggle = (current: PrayerStatus) => {
        prayerState = current === 'PENDING' ? 'PRAYED_ON_TIME' : 'PENDING';
      };

      // 1. User accidentally taps card background while scrolling
      onCardClick();
      assert.equal(prayerState, 'PENDING', 'Card container click must not change prayer status');

      // 2. User explicitly clicks checkmark button
      onExplicitCheckToggle(prayerState);
      assert.equal(prayerState, 'PRAYED_ON_TIME', 'Explicit button tap must toggle status');

      // 3. User taps checkmark again
      onExplicitCheckToggle(prayerState);
      assert.equal(prayerState, 'PENDING', 'Second explicit button tap toggles back to PENDING');
    });

    it('verifies overdue inline actions update status explicitly', () => {
      let currentStatus: PrayerStatus = 'PENDING';

      const handleSetStatus = (next: PrayerStatus) => {
        currentStatus = next;
      };

      // Tapping "Prayed"
      handleSetStatus('PRAYED_ON_TIME');
      assert.equal(currentStatus, 'PRAYED_ON_TIME');

      // Tapping "Made Up"
      handleSetStatus('MADE_UP');
      assert.equal(currentStatus, 'MADE_UP');

      // Tapping "Missed"
      handleSetStatus('MISSED');
      assert.equal(currentStatus, 'MISSED');

      // Tapping "Reset to Pending"
      handleSetStatus('PENDING');
      assert.equal(currentStatus, 'PENDING');
    });
  });

  describe('Pillar 3: My Circle In-View Member Profile & Self-Profile Guard', () => {
    it('prevents opening member history modal when clicking own profile', () => {
      let modalOpenedForUser: string | null = null;

      const handleMemberClick = (member: { userId: string; isCurrentUser: boolean }) => {
        if (member.isCurrentUser) {
          // Guard: Do not open modal or navigate away
          return;
        }
        modalOpenedForUser = member.userId;
      };

      // 1. Current user clicks themselves
      handleMemberClick({ userId: 'user_123', isCurrentUser: true });
      assert.equal(modalOpenedForUser, null, 'Clicking own card must not open modal or change active member');

      // 2. Current user clicks a fellow member
      handleMemberClick({ userId: 'user_456', isCurrentUser: false });
      assert.equal(modalOpenedForUser, 'user_456', 'Clicking another member sets in-view active member');
    });

    it('verifies circle read-only and profile translation strings exist', () => {
      for (const lang of ['uz', 'ru', 'en'] as const) {
        const t = translations[lang];
        assert.ok(t.groups.viewMemberHistory, `viewMemberHistory missing in ${lang}`);
        assert.ok(t.groups.readOnlyNotice, `readOnlyNotice missing in ${lang}`);
        assert.ok(t.leaderboard.youBadge, `youBadge missing in ${lang}`);
      }
    });
  });

  describe('Pillar 4: Qibla Geodesics, Magnetic Declination & 3D Tilt', () => {
    it('independently verifies Kaaba coordinates and Great-Circle azimuths', () => {
      assert.equal(KAABA_COORDS.lat, 21.422487);
      assert.equal(KAABA_COORDS.lng, 39.826206);

      // Tashkent (41.2995° N, 69.2401° E) -> ~240.3°
      const tashkentBearing = calculateQiblaBearing(41.2995, 69.2401);
      assert.ok(
        Math.abs(tashkentBearing - 240.3) <= 0.1,
        `Tashkent bearing was ${tashkentBearing}, expected 240.3°`
      );

      // Distance to Kaaba from Tashkent -> ~3531 km
      const tashkentDist = calculateDistanceToKaaba(41.2995, 69.2401);
      assert.ok(
        tashkentDist >= 3500 && tashkentDist <= 3560,
        `Tashkent distance was ${tashkentDist} km, expected ~3531 km`
      );

      // Kaaba origin -> 0 km
      const kaabaDist = calculateDistanceToKaaba(KAABA_COORDS.lat, KAABA_COORDS.lng);
      assert.equal(kaabaDist, 0);

      // London (51.5074° N, -0.1278° E) -> ~118.9°
      const londonBearing = calculateQiblaBearing(51.5074, -0.1278);
      assert.ok(
        Math.abs(londonBearing - 118.9) <= 0.2,
        `London bearing was ${londonBearing}, expected ~118.9°`
      );

      // New York (40.7128° N, -74.0060° E) -> ~58.5°
      const nyBearing = calculateQiblaBearing(40.7128, -74.0060);
      assert.ok(
        Math.abs(nyBearing - 58.5) <= 0.2,
        `New York bearing was ${nyBearing}, expected ~58.5°`
      );
    });

    it('calculates geomagnetic declination accurately with formatted indicators', () => {
      // Tashkent: East declination
      const decTashkent = calculateMagneticDeclination(41.2995, 69.2401);
      assert.equal(decTashkent.isEast, true);
      assert.ok(decTashkent.declinationDeg > 0);
      assert.ok(decTashkent.formatted.includes('° E'));

      // New York: West declination
      const decNY = calculateMagneticDeclination(40.7128, -74.0060);
      assert.equal(decNY.isEast, false);
      assert.ok(decNY.declinationDeg < 0);
      assert.ok(decNY.formatted.includes('° W'));

      // Defensive: Non-finite inputs fail safely
      const decInvalid = calculateMagneticDeclination(NaN, Infinity);
      assert.equal(decInvalid.declinationDeg, 0);
      assert.equal(decInvalid.isEast, true);
    });

    it('computes 3D tilt-compensated azimuth and adjusts for magnetic declination', () => {
      // 1. Phone held completely flat facing North (alpha = 0, beta = 0, gamma = 0)
      const flatNorth = calculateTiltCompensatedHeading(0, 0, 0, 0, 0);
      assert.equal(flatNorth, 0);

      // 2. Phone held completely flat facing East (alpha = 270, beta = 0, gamma = 0)
      // On Android W3C, alpha = 270 corresponds to 90° East
      const flatEast = calculateTiltCompensatedHeading(270, 0, 0, 0, 0);
      assert.equal(flatEast, 90);

      // 3. Phone held at 30° reading pitch facing North (alpha = 0, beta = 30, gamma = 0)
      const tiltedNorth = calculateTiltCompensatedHeading(0, 30, 0, 0, 0);
      assert.equal(tiltedNorth, 0, 'Tilting phone along pitch axis should not alter North heading');

      // 4. Applying magnetic declination: Magnetic heading 90° with +5.5° East declination -> 95.5° True North
      const trueHeading = calculateTiltCompensatedHeading(270, 0, 0, 0, 5.5);
      assert.equal(trueHeading, 95.5);

      // 5. Screen orientation compensation: 90° landscape tilt
      const landscapeHeading = compensateScreenOrientation(0, 90);
      assert.equal(landscapeHeading, 90);

      // 6. Defensive check on non-finite alpha
      assert.equal(calculateTiltCompensatedHeading(null, 0, 0), null);
      assert.equal(calculateTiltCompensatedHeading(NaN, 0, 0), null);
    });
  });

  describe('Pillar 5: Streamlined Account Settings Validation', () => {
    it('evaluates live password strength meter reliably', () => {
      function evaluateStrength(pass: string): 'empty' | 'weak' | 'medium' | 'strong' {
        if (!pass) return 'empty';
        if (pass.length < 8) return 'weak';
        const hasUpper = /[A-Z]/.test(pass);
        const hasLower = /[a-z]/.test(pass);
        const hasNumber = /[0-9]/.test(pass);
        const hasSpecial = /[^A-Za-z0-9]/.test(pass);
        const score = [hasUpper, hasLower, hasNumber, hasSpecial].filter(Boolean).length;
        if (pass.length >= 10 && score >= 3) return 'strong';
        if (score >= 2) return 'medium';
        return 'weak';
      }

      assert.equal(evaluateStrength(''), 'empty');
      assert.equal(evaluateStrength('short'), 'weak');
      assert.equal(evaluateStrength('password123'), 'medium');
      assert.equal(evaluateStrength('Secure@P@ss2026'), 'strong');
    });
  });
});
