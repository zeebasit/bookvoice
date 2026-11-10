import SwiftUI
import AVFoundation
import PDFKit
import UniformTypeIdentifiers

/// No accounts, third-party SDKs, analytics, or network requests.
final class VoiceLabModel: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    @Published var text = """
    Welcome to BookVoice. This is the native iPhone voice-quality test.

    You can select an Enhanced or Premium American English voice that you have downloaded on your iPhone. Choose the narrator you like, then listen to this sample.

    If the voice sounds good, we can build the complete audiobook reader next. For now, you can also import a text-based PDF or a plain text document to try your own content.
    """
    @Published var voices: [AVSpeechSynthesisVoice] = []
    @Published var selectedVoiceID: String = ""
    @Published var rate: Double = 0.5
    @Published var status: String = "Ready to listen"
    @Published var playing = false
    @Published var paused = false

    private let synthesizer = AVSpeechSynthesizer()

    override init() {
        super.init()
        synthesizer.delegate = self
        reloadVoices()
    }

    static func qualityLabel(_ voice: AVSpeechSynthesisVoice) -> String {
        switch voice.quality {
        case .premium: return "Premium"
        case .enhanced: return "Enhanced"
        default: return "Standard"
        }
    }

    private static func qualityRank(_ voice: AVSpeechSynthesisVoice) -> Int {
        switch voice.quality {
        case .premium: return 3
        case .enhanced: return 2
        default: return 1
        }
    }

    func reloadVoices() {
        let found = AVSpeechSynthesisVoice.speechVoices()
            .filter { $0.language.lowercased().hasPrefix("en") }
            .sorted {
                let lhsAmerican = $0.language.lowercased() == "en-us"
                let rhsAmerican = $1.language.lowercased() == "en-us"
                if lhsAmerican != rhsAmerican { return lhsAmerican }
                let left = Self.qualityRank($0), right = Self.qualityRank($1)
                if left != right { return left > right }
                return $0.name.localizedStandardCompare($1.name) == .orderedAscending
            }
        voices = found

        if !found.contains(where: { $0.identifier == selectedVoiceID }) {
            selectedVoiceID = found.first?.identifier ?? ""
        }
        if found.isEmpty {
            status = "No English speech voices available. Check iPhone voice settings."
        }
    }

    var currentVoice: AVSpeechSynthesisVoice? {
        voices.first { $0.identifier == selectedVoiceID }
    }

    func playOrPause() {
        if synthesizer.isPaused {
            if synthesizer.continueSpeaking() {
                paused = false
                playing = true
                status = "Narrating..."
            }
            return
        }

        if synthesizer.isSpeaking {
            if synthesizer.pauseSpeaking(at: .word) {
                paused = true
                status = "Paused"
            }
            return
        }

        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            status = "Enter or import some text first."
            return
        }

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .spokenAudio, options: [])
            try session.setActive(true)
        } catch {
            status = "Audio setup failed: \(error.localizedDescription)"
            return
        }

        let utterance = AVSpeechUtterance(string: text)
        utterance.rate = Float(rate)
        utterance.pitchMultiplier = 1.0
        utterance.voice = currentVoice ?? AVSpeechSynthesisVoice(language: "en-US")
        synthesizer.speak(utterance)
        paused = false
        playing = true
        status = "Narrating..."
    }

    func stop() {
        synthesizer.stopSpeaking(at: .immediate)
        playing = false
        paused = false
        status = "Ready to listen"
    }

    func loadDocument(_ result: Result<URL, Error>) {
        do {
            let fileURL = try result.get()
            let granted = fileURL.startAccessingSecurityScopedResource()
            defer { if granted { fileURL.stopAccessingSecurityScopedResource() } }
            let data = try Data(contentsOf: fileURL)
            let output: String
            if fileURL.pathExtension.lowercased() == "pdf" {
                guard let document = PDFDocument(data: data), let string = document.string else {
                    status = "Could not extract text from this PDF."
                    return
                }
                output = string
            } else {
                guard let string = String(data: data, encoding: .utf8)
                    ?? String(data: data, encoding: .utf16) else {
                    status = "Text encoding not supported."
                    return
                }
                output = string
            }
            guard output.trimmingCharacters(in: .whitespacesAndNewlines).count > 10 else {
                status = "No readable text found. Image-only PDFs need OCR."
                return
            }
            stop()
            text = output
            status = "Imported \(fileURL.lastPathComponent) — ready to listen"
        } catch {
            status = "Import failed: \(error.localizedDescription)"
        }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer,
                           didFinish utterance: AVSpeechUtterance) {
        DispatchQueue.main.async {
            self.playing = false
            self.paused = false
            self.status = "Finished"
        }
    }
}

