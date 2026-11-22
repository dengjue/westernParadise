"""用 ChromeDriver 验证联机触控流程；桌面模拟不作为手机性能结果。"""
import json
import os
import socket
import subprocess
import time
import urllib.request
import argparse
from pathlib import Path


def wait(check, timeout=90):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = check()
        if result:
            return result
        time.sleep(0.2)
    raise TimeoutError(check)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gpu-crowd", action="store_true",
                        help="在独立回环测试站用硬件 GPU 测 0/5/15/0 个移动角色")
    crowd = parser.parse_args().gpu_crowd
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

    def crowd_samples():
        gpu = js("""(()=>{const gl=__G.renderer.getContext(),e=gl.getExtension('WEBGL_debug_renderer_info');
          return e && gl.getParameter(e.UNMASKED_RENDERER_WEBGL)})()""")
        if not gpu or any(x in gpu.lower() for x in ("swiftshader", "llvmpipe", "software", "softpipe")):
            raise RuntimeError(f"无法确认硬件 GPU：{gpu}")
        print("renderer:", gpu, flush=True)
        for n in (0, 5, 15, 0):
            peers = subprocess.Popen(["node", str(Path(__file__).with_name("render-crowd-peers.mjs")), str(n)]) if n else None
            try:
                # 只计视锥内的角色中心；不能把“已同步”误认为“同屏”。
                visible = """(()=>{const g=__G, peers=g.scene.getObjectByName('courtyard-remote-players').children;
                  return peers.filter(p=>{const v=p.position.clone();v.y+=.8;v.project(g.camera);
                  return p.visible && [v.x,v.y,v.z].every(c=>Math.abs(c)<1)}).length})()"""
                time.sleep(5)  # 等待队形就位、分区与 GPU 预热。
                wait(lambda: js(visible) == n)
                js("""(()=>{const g=__G;window.__sampleRows=[];let last, gaps=[];
                  window.__endSample=g.events.on('app:frame',()=>{const t=performance.now();
                  if(last!==undefined) gaps.push(t-last);last=t;
                  if(gaps.length && (t-(window.__sampleStart??=t))>=10000){
                    const elapsed=gaps.reduce((a,b)=>a+b,0);gaps.sort((a,b)=>a-b);
                    window.__sampleRows.push({fps:1000*gaps.length/elapsed,p95:gaps[Math.ceil(.95*gaps.length)-1],
                      calls:g.renderer.info.render.calls,buffer:[g.renderer.domElement.width,g.renderer.domElement.height]});
                    window.__sampleStart=t;gaps=[];}});return true})()""")
                def finished():
                    current = js(visible)
                    if current != n:
                        raise RuntimeError(f"采样期间视锥内角色数由 {n} 变为 {current}")
                    return js("window.__sampleRows.length>=2")
                wait(finished)
                assert js(visible) == n
                assert not js("window.__fatal")
                print(json.dumps({"onScreen": n, "windows": js("window.__sampleRows.slice(0,2)"),
                                  "panel": js("document.querySelector('.land-frame-check').textContent")}, ensure_ascii=False), flush=True)
                js("(window.__endSample(),delete window.__sampleStart)")
            finally:
                if peers:
                    peers.terminate()
                    peers.wait(timeout=8)

    try:
        wait(ready, 8)
        session = "/session/" + api("/session", {"capabilities": {"alwaysMatch": {
            "browserName": "chrome", "pageLoadStrategy": "none", "goog:chromeOptions": {
                "args": ["--headless=new", "--no-proxy-server", "--disable-dev-shm-usage",
                         *(["--use-gl=angle", "--use-angle=gl", "--ozone-platform=x11"] if crowd
                           else ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"])],
                "mobileEmulation": {"deviceMetrics": {"width": 390, "height": 844,
                                                      "pixelRatio": 1, "touch": True}},
            }}}})["sessionId"]
        cdp("Emulation.setFocusEmulationEnabled", enabled=True)
        origin = "http://127.0.0.1:5173" if crowd else os.getenv("LAND_ORIGIN", "http://192.168.100.25:5173")
        api(session + "/url", {"url": origin + "/?cam=third&multiplayer=1&framecheck=1&debug=1&quality=low&noaudio=1"})
        wait(lambda: js("!!window.__G?.landCamera"))
        js("document.querySelector('.land-enter').click()")
        panel = "document.querySelector('.land-frame-check').textContent"
        baseline = wait(lambda: (t if 'FPS' in (t := js(panel)) else None))
        print("baseline:", baseline, flush=True)
        if crowd:
            crowd_samples()
            return
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
