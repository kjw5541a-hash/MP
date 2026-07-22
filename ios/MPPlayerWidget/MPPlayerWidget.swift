import WidgetKit
import SwiftUI

// --- DATA MODEL ---
struct MusicWidgetEntry: TimelineEntry {
    let date: Date
    let title: String
    let artist: String
    let isPlaying: Bool
    let duration: Double
    let currentTime: Double
    let isPlaceholder: Bool
}

// --- TIMELINE PROVIDER ---
struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> MusicWidgetEntry {
        MusicWidgetEntry(
            date: Date(),
            title: "재생 중인 곡 없음",
            artist: "음악을 선택해 주세요",
            isPlaying: false,
            duration: 180.0,
            currentTime: 45.0,
            isPlaceholder: true
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (MusicWidgetEntry) -> ()) {
        let entry = readSharedData()
        completion(entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> ()) {
        let entry = readSharedData()
        // iOS widgets refresh automatically when the app calls WidgetCenter.shared.reloadAllTimelines()
        // So we don't need a frequent periodic update timeline.
        let timeline = Timeline(entries: [entry], policy: .atEnd)
        completion(timeline)
    }
    
    private func readSharedData() -> MusicWidgetEntry {
        guard let defaults = UserDefaults(suiteName: "group.com.jw.mpplayer") else {
            return MusicWidgetEntry(
                date: Date(),
                title: "재생 중인 곡 없음",
                artist: "설정이 필요합니다",
                isPlaying: false,
                duration: 0.0,
                currentTime: 0.0,
                isPlaceholder: false
            )
        }
        
        let title = defaults.string(forKey: "widget_track_title") ?? "재생 중인 곡 없음"
        let artist = defaults.string(forKey: "widget_track_artist") ?? "음악을 선택해 주세요"
        let isPlaying = defaults.bool(forKey: "widget_is_playing")
        let duration = defaults.double(forKey: "widget_duration")
        let currentTime = defaults.double(forKey: "widget_current_time")
        
        return MusicWidgetEntry(
            date: Date(),
            title: title,
            artist: artist,
            isPlaying: isPlaying,
            duration: duration,
            currentTime: currentTime,
            isPlaceholder: false
        )
    }
}

// --- VIEW COMPONENTS (SWIFTUI) ---
struct MPPlayerWidgetEntryView : View {
    var entry: Provider.Entry
    @Environment(\.widgetFamily) var family

    var body: some View {
        ZStack {
            // Premium Dark Aesthetic Background (Matches PWA theme)
            Color(red: 13/255, green: 14/255, blue: 21/255)
                .ignoresSafeArea()
            
            // Neon Glow Orb in background
            RadialGradient(
                gradient: Gradient(colors: [Color(red: 111/255, green: 34/255, blue: 244/255).opacity(0.15), Color.clear]),
                center: .topTrailing,
                startRadius: 5,
                endRadius: 120
            )
            .ignoresSafeArea()

            switch family {
            case .systemSmall:
                SmallWidgetView(entry: entry)
            case .systemMedium:
                MediumWidgetView(entry: entry)
            default:
                SmallWidgetView(entry: entry)
            }
        }
    }
}

// --- SMALL WIDGET LAYOUT ---
struct SmallWidgetView: View {
    let entry: MusicWidgetEntry
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                // Vinyl / Music Icon with neon outline
                ZStack {
                    Circle()
                        .fill(Color(red: 24/255, green: 26/255, blue: 38/255))
                        .frame(width: 36, height: 36)
                        .overlay(
                            Circle()
                                .stroke(
                                    LinearGradient(colors: [Color.cyan, Color.purple], startPoint: .topLeading, endPoint: .bottomTrailing),
                                    lineWidth: 1.5
                                )
                        )
                    Image(systemName: "music.note")
                        .foregroundColor(.cyan)
                        .font(.system(size: 14, weight: .bold))
                }
                
                Spacer()
                
                // Play Status Indicator
                if entry.isPlaying {
                    Image(systemName: "waveform")
                        .foregroundColor(.green)
                        .font(.system(size: 12))
                }
            }
            
            Spacer()
            
            // Track Info
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.title)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(.white)
                    .lineLimit(1)
                
                Text(entry.artist)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(Color.white.opacity(0.6))
                    .lineLimit(1)
            }
            
            // Static Progress bar
            ProgressView(value: entry.duration > 0 ? entry.currentTime / entry.duration : 0.0)
                .progressViewStyle(LinearProgressViewStyle(tint: Color.cyan))
                .background(Color.white.opacity(0.1))
                .scaleEffect(x: 1, y: 0.5, anchor: .center)
                .cornerRadius(2)
            
            // Widget URL link to launch PWA and trigger Play/Pause toggle
            Link(destination: URL(string: "mpplayer://playpause")!) {
                HStack {
                    Spacer()
                    Image(systemName: entry.isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(.white)
                    Text(entry.isPlaying ? "Pause" : "Play")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.white)
                    Spacer()
                }
                .padding(.vertical, 6)
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color(red: 24/255, green: 26/255, blue: 38/255))
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(Color.white.opacity(0.1), lineWidth: 1)
                        )
                )
            }
        }
        .padding(12)
    }
}

