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
let collapsedKey = "agentdesk.panel.collapsed"
let expandedHKey = "agentdesk.panel.expandedHeight"
let collapsedH: CGFloat = 38          // 只留 header 那一条

final class Controller: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    var panel: NSPanel!
    var web: WKWebView!
    var retryTimer: Timer?
    var expandedHeight: CGFloat = 480
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
        panel.minSize = NSSize(width: 240, height: collapsedH)   // 要能收到只剩一条

        let cfg = WKWebViewConfiguration()
        cfg.suppressesIncrementalRendering = false
        // 网页改不了窗口尺寸，得让它把折叠意图发回来
        cfg.userContentController.add(self, name: "panel")
        web = WKWebView(frame: panel.contentLayoutRect, configuration: cfg)
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        panel.contentView?.addSubview(web)

        expandedHeight = UserDefaults.standard.object(forKey: expandedHKey) as? CGFloat ?? rect.height
        load()
        panel.orderFrontRegardless()
        // 恢复上次的折叠状态，不然每次开都是展开的
        if UserDefaults.standard.bool(forKey: collapsedKey) { setCollapsed(true, animate: false) }
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
        let on = panel.frame.height <= collapsedH + 1
        w.evaluateJavaScript("window.__setCollapsed && window.__setCollapsed(\(on))", completionHandler: nil)
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

    func userContentController(_ uc: WKUserContentController, didReceive msg: WKScriptMessage) {
        guard let body = msg.body as? [String: Any], let action = body["action"] as? String else { return }
        if action == "collapse" { setCollapsed(true) }
        else if action == "expand" { setCollapsed(false) }
    }

    // 折叠时窗口向下收，顶边不动 —— 否则收起来位置会乱跳
    // （macOS 坐标原点在左下角，所以要同时改 origin.y）
    func setCollapsed(_ on: Bool, animate: Bool = true) {
        var f = panel.frame
        if on {
            if f.height > collapsedH + 1 {
                expandedHeight = f.height
                UserDefaults.standard.set(expandedHeight, forKey: expandedHKey)
            }
            f.origin.y += f.height - collapsedH
            f.size.height = collapsedH
        } else {
            let target = max(expandedHeight, 200)
            f.origin.y -= target - f.height
            f.size.height = target
        }
        panel.setFrame(f, display: true, animate: animate)
        UserDefaults.standard.set(on, forKey: collapsedKey)
        web.evaluateJavaScript("window.__setCollapsed && window.__setCollapsed(\(on))", completionHandler: nil)
    }

    func windowDidMove(_ n: Notification) { saveFrame() }
    func windowDidResize(_ n: Notification) { saveFrame() }
    func saveFrame() {
        UserDefaults.standard.set(NSStringFromRect(panel.frame), forKey: frameKey)
        if panel.frame.height > collapsedH + 1 {
            expandedHeight = panel.frame.height
            UserDefaults.standard.set(expandedHeight, forKey: expandedHKey)
        }
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
