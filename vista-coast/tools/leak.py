"""Run the title loop and gameplay and sample memory/render stats over time."""
import sys, time, json, subprocess, os
from playwright.sync_api import sync_playwright
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '--directory', 'dist'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
SAMPLE = """() => { const g = window.__game; if (!g || !g.renderer) return null; const r = g.renderer;
  return { st: g.state, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize/1e6) : -1, geo: r.info.memory.geometries, tex: r.info.memory.textures,
  prog: r.info.programs ? r.info.programs.length : -1, calls: r.info.render.calls, tris: r.info.render.triangles, frames: r.info.render.frame,
  ft: g.frameTimes && g.frameTimes.length ? Math.round(1000 * g.frameTimes[g.frameTimes.length-1]) : -1 } }"""
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--enable-precise-memory-info', '--js-flags=--max-old-space-size=4096'])
        pg = b.new_page(viewport={'width': int(os.environ.get('VW', '480')), 'height': int(os.environ.get('VH', '270'))})
        pg.add_init_script("try{localStorage.setItem('vistacoast.settings', JSON.stringify({tier:'%s', resScale: 1, shadows: %s, autoQuality:false, fpsLimit:0}))}catch(e){}" % (os.environ.get('TIER', 'low'), os.environ.get('SHADOWS', 'false')))
        pg.set_default_timeout(600000)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)[:300]))
        pg.on('console', lambda m: errs.append(m.text[:300]) if m.type in ('error', 'warning') else None)
        pg.on('crash', lambda: errs.append('PAGE CRASH'))
        t0 = time.time()
        pg.goto('http://localhost:8765/standalone.html')
        started = False
        for k in range(int(os.environ.get('N', '40'))):
            try:
                s = pg.evaluate(SAMPLE)
            except Exception as e:
                print('eval failed', str(e)[:200]); break
            print(round(time.time() - t0), json.dumps(s), flush=True)
            if not started and pg.evaluate("document.getElementById('title').style.display") == 'flex':
                if os.environ.get('PLAY', '1') == '1':
                    pg.click('#btnNew'); started = True
                    for i in range(6): pg.keyboard.press('Enter')
            pg.wait_for_timeout(int(os.environ.get('DT', '3000')))
        if os.environ.get('SHOT'): pg.screenshot(path=os.environ['SHOT'])
        for e in errs[:15]: print('ERR', e)
        b.close()
finally:
    srv.terminate()
