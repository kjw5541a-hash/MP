import UIKit
import WebKit
import WidgetKit

class ViewController: UIViewController, WKScriptMessageHandler {
    var webView: WKWebView!
    
    override func viewDidLoad() {
        super.viewDidLoad()
        self.view.backgroundColor = UIColor(red: 13/255, green: 14/255, blue: 21/255, alpha: 1.0) // Matches neon-dark theme
        setupWebView()
        loadMusicPlayer()
    }
    
    private func setupWebView() {
        let contentController = WKUserContentController()
        contentController.add(self, name: "widgetHandler")
        
        let config = WKWebViewConfiguration()
        config.userContentController = contentController
        
        // Premium PWA playback settings
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        
        // Setup frame and webview
        var webViewFrame = self.view.bounds
        // Account for iOS status bar and safe area if necessary, or let web handle it
        webView = WKWebView(frame: webViewFrame, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.navigationDelegate = self
        webView.backgroundColor = .clear
        webView.isOpaque = false
        
        // Swipe navigation back/forward gesture
        webView.allowsBackForwardNavigationGestures = true
        
        self.view.addSubview(webView)
    }
    
    private func loadMusicPlayer() {
        // Edit this URL to point to your hosted web app URL (e.g. GitHub Pages or Vercel)
        // For local development on your Mac with iOS Simulator, you can change this to "http://localhost:5173"
        let appUrlString = "https://kjw5541a-hash.github.io/mp-player" 
        guard let url = URL(string: appUrlString) else {
            print("Invalid URL format")
            return
        }
        
        let request = URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 30)
        webView.load(request)
    }
    
    // --- JS BRIDGE: RECEIVING METADATA FROM PWA ---
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "widgetHandler" else { return }
        
        if let body = message.body as? [String: Any] {
            let title = body["title"] as? String ?? "재생 중인 곡 없음"
            let artist = body["artist"] as? String ?? "음악을 선택해 주세요"
            let isPlaying = body["isPlaying"] as? Bool ?? false
            let duration = body["duration"] as? Double ?? 0.0
            let currentTime = body["currentTime"] as? Double ?? 0.0
            
            updateSharedWidgetData(title: title, artist: artist, isPlaying: isPlaying, duration: duration, currentTime: currentTime)
        }
    }
    
    private func updateSharedWidgetData(title: String, artist: String, isPlaying: Bool, duration: Double, currentTime: Double) {
        // App Groups: 'group.com.jw.mpplayer' should be configured in Xcode project capabilities
        if let defaults = UserDefaults(suiteName: "group.com.jw.mpplayer") {
            defaults.set(title, forKey: "widget_track_title")
            defaults.set(artist, forKey: "widget_track_artist")
            defaults.set(isPlaying, forKey: "widget_is_playing")
            defaults.set(duration, forKey: "widget_duration")
            defaults.set(currentTime, forKey: "widget_current_time")
            defaults.set(Date().timeIntervalSince1970, forKey: "widget_last_update")
            
            // Trigger WidgetKit to reload home screen widgets in real time
            WidgetCenter.shared.reloadAllTimelines()
            print("[Bridge] Shared widget data updated: \(title) - \(artist) (Playing: \(isPlaying))")
        } else {
            print("[Bridge] ERROR: Could not initialize shared App Group UserDefaults suite 'group.com.jw.mpplayer'")
        }
    }
    
    // --- WIDGET CONTROL: EXECUTING JS ACTIONS IN PWA ---
    func triggerPlayerAction(_ action: String) {
        let jsCode = "if (window.handleWidgetAction) { window.handleWidgetAction('\(action)'); }"
        webView.evaluateJavaScript(jsCode) { (result, error) in
            if let error = error {
                print("[Bridge] JS Execution Error: \(error.localizedDescription)")
            } else {
                print("[Bridge] Executed action: \(action)")
            }
        }
    }
}

extension ViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        print("[WebView] Finished loading PWA music player")
    }
    
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        print("[WebView] Load failed provisional: \(error.localizedDescription)")
    }
}