// --- MEDIUM WIDGET LAYOUT ---
struct MediumWidgetView: View {
    let entry: MusicWidgetEntry
    
    var body: some View {
        HStack(spacing: 16) {
            // Album Art placeholder (Glassmorphic Neumorphic look)
            ZStack {
                RoundedRectangle(cornerRadius: 16)
                    .fill(Color(red: 20/255, green: 22/255, blue: 34/255))
                    .frame(width: 90, height: 90)
                    .overlay(
                        RoundedRectangle(cornerRadius: 16)
                            .stroke(
                                LinearGradient(colors: [Color.cyan.opacity(0.5), Color.purple.opacity(0.5)], startPoint: .topLeading, endPoint: .bottomTrailing),
                                lineWidth: 1.5
                            )
                    )
                
                Image(systemName: "music.note.list")
                    .font(.system(size: 32))
                    .foregroundStyle(
                        LinearGradient(colors: [Color.cyan, Color.purple], startPoint: .topLeading, endPoint: .bottomTrailing)
                    )
            }
            
            // Main control section
            VStack(alignment: .leading, spacing: 8) {
                // Metadata
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.title)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(.white)
                        .lineLimit(1)
                    
                    Text(entry.artist)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(Color.white.opacity(0.6))
                        .lineLimit(1)
                }
                
                // Track Timeline Bar
                VStack(spacing: 2) {
                    ProgressView(value: entry.duration > 0 ? entry.currentTime / entry.duration : 0.0)
                        .progressViewStyle(LinearProgressViewStyle(tint: Color.cyan))
                        .background(Color.white.opacity(0.1))
                        .cornerRadius(2)
                    
                    HStack {
                        Text(formatTime(entry.currentTime))
                            .font(.system(size: 9))
                            .foregroundColor(.white.opacity(0.4))
                        Spacer()
                        Text(formatTime(entry.duration))
                            .font(.system(size: 9))
                            .foregroundColor(.white.opacity(0.4))
                    }
                }
                
                // Player Controls (Using deep links to communicate with SceneDelegate)
                HStack(spacing: 24) {
                    Spacer()
                    
                    Link(destination: URL(string: "mpplayer://prev")!) {
                        Image(systemName: "backward.fill")
                            .font(.system(size: 16))
                            .foregroundColor(.white)
                    }
                    
                    Link(destination: URL(string: "mpplayer://playpause")!) {
                        ZStack {
                            Circle()
                                .fill(Color.white)
                                .frame(width: 32, height: 32)
                            Image(systemName: entry.isPlaying ? "pause.fill" : "play.fill")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundColor(Color(red: 13/255, green: 14/255, blue: 21/255))
                        }
                    }
                    
                    Link(destination: URL(string: "mpplayer://next")!) {
                        Image(systemName: "forward.fill")
                            .font(.system(size: 16))
                            .foregroundColor(.white)
                    }
                    
                    Spacer()
                }
            }
        }
        .padding(16)
    }
    
    // Time formatting helper
    private func formatTime(_ time: Double) -> String {
        guard !time.isNaN else { return "0:00" }
        let minutes = Int(time) / 60
        let seconds = Int(time) % 60
        return String(format: "%d:%02d", minutes, seconds)
    }
}

// --- WIDGET EXPORT DEFINITION ---
@main
struct MPPlayerWidget: Widget {
    let kind: String = "MPPlayerWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            MPPlayerWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("MP Music Player")
        .description("원격으로 음악을 조작하고 실시간 곡 정보를 확인하세요.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
