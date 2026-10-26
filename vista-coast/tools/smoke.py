import sys, time, json, subprocess, os
from playwright.sync_api import sync_playwright
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/claude-0/shots'
os.makedirs(out, exist_ok=True)
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '--directory', 'dist'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
logs = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=4096'])
        W = int(os.environ.get('VW', '640')); H = int(os.environ.get('VH', '360'))
        pg = b.new_page(viewport={'width': W, 'height': H})
        tier = os.environ.get('TIER', 'low')
        pg.add_init_script("try{localStorage.setItem('vistacoast.settings', JSON.stringify({tier:'%s', resScale: 1, shadows: %s, autoQuality:false, fpsLimit:0}))}catch(e){}" % (tier, os.environ.get('SHADOWS','false')))
        pg.set_default_timeout(240000)
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        t0 = time.time()
        pg.goto('http://localhost:8765/standalone.html' + os.environ.get('Q', ''))
        for k in range(360):
            try:
                vis = pg.evaluate("() => [document.getElementById('title').style.display, document.getElementById('loadmsg').textContent, document.getElementById('err').textContent.slice(0,400)]")
            except Exception as e:
                print('eval failed', e); raise
            if k % 10 == 0: print(k, vis)
            if vis[0] == 'flex' or vis[2]: break
            pg.wait_for_timeout(500)
        print('title after', round(time.time() - t0, 1), 's')
        pg.wait_for_timeout(1500)
        pg.screenshot(path=f'{out}/01_title.png')
        pg.click('#btnNew')
        pg.wait_for_timeout(4000)
        pg.screenshot(path=f'{out}/02_start.png')
        # skip dialog lines
        for i in range(6):
            pg.keyboard.press('Enter'); pg.wait_for_timeout(300)
        pg.keyboard.down('KeyW'); pg.wait_for_timeout(2500); pg.keyboard.up('KeyW')
        pg.screenshot(path=f'{out}/03_walk.png')
        info = pg.evaluate("() => { const g = window.__game; return { state: g.state, p: [g.player.x, g.player.y, g.player.z], mode: g.player.mode, veh: g.vehicles.list.length, peds: g.pedSys.peds.length, calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles, mission: g.missions.active && g.missions.active.id, step: g.missions.step && g.missions.step.t } }")
        print(json.dumps(info))
        b.close()
finally:
    srv.terminate()
    seen = set(); outl = []
    for l in logs:
        key = l[:160]
        if key in seen: continue
        seen.add(key)
        if 'ERROR' in l or 'pageerror' in l or '[error]' in l:
            # keep only the error lines of shader dumps
            lines = [x for x in l.split('\n') if 'ERROR' in x or 'pageerror' in x or 'THREE' in x][:8]
            outl.append(' | '.join(lines)[:600])
        else:
            outl.append(l[:200])
    print('\n'.join(outl[:60]))
