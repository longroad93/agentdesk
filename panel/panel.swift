// agentdesk 桌面悬浮面板。
//
// 为什么不用 Electron/Tauri：为了显示十几行文字装 100MB 运行时不值当。
// 这个壳只有一件事 —— 把 localhost 的面板塞进一个置顶的 NSPanel。
// 用系统自带的 swiftc 编译，不需要 Xcode，不需要任何系统权限，
// 所以也不会碰 TCC 授权那套东西。
//
// 编译：swiftc -O -o agentdesk-panel panel.swift -framework Cocoa -framework WebKit

import Cocoa
import WebKit

let defaultURL = "http://localhost:4517/?compact=1"
let frameKey = "agentdesk.panel.frame"

final class Controller: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate {
    var panel: NSPanel!
    var web: WKWebView!
    var retryTimer: Timer?
    let url: URL

    init(url: URL) {
        self.url = url
        super.init()
    }

    func applicationDidFinishLaunching(_ note: Notification) {
        let w: CGFloat = 340, h: CGFloat = 480
        let vis = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        var rect = NSRect(x: vis.maxX - w - 24, y: vis.maxY - h - 24, width: w, height: h)
        if let saved = UserDefaults.standard.string(forKey: frameKey) {
            let r = NSRectFromString(saved)
            if r.width > 120 && r.height > 120 { rect = r }
        }

        // nonactivatingPanel: 点面板不会把焦点从你正在打字的窗口抢走
        panel = NSPanel(contentRect: rect,
                        styleMask: [.nonactivatingPanel, .titled, .closable, .resizable, .fullSizeContentView],
                        backing: .buffered, defer: false)
        panel.level = .floating
        // 切到别的桌面/全屏应用时也跟着走，不然"常驻"就是假的
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary]
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.titlebarAppearsTransparent = true
        panel.titleVisibility = .hidden
        panel.isMovableByWindowBackground = true      // 拖窗口任意位置都能移动
        panel.delegate = self
        panel.minSize = NSSize(width: 260, height: 200)

        let cfg = WKWebViewConfiguration()
        cfg.suppressesIncrementalRendering = false
        web = WKWebView(frame: panel.contentLayoutRect, configuration: cfg)
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        panel.contentView?.addSubview(web)

        load()
        panel.orderFrontRegardless()
    }

    func load() {
        web.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
    }

    // 服务没起或重启时，别停在错误页上，自己重试
    func webView(_ w: WKWebView, didFail nav: WKNavigation!, withError e: Error) { scheduleRetry() }
    func webView(_ w: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError e: Error) {
        showWaiting()
        scheduleRetry()
    }
    func webView(_ w: WKWebView, didFinish nav: WKNavigation!) {
        retryTimer?.invalidate(); retryTimer = nil
    }

    func showWaiting() {
        let html = """
        <html><head><meta charset="utf-8"><style>
        body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
        font:13px -apple-system,sans-serif;color:#8b8b95;background:transparent;text-align:center;line-height:1.7}
        code{background:rgba(127,127,127,.15);padding:2px 6px;border-radius:5px;font-size:12px}
        </style></head><body><div>agentdesk 服务没在跑<br><code>agentdesk</code><br>起来后这里会自己连上</div></body></html>
        """
        web.loadHTMLString(html, baseURL: nil)
    }

    func scheduleRetry() {
        guard retryTimer == nil else { return }
        retryTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            self?.load()
        }
    }

    func windowDidMove(_ n: Notification) { saveFrame() }
    func windowDidResize(_ n: Notification) { saveFrame() }
    func saveFrame() {
        UserDefaults.standard.set(NSStringFromRect(panel.frame), forKey: frameKey)
    }
    func windowWillClose(_ n: Notification) { NSApp.terminate(nil) }
}

let target = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : defaultURL
guard let u = URL(string: target) else {
    FileHandle.standardError.write("用法: agentdesk-panel [url]\n".data(using: .utf8)!)
    exit(1)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)      // 不在 Dock 占位，不抢 Cmd+Tab
let controller = Controller(url: u)
app.delegate = controller
app.run()
