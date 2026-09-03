'use strict';

const path = require('path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

/**
 * electron-builder afterPack hook — sets Electron runtime fuses on the packaged .app.
 *
 * Fuses are permanent binary patches applied after packing, before DMG creation.
 * resetAdHocDarwinSignature re-signs with an ad-hoc signature after the flip
 * (required to keep the binary runnable on macOS when not using a Developer ID).
 *
 * Disabled: RunAsNode, EnableNodeOptionsEnvironmentVariable, EnableNodeCliInspectArguments
 * Enabled:  EnableCookieEncryption, OnlyLoadAppFromAsar
 */
module.exports = async (context) => {
  // Only macOS produces a .app bundle; skip on other targets
  if (context.electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  console.log(`[fuses] Flipping fuses on ${appPath}`);

  await flipFuses(appPath, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: true,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });

  console.log('[fuses] Done.');
};