struct ContentView: View {
    @StateObject private var reader = VoiceLabModel()
    @State private var importing = false

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("BookVoice · Native Test")
                            .font(.title.bold())
                        Text("Listen using Apple's installed Enhanced and Premium voices.")
                            .foregroundColor(.secondary)
                        Label("Offline · No account · No cloud speech", systemImage: "lock.shield")
                            .font(.caption)
                            .foregroundColor(.green)
                    }

                    GroupBox("Narrator") {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                Text("Available English voices")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                Spacer()
                                Button("Refresh") { reader.reloadVoices() }
                                    .font(.caption)
                            }
                            Picker("Voice", selection: $reader.selectedVoiceID) {
                                ForEach(reader.voices, id: \.identifier) { voice in
                                    Text("\(voice.name) — \(voice.language) · \(VoiceLabModel.qualityLabel(voice))")
                                        .tag(voice.identifier)
                                }
                            }
                            .pickerStyle(.menu)
                            .disabled(reader.voices.isEmpty)
                            if let voice = reader.currentVoice {
                                Text("Selected: \(voice.name) · \(VoiceLabModel.qualityLabel(voice)) · \(voice.language)")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            } else {
                                Text("No voice selected. Download an English voice in iPhone Accessibility settings.")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                            Text("Only voices that iOS makes available to apps are shown. Some voices in Accessibility settings may not appear.")
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        }
                    }

                    GroupBox("Reading speed") {
                        VStack(alignment: .leading) {
                            HStack {
                                Text("Slow")
                                Spacer()
                                Text(String(format: "%.2f", reader.rate))
                                    .monospacedDigit()
                                Spacer()
                                Text("Fast")
                            }
                            .font(.caption)
                            Slider(value: $reader.rate, in: 0.38...0.62, step: 0.02)
                                .accessibilityLabel("Narration speed")
                        }
                    }

                    GroupBox("Text to read") {
                        VStack(alignment: .leading, spacing: 10) {
                            TextEditor(text: $reader.text)
                                .frame(minHeight: 190)
                                .font(.body)
                            Button {
                                importing = true
                            } label: {
                                Label("Import TXT or text-based PDF", systemImage: "doc.badge.plus")
                            }
                            .buttonStyle(.bordered)
                        }
                    }

                    HStack(spacing: 12) {
                        Button {
                            reader.playOrPause()
                        } label: {
                            Label(reader.paused ? "Resume" : reader.playing ? "Pause" : "Play",
                                  systemImage: reader.paused ? "play.fill" : reader.playing ? "pause.fill" : "play.fill")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)

                        Button {
                            reader.stop()
                        } label: {
                            Label("Stop", systemImage: "stop.fill")
                        }
                        .buttonStyle(.bordered)
                    }

                    Text(reader.status)
                        .font(.footnote)
                        .foregroundColor(.secondary)

                    Text("This is a voice-quality prototype, not yet the full EPUB audiobook library. Downloading and installing the unsigned build requires signing on your Windows computer.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding()
            }
            .navigationBarHidden(true)
        }
        .navigationViewStyle(.stack)
        .onChange(of: reader.selectedVoiceID) { _ in
            if reader.playing { reader.stop() }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.plainText, .pdf]) { result in
            reader.loadDocument(result)
        }
    }
}

@main
struct BookVoiceLabApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
