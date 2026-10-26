"""Photo tour: drives the game manually (noloop) through scenarios and saves screenshots.
Usage: python3 tools/shots.py OUTDIR [scenario names...]"""
import sys, time, json, subprocess, os
from playwright.sync_api import sync_playwright

SCEN = {
  # name: dict(player=[x,z,yaw], hour, weather, cam=[x,y,z, lx,ly,lz] (optional free camera), ticks, renders, drive=vehicle spec id)
  'start':      dict(hour=9.5, weather='clear', player=[-1392, 684, 2.5]),
  'title':      dict(hour=17.4, weather='cloudy', title=True),
  'downtown':   dict(player=[60, 30, 0.6], hour=11, weather='clear', cam=[-120, 70, -220, 120, 40, 60]),
  'skyline':    dict(hour=18.3, weather='clear', cam=[1500, 40, 300, 200, 60, -200]),
  'street':     dict(player=[150, 75, 0], hour=14, weather='clear'),
  'rainnight':  dict(player=[300, 75, 0], hour=22.5, weather='storm'),
  'port':       dict(hour=10, weather='cloudy', cam=[860, 45, 560, 1050, 10, 900]),
  'beach':      dict(hour=16.5, weather='clear', cam=[1300, 12, -200, 1500, 2, 200]),
  'sign':       dict(hour=12, weather='clear', cam=[-180, 120, -1250, -180, 90, -1560]),
  'lake':       dict(hour=8, weather='fog', cam=[-830, 30, -1150, -1000, 5, -1240]),
  'airport':    dict(hour=13, weather='clear', cam=[-1250, 40, 760, -1600, 5, 1050]),
  'town':       dict(hour=17, weather='cloudy', cam=[-1350, 25, 150, -1550, 3, -60]),
  'freeway':    dict(hour=12, weather='clear', cam=[700, 40, -200, 675, 10, 100]),
  'rainday':    dict(player=[150, 75, 0], hour=13, weather='heavyRain'),
  'carclose':   dict(player=[150, 75, 0], hour=15.5, weather='clear', drive=True, ticks=2, cam=[154.2, 1.5, 80.5, 150, 0.8, 75]),
  'peds':       dict(player=[160, 40, 0], hour=12, weather='clear', ticks=600, cam=[147, 6, 20, 160, 1, 60]),
  'forest':     dict(hour=12, weather='clear', cam=[-640, 70, -980, -1000, 10, -1240]),
  'carback':    dict(player=[150, 75, 0], hour=14, weather='clear', drive=True, ticks=2, cam=[151.5, 2.4, 68.8, 150, 0.9, 75]),
  'carside':    dict(player=[150, 75, 0], hour=14, weather='clear', drive=True, ticks=2, cam=[146.8, 1.3, 76.0, 150, 0.9, 75.2]),
  'drive':      dict(player=[150, 75, 0], hour=15, weather='clear', drive=True, ticks=180),
  'drivenight': dict(player=[300, -225, 0], hour=21, weather='heavyRain', drive=True, ticks=180),
}

