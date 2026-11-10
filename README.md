# BookVoice

BookVoice is a privacy-friendly personal audiobook reader for iPhone, designed as an installable web app.

## Use BookVoice

After GitHub Pages is enabled, open **https://zeebasit.github.io/bookvoice/** in Safari on your iPhone. Tap **Share → Add to Home Screen → Add** to install it like an app.

Tap **Add a book** and select a file using the iPhone Files picker. Supported formats: PDF (text-based), EPUB, DOCX, TXT, Markdown, and HTML. Choose a voice and speed, then tap Play. Books and reading positions are saved locally in your browser where available.

## Publish with GitHub Pages

1. In GitHub, open this repository → **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Choose branch **main**, folder **/(root)**, then **Save**.
4. Open **https://zeebasit.github.io/bookvoice/** once deployment completes.

## Notes

- Imported books are processed on the device; the app does not upload book contents to a server.
- PDF/EPUB/DOCX extraction relies on third-party JavaScript libraries delivered via cdnjs. Internet access is required on first use.
- Image-only/scanned PDFs cannot be read without OCR.
- Apple iOS Safari may interrupt speech when the screen locks or when switching apps. Reliable background audio requires a native iOS app.
- Browser storage can be cleared by iOS or by the user; keep originals in the Files app.
- Copyright-protected / DRM-restricted ebooks generally cannot be imported.
