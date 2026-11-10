# BookVoice Lab — native iPhone voice quality test

A **separate, offline native prototype** that sits alongside the existing BookVoice Safari web app. It does not alter the original website.

## What it tests

- SwiftUI iPhone interface and AVSpeechSynthesizer
- Downloaded English, especially American English, voices grouped by system-exposed quality (Premium > Enhanced > Standard)
- Voice selection, text editing, speaking rate, play/pause/resume/stop
- Importing plain-text (.txt) files and *text-based* PDF files
- Background audio configuration for initial testing (lock-screen operation must be validated on the actual phone)

The app has no network requests, cloud APIs, advertising, analytics, login, or third-party code libraries. It does not ask for Apple credentials. Text remains on the device and is not intentionally persisted after closing this test app. DRM-protected/image-only PDFs aren't supported.

## Download unsigned build

1. Open GitHub repository **Actions → Build BookVoice iPhone Test**, select the most recent successful run.
2. Under **Artifacts**, download **BookVoiceLab-iPhone-unsigned-IPA**.
3. Extract that GitHub artifact ZIP on your Windows computer to get **BookVoiceLab-unsigned.ipa**.

The GitHub Actions runner uses macOS/Xcode to create an **unsigned** iPhone IPA; GitHub cannot sign it to your personal device without your credentials. Do not upload credentials or certificates to this public repository.

## Install with Windows

1. Review third-party installer security/privacy practices before using it. Obtain Sideloadly from https://sideloadly.io/.
2. Its current Windows guidance requires Apple-provided iTunes/iCloud desktop components (not the Microsoft Store versions).
3. Connect the iPhone over USB and trust the computer; on recent iOS versions you may need to enable **Developer Mode** after installing, under Settings → Privacy & Security.
4. Drag **BookVoiceLab-unsigned.ipa** into Sideloadly, choose the iPhone, and sign/install using an Apple Account entered **only in the installer on your PC**, never on GitHub or in ChatGPT.
5. Launch BookVoice Lab, choose one of your downloaded Premium/Enhanced voices and press Play. Listen and check the actual quality.

A free Apple Account-signed installation generally expires after **7 days**. Sideloadly offers optional automatic re-signing while the iPhone and Windows PC can connect. The third-party signing utility is a separate trust consideration and is not part of our app.

## If no premium voice appears

Apple's native API can enumerate quality classes of speech voices, but availability may differ from the voices listed under iPhone Accessibility settings. This prototype is **specifically intended to verify** what is actually accessible to a native app on your phone. Use its Refresh button after voice downloads.

## Build sources

- project.yml: XcodeGen specification (generates the .xcodeproj in the GitHub runner)
- BookVoiceLab/ContentView.swift: all application UI/voice logic
- BookVoiceLab/Info.plist: iOS app metadata
- .github/workflows/bookvoice-ios.yml: workflow in the repository root

No paid Apple Developer membership is required for the build. Free installation requires device signing through a separate Windows sideloading utility.
