import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_ACCOUNT_SETTINGS, createEmptyAccountSave } from '../assets/scripts/account/AccountSave.ts';
import { resolveQualityFrameRate, resolveQualityProfile } from '../assets/scripts/platform/QualityProfile.ts';
import { isVibrationEnabled, setVibrationEnabled, vibrateShort } from '../assets/scripts/platform/Vibration.ts';

test('settings defaults have a single source used by fresh saves', () => {
  assert.deepEqual(DEFAULT_ACCOUNT_SETTINGS, {
    bgmVolume: 100,
    sfxVolume: 100,
    vibrationEnabled: true,
    qualityTier: 0,
    agreementVersion: 0,
  });
  const fresh = createEmptyAccountSave(1000);
  assert.deepEqual(fresh.settings, DEFAULT_ACCOUNT_SETTINGS, 'fresh save settings come from the shared defaults');
});

test('quality tier maps to a gray-box frame rate with recoverable auto tier', () => {
  assert.equal(resolveQualityProfile(0), 'auto');
  assert.equal(resolveQualityProfile(1), 'fps30');
  assert.equal(resolveQualityProfile(2), 'fps60');
  assert.equal(resolveQualityProfile(9), 'auto', 'unknown tiers fall back to auto');
  assert.equal(resolveQualityFrameRate(0), 60, 'auto restores the engine default so other tiers can undo');
  assert.equal(resolveQualityFrameRate(1), 30);
  assert.equal(resolveQualityFrameRate(2), 60);
});

test('vibration flag defaults on and suppresses haptics when disabled', () => {
  assert.equal(isVibrationEnabled(), true);
  setVibrationEnabled(false);
  assert.equal(isVibrationEnabled(), false);
  assert.doesNotThrow(() => vibrateShort(), 'no wx environment must stay a silent no-op');
  setVibrationEnabled(true);
  assert.equal(isVibrationEnabled(), true);
  assert.doesNotThrow(() => vibrateShort());
});
