# Desktop icons

`icon.ico` and `icon.icns` are derived from the existing transparent
`assets/vishesh-jewellers-logo.png`, without changing the logo design.

Regenerate on macOS with `npm run build:icons`. Generation uses the system PNG
resizer and Node's binary APIs; no extra npm dependencies are required.
Include both generated icon files in source control. Windows packaging uses the
existing ICO and does not require macOS tools or regeneration.

The ICO contains 16, 32, 48, 64, 128 and 256px PNG frames. The ICNS contains
16, 32, 64, 128, 256, 512 and 1024px PNG frames. Packaging tests validate both
containers. Rebuild installers to apply them; installed OS icon caches may retain
the previous icon until the application is replaced/reopened.
