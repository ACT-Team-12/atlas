# ATLAS for iPhone

The native iOS app for ATLAS. It does the things the web app cannot:

- **Reads the paper on the phone.** VisionKit document camera to scan, Vision text recognition (accurate, language correction on) to read it. The photo never leaves the phone. The person checks and edits the recognized text, and only that text is sent.
- **Reminders.** "Remind me" on any care step or plan step schedules a local notification with the step title and the line quoted from the paper. Works offline. All reminders are listed with delete.
- **Read aloud** with the phone's voices in the chosen language, one line at a time, with a Stop button.
- **Saved on this phone.** The last care steps and plan are kept in Application Support (excluded from backup). "Clear from this phone" removes them and the ATLAS reminders.
- **Call, directions, links.** `tel:` buttons, Apple Maps transit directions, program pages in an in-app browser.

It talks to the same live server as the web app (`https://atlas-team12.vercel.app`, `/api/extract` and `/api/plan`). There is no mock data in the app. The only built-in text is the labeled sample paper, copied byte for byte from `web/src/lib/sample.ts`.

## Build and test

Needs Xcode 26 and XcodeGen (`brew install xcodegen`).

```sh
cd mobile/ios
xcodegen generate
xcodebuild -project ATLAS.xcodeproj -scheme ATLAS \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5' test
```

`ATLAS.xcodeproj` is generated from `project.yml` and is not committed.

## Layout

```
project.yml            XcodeGen project spec (iOS 17+, Swift 6, bundle id com.stephensookra.atlas)
ATLAS/App              App entry, AppModel (flow state, API calls, saving)
ATLAS/Models           Codable mirrors of web/src/lib/schema.ts, plan.ts, resources.ts
ATLAS/Services         APIClient, TextRecognizer (Vision), Reminders, Speaker, SessionStore, LocationProvider
ATLAS/Views            Home, Check the text, Your steps, What gets in the way, Your plan, Reminders, About
ATLAS/Support          Theme (web palette), Sample (generated)
ATLASTests             Swift Testing suite; Fixtures/ are real responses captured from the live API
scripts/               capture_fixtures.py, gen_sample.py, make_images.py (icon + sample paper picture)
screenshots/           Simulator screenshots of the real flow against the live API
```

## Scripts

- `python3 scripts/capture_fixtures.py` re-captures the test fixtures from the live API with the sample paper.
- `python3 scripts/gen_sample.py` regenerates `Sample.swift` from the web sample. A test fails if they drift.
- `python3 scripts/make_images.py` draws the app icon and a picture of the sample paper (`scripts/out/sample-paper.png`). Add that picture to a Simulator with `xcrun simctl addmedia booted scripts/out/sample-paper.png` to test reading a photo.

## Simulator notes

The document camera has no camera in the Simulator, so "Scan my paper" opens the photo picker there. On a real phone it opens the document camera.

## Privacy

Photos are read on the phone. Only the checked text, the barriers, a ZIP or (if allowed) a one-time location, the language and the optional note are sent. Location is never saved. No analytics, no tracking, no third-party code. Privacy policy: https://atlas-team12.vercel.app/privacy (linked in the app on the first screen and in About).

ATLAS explains your paper. It is not medical advice. Check with your doctor or clinic before changing anything.