JS = r"""
async (sc) => {
  const g = window.__game; const W = g.W; const STEP = 1/60;
  if (!g.__tour) {
    g.loopStarted = true; g.newGame(); g.start(); g.__tour = true;
    g.hud.setVisible(true);
    const orig = g.post.render.bind(g.post);
    g.post.render = (dt) => { if (window.__hook) window.__hook(g); orig(dt); };
  }
  if (sc.hook) window.__hook = new Function('g', sc.hook); else window.__hook = null;
  if (sc.hideHud) g.hud.setVisible(false);
  g.clock.setHour(sc.hour); g.weather.set(sc.weather, true);
  const p = g.player;
  if (sc.player) {
    if (p.vehicle) { const old = p.vehicle; p.vehicle = null; p.mode = 'foot'; g.vehicles.remove(old); }
    p.teleport(sc.player[0], sc.player[1], sc.player[2]); g.rig.resetBehind(sc.player[2]);
  }
  if (sc.drive) {
    // spawn/enter a car right here
    const v = g.debugSpawnAndEnter ? g.debugSpawnAndEnter() : null;
    if (!v) return 'no debugSpawnAndEnter';
  }
  for (let i = 0; i < (sc.ticks || 30); i++) {
    if (sc.drive) g.input.touchDown('accel');
    g.tick(STEP);
  }
  if (sc.drive) g.input.touchUp('accel');
  const cam = g.rig.cam;
  if (sc.title) { g.state = 'title'; g.titleT = 40; g.titleFrame(STEP); g.state = 'playing'; const r0 = g.renderer.info.render; return { calls: r0.calls, tris: r0.triangles }; }
  W.terrain.update(sc.cam ? new THREE_V(sc.cam[0], sc.cam[1], sc.cam[2]) : cam.position, true);
  for (let r = 0; r < (sc.renders || 2); r++) g.render(STEP, 1, true);
  if (sc.cam) {
    cam.position.set(sc.cam[0], sc.cam[1], sc.cam[2]); cam.lookAt(sc.cam[3], sc.cam[4], sc.cam[5]); cam.updateMatrixWorld();
    W.terrain.update(cam.position, true);
    W.vegetation.update(cam.position, cam.position);
    W.props.update(STEP, cam.position, W.graph, g.simTime, g.q.viewDistance);
    W.water.update(STEP, cam.position, 0.4, g.simTime);
    g.atmoFollow && g.atmoFollow(cam);
    g.post.render(STEP);
  }
  const r = g.renderer.info.render;
  return { calls: r.calls, tris: r.triangles, p: [Math.round(p.x), Math.round(p.y*10)/10, Math.round(p.z)], mode: p.mode };
}
""".replace('new THREE_V(', '({x:').replace("sc.cam[0], sc.cam[1], sc.cam[2]) : cam.position", "sc.cam[0], y: sc.cam[1], z: sc.cam[2]}) : cam.position")

out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/claude-0/shots'
names = sys.argv[2:] or list(SCEN)
os.makedirs(out, exist_ok=True)
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '--directory', 'dist'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--enable-precise-memory-info', '--js-flags=--max-old-space-size=4096'])
        if os.environ.get('MOBILE') == '1':
            ctx = b.new_context(viewport={'width': int(os.environ.get('VW', '780')), 'height': int(os.environ.get('VH', '360'))}, is_mobile=True, has_touch=True, device_scale_factor=float(os.environ.get('DSF', '1')), user_agent='Mozilla/5.0 (Linux; Android 14; 24095PCADG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36')
            pg = ctx.new_page()
        else:
            pg = b.new_page(viewport={'width': int(os.environ.get('VW', '640')), 'height': int(os.environ.get('VH', '360'))})
        pg.add_init_script("try{localStorage.setItem('vistacoast.settings', JSON.stringify({tier:'%s', resScale: 1, shadows: %s, autoQuality:false, fpsLimit:0}))}catch(e){}" % (os.environ.get('TIER', 'low'), os.environ.get('SHADOWS', 'true')))
        pg.set_default_timeout(1200000)
        errs = []
        pg.on('pageerror', lambda e: errs.append('pageerror ' + str(e)[:400]))
        pg.on('console', lambda m: errs.append(m.text[:400]) if m.type == 'error' else None)
        pg.on('crash', lambda: errs.append('PAGE CRASH'))
        t0 = time.time()
        pg.goto('http://localhost:8765/standalone.html?noloop=1')
        pg.wait_for_function("() => window.__ready === true || document.getElementById('err').textContent.length > 0", polling=500)
        pg.evaluate("document.getElementById('loading').style.display='none'")
        print('loaded', round(time.time() - t0, 1), flush=True)
        if os.environ.get('NOHUD') == '1': pg.add_style_tag(content='body > *:not(canvas){display:none !important}')
        hooks = json.loads(os.environ.get('HOOKS', '{}'))  # variant name -> js
        jobs = []
        for n in names:
            base, _, var = n.partition(':')
            sc = dict(SCEN[base]); sc['hideHud'] = os.environ.get('NOHUD') == '1'
            if var: sc['hook'] = hooks[var]
            jobs.append((n.replace(':', '_'), sc))
        for n, sc in jobs:
            t1 = time.time()
            try:
                r = pg.evaluate(JS, sc)
            except Exception as e:
                print(n, 'FAILED', str(e)[:300], flush=True); break
            pg.screenshot(path=f'{out}/{n}.png')
            if os.environ.get('DIAG'): print('DIAG', json.dumps(pg.evaluate(os.environ['DIAG']))[:1500])
            print(n, round(time.time() - t1, 1), 's', json.dumps(r), flush=True)
        for e in errs[:12]: print('ERR', e)
        b.close()
finally:
    srv.terminate()
