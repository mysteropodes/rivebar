# RiveBar — Installation Guide

## Download

Download the latest version: **RiveBar-1.7.2-arm64.dmg**

## macOS Installation

### Step 1 — Install the app

1. Open the `.dmg` file
2. Drag **RiveBar** into your **Applications** folder
3. Eject the DMG

### Step 2 — Fix the "damaged app" warning

Because RiveBar is not notarized by Apple, macOS may show this alert:

> "RiveBar.app" is damaged and can't be opened. You should move it to the Trash.

**This is normal for unsigned/non-notarized apps.** The app is safe — it just hasn't gone through Apple's paid notarization process.

To fix it, open **Terminal** and run:

```
xattr -cr /Applications/RiveBar.app
```

Then open RiveBar normally from your Applications folder or Launchpad.

> **What does this command do?**
> It removes the quarantine flag that macOS automatically adds to files downloaded from the internet. This is a standard fix for indie apps distributed outside the Mac App Store.

### Step 3 — Connect to Rive

1. Open [Rive](https://rive.app) in your browser
2. Open a file in the Rive Editor
3. RiveBar will auto-connect via MCP on `localhost:9791`
4. The status dot turns green when connected

## Auto-Updates

RiveBar checks for updates automatically on launch. When a new version is available, it downloads and installs on next restart.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Damaged app" alert | Run `xattr -cr /Applications/RiveBar.app` in Terminal |
| App won't connect | Make sure Rive is open in a browser tab with a file loaded |
| Tiles not showing | Right-click the grid area → check grid scale is set |
| Update failed error | You may already be on the latest version — check About panel |

## Uninstall


Drag RiveBar from Applications to Trash. Scripts and settings are stored in:
- **macOS:** `~/Library/Application Support/rivebar/`

---

Made with ♥ by [Mysteropodes](https://rive.app/@Mysteropodes/) feedbackScript@outlook.fr for the Rive community.
