import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let _ = (scene as? UIWindowScene) else { return }
        
        // Handle deep links when app launches from a terminated state
        if let urlContext = connectionOptions.urlContexts.first {
            handleDeepLink(urlContext.url)
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        // Handle deep links when app is already running in background or foreground
        if let urlContext = URLContexts.first {
            handleDeepLink(urlContext.url)
        }
    }

    private func handleDeepLink(_ url: URL) {
        guard url.scheme == "mpplayer" else { return }
        
        // Scheme pattern: mpplayer://playpause, mpplayer://next, mpplayer://prev
        let action = url.host ?? ""
        print("[SceneDelegate] Received Widget Action Deep Link: \(action)")
        
        // Find the root ViewController and execute the action in PWA
        if let rootVC = window?.rootViewController as? ViewController {
            rootVC.triggerPlayerAction(action)
        } else {
            // If the view hierarchy is not ready, defer the action or wait briefly
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                if let rootVC = self.window?.rootViewController as? ViewController {
                    rootVC.triggerPlayerAction(action)
                }
            }
        }
    }
}
