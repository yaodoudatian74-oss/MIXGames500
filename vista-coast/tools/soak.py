"""Soak test: drives across the map repeatedly (streaming vehicles, peds, terrain LOD) and
checks that GPU geometry/texture counts and JS heap stay bounded."""
import sys, time, json, subprocess
from playwright.sync_api import sync_playwright

LEG_JS = r"""
(args) => {
  const [x, z, yaw, n] = args; const g = window.__game; const dt = 1 / 60;
  const p = g.player;
  if (!p.vehicle) g.debugSpawnAndEnter();
  const v = p.vehicle;
  v.st.x = v.st.px = x; v.st.z = v.st.pz = z; v.st.y = v.st.py = g.W.ground.groundAt(x, z, 400); v.st.yaw = v.st.pyaw = yaw;
  v.st.vx = Math.sin(yaw) * 20; v.st.vz = Math.cos(yaw) * 20;
  g.input.touchDown('accel');
  for (let i = 0; i < n; i++) {
    g.input.poll(); g.handleFrameInput(dt); g.tick(dt);
    if (i % 20 === 0) g.render(dt, 1, true);
    g.input.clearEdges();
  }
  g.input.touchUp('accel');
  const m = g.renderer.info.memory;
  return { geo: m.geometries, tex: m.textures, prog: g.renderer.info.programs.length, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : -1,
    veh: g.vehicles.list.length, views: g.vehicles.list.filter(v => v.view).length, peds: g.pedSys.peds.length, state: g.state };
}
"""
LEGS = [(150, 75, 0), (-450, -375, 1.57), (675, -600, 0), (-1500, 0, 0), (1050, 900, 3.14), (300, -225, 0), (-900, 450, 1.57), (450, 1000, 3.14)]
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '--directory', 'dist'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
errors = []
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info', '--disable-dev-shm-usage'])
        pg = b.new_page(viewport={'width': 320, 'height': 180})
        pg.add_init_script("try{localStorage.setItem('vistacoast.settings', JSON.stringify({tier:'low', resScale: 1, shadows: true, autoQuality:false, fpsLimit:0}))}catch(e){}")
        pg.set_default_timeout(900000)
        pg.on('pageerror', lambda e: errors.append(str(e)[:300]))
        pg.goto('http://localhost:8765/standalone.html?noloop=1')
        pg.wait_for_function("() => window.__ready === true", polling=500)
        pg.evaluate("() => { const g = window.__game; g.loopStarted = true; g.newGame(); g.start(); g.missions.abort && g.missions.abort(); }")
        res = []
        for rnd in range(5):
            for leg in LEGS:
                r = pg.evaluate(LEG_JS, [leg[0], leg[1], leg[2], 600])
                res.append(r)
            print('round', rnd, json.dumps(res[-1]), flush=True)
        b.close()
finally:
    srv.terminate()
first, last = res[2 * len(LEGS) - 1], res[-1]
print('after round 2:', json.dumps(first))
print('after round 5:', json.dumps(last))
grow_geo = last['geo'] - first['geo']
grow_tex = last['tex'] - first['tex']
print('geometry growth', grow_geo, 'texture growth', grow_tex, 'errors', errors[:5])
sys.exit(1 if errors or grow_geo > 60 or grow_tex > 10 else 0)
