"""用 ChromeDriver 验证联机触控流程；桌面模拟不作为手机性能结果。"""
import json
import os
import socket
import subprocess
import time
import urllib.request


def wait(check, timeout=90):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = check()
        if result:
            return result
        time.sleep(0.2)
    raise TimeoutError(check)


def main():
    with socket.socket() as port_probe:
        port_probe.bind(("127.0.0.1", 0))
        port = port_probe.getsockname()[1]
    driver = subprocess.Popen([os.getenv("CHROMEDRIVER", "chromedriver"), f"--port={port}"])
    session = None

    def api(path, data=None, method=None):
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}{path}", method=method,
            data=json.dumps(data).encode() if data is not None else None,
            headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=45) as response:
            return json.load(response)["value"]

    def js(expr):
        return api(session + "/execute/sync", {"script": "return " + expr, "args": []})

    def cdp(cmd, **params):
        return api(session + "/goog/cdp/execute", {"cmd": cmd, "params": params})

    def touch(kind, *points):
        cdp("Input.dispatchTouchEvent", type=kind, touchPoints=[
            {"x": x, "y": y, "id": i} for i, (x, y) in enumerate(points, 1)])

    def ready():
        try:
            return api("/status")["ready"]
        except OSError:
            return False

    try:
        wait(ready, 8)
        session = "/session/" + api("/session", {"capabilities": {"alwaysMatch": {
            "browserName": "chrome", "pageLoadStrategy": "none", "goog:chromeOptions": {
                "args": ["--headless=new", "--no-proxy-server", "--disable-dev-shm-usage",
                         "--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
                "mobileEmulation": {"deviceMetrics": {"width": 390, "height": 844,
                                                      "pixelRatio": 1, "touch": True}},
            }}}})["sessionId"]
        cdp("Emulation.setFocusEmulationEnabled", enabled=True)
        origin = os.getenv("LAND_ORIGIN", "http://192.168.100.25:5173")
        api(session + "/url", {"url": origin + "/?cam=third&multiplayer=1&framecheck=1&debug=1&quality=low&noaudio=1"})
        wait(lambda: js("!!window.__G?.landCamera"))
        js("document.querySelector('.land-enter').click()")
        panel = "document.querySelector('.land-frame-check').textContent"
        baseline = wait(lambda: (t if 'FPS' in (t := js(panel)) else None))
        print("baseline:", baseline, flush=True)
        # 加入同一房间的真实观察连接，通过下行快照核对触控移动。
        js("""(()=>{const w=window.__observer=new WebSocket(`ws://${location.host}/multiplayer?world=land`);
          w.onmessage=e=>{const m=JSON.parse(e.data);if(m.changed?.length)window.__observed=m.changed.at(-1)};
          return true})()""")
        wait(lambda: js("window.__observed?.z===85"))
        pads = js("""Array.from(document.querySelectorAll('.land-touch-pad'), n=>{
          const r=n.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})""")
        left, right = pads
        yaw = js("__G.landCamera.yaw")
        touch("touchStart", left, right)
        touch("touchMove", (left[0], left[1]-28), (right[0]+18, right[1]))
        wait(lambda: js("Math.abs(window.__observed.z-85)>0.3"), 15)
        touch("touchEnd")
        assert abs(js("__G.landCamera.yaw") - yaw) > 0.01, "环顾没有改变朝向"
        together = wait(lambda: (t if "FPS" in (t := js(panel)) and "附近 1 人" in t else None))
        print("with peer:", together, flush=True)
        js("window.__observer.close()")
        wait(lambda: "附近 0 人" in js(panel))
        assert not js("window.__fatal")
        print("PASS: 双指移动/环顾、同步位置、邻居离场与重新采样")
    finally:
        try:
            if session:
                api(session, method="DELETE")
        finally:
            driver.terminate()
            driver.wait(timeout=8)


if __name__ == "__main__":
    main()
