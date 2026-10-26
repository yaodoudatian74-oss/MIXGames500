"""Gameplay smoke test: drives the real game code (input -> handleFrameInput -> tick -> render)
with scripted keyboard input, abnormal input, save/reload, resize, death, swimming, police.
Fails (exit 1) on any page error, NaN state or failed check."""
import sys, time, json, subprocess, os
from playwright.sync_api import sync_playwright

STEP_JS = r"""
(args) => {
  const [n, renderEvery] = args; const g = window.__game; const dt = 1 / 60;
  for (let i = 0; i < n; i++) {
    g.input.poll(); g.handleFrameInput(dt);
    if (g.state === 'playing' || g.state === 'dead') g.tick(dt);
    if (renderEvery && i % renderEvery === 0) g.render(dt, 1, g.state === 'playing');
    g.input.clearEdges();
  }
  const p = g.player; const v = p.vehicle;
  const nums = [p.x, p.y, p.z, p.health, v ? v.st.x : 0, v ? v.st.vx : 0];
  return { state: g.state, p: [Math.round(p.x), Math.round(p.y * 10) / 10, Math.round(p.z)], mode: p.mode, hp: Math.round(p.health),
    money: g.economy ? g.economy.money : null, wanted: g.wanted.level, mission: g.missions.active && g.missions.active.id,
    step: g.missions.step && g.missions.step.t, speed: v ? Math.round(Math.hypot(v.st.vx, v.st.vz) * 3.6) : 0,
    veh: g.vehicles.list.length, peds: g.pedSys.peds.length, cops: g.police.cars.length, nan: nums.some(x => !Number.isFinite(x)) };
}
"""

errors = []
checks = []

def check(name, ok, info=''):
    checks.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name, info, flush=True)

srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '--directory', 'dist'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'])
        ctx = b.new_context(viewport={'width': 480, 'height': 270})
        pg = ctx.new_page()
        pg.add_init_script("try{localStorage.setItem('vistacoast.settings', JSON.stringify({tier:'low', resScale: 1, shadows: true, autoQuality:false, fpsLimit:0}))}catch(e){}")
        pg.set_default_timeout(600000)
        pg.on('pageerror', lambda e: errors.append('pageerror ' + str(e)[:400]))
        pg.on('console', lambda m: errors.append('console ' + m.text[:300]) if m.type == 'error' else None)
        pg.on('crash', lambda: errors.append('PAGE CRASH'))

        def boot():
            pg.goto('http://localhost:8765/standalone.html?noloop=1')
            pg.wait_for_function("() => window.__ready === true || document.getElementById('err').textContent.length > 0", polling=500)
            pg.evaluate("document.getElementById('loading').style.display='none'")

        def step(n, r=0):
            s = pg.evaluate(STEP_JS, [n, r])
            if s['nan']: errors.append('NaN state ' + json.dumps(s))
            return s

        def tap(key, n=1, between=3):
            for _ in range(n):
                pg.keyboard.down(key); step(1); pg.keyboard.up(key); step(between)

        boot()
        pg.evaluate("() => { const g = window.__game; g.loopStarted = true; g.newGame(); g.start(); }")
        s = step(20, 10)
        check('new game starts playing', s['state'] == 'playing', json.dumps(s))
        tap('Enter', 10)
        s = step(30)
        check('intro mission reaches enterVehicle', s['mission'] == 'm1' and s['step'] == 'enterVehicle', json.dumps(s))
        # walk with WASD (camera-relative) a bit
        pg.keyboard.down('KeyW'); s0 = step(1); s = step(120); pg.keyboard.up('KeyW')
        check('walking moves the player', abs(s['p'][0] - s0['p'][0]) + abs(s['p'][2] - s0['p'][2]) > 3, json.dumps(s))
        # go to the rental car and press F
        car = pg.evaluate("() => { const v = window.__game.vehicles.list.find(v => v.tag === 'rental'); return v ? [v.st.x, v.st.z, v.st.yaw] : null }")
        check('rental car spawned', car is not None, str(car))
        if car:
            pg.evaluate("(c) => { const g = window.__game; g.player.teleport(c[0] + Math.cos(c[2]) * 2.2, c[1] - Math.sin(c[2]) * 2.2, 0); }", car)
            tap('KeyF', 1)
            s = step(150, 50)
            check('F enters the car', s['mode'] == 'vehicle', json.dumps(s))
            s = step(60)
            pg.keyboard.down('KeyW'); s = step(240, 60); pg.keyboard.up('KeyW')
            check('car accelerates', s['speed'] > 20, json.dumps(s))
            print('mission after driving:', s['mission'], s['step'])
        # abnormal input: all directions at once + spam keys
        for k in ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space', 'ShiftLeft']: pg.keyboard.down(k)
        s = step(120, 40)
        for k in ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space', 'ShiftLeft']: pg.keyboard.up(k)
        tap('KeyF', 8, 1)
        tap('KeyV', 3, 1); tap('KeyH', 3, 1); tap('KeyL', 2, 1); tap('KeyR', 2, 1)
        s = step(120, 40)
        check('survives mashed input', s['state'] == 'playing' and not s['nan'], json.dumps(s))
        # make sure we are on foot
        if s['mode'] == 'vehicle':
            tap('KeyF', 1); s = step(120)
        # crime -> wanted -> police
        pg.evaluate("() => { const g = window.__game; g.player.teleport(150, 75, 0); }")
        step(400)  # let pedestrians populate around the player (witnesses)
        pg.evaluate("() => { const g = window.__game; for (let i = 0; i < 3; i++) g.reportCrime('copAssault', g.player.x, 1, g.player.z); }")
        s = step(900, 150)
        check('witnessed crime raises wanted level', s['wanted'] >= 1, json.dumps(s))
        s = step(600, 150)
        check('police respond', s['wanted'] >= 1 and (s['cops'] >= 1 or s['state'] == 'dead'), json.dumps(s))
        pg.evaluate("() => { const g = window.__game; g.wanted.clear && g.wanted.clear(); }")
        # map + pause menus
        tap('KeyM', 1); s = step(5, 1)
        check('map opens', s['state'] == 'map', s['state'])
        tap('KeyM', 1); s = step(5)
        check('map closes', s['state'] == 'playing', s['state'])
        tap('Escape', 1); s = step(5, 1)
        check('pause opens', s['state'] == 'menu', s['state'])
        tap('Escape', 1); s = step(5)
        check('pause closes', s['state'] == 'playing', s['state'])
        # resize mid-game
        pg.set_viewport_size({'width': 360, 'height': 640}); s = step(20, 5)
        pg.set_viewport_size({'width': 640, 'height': 300}); s = step(20, 5)
        check('resize keeps running', s['state'] == 'playing', json.dumps(s))
        # swimming
        pg.evaluate("() => { const g = window.__game; g.player.teleport(1900, -300, 0); }")
        s = step(120, 60)
        check('deep water -> swim', s['mode'] == 'swim', json.dumps(s))
        # death -> respawn
        pg.evaluate("() => { const g = window.__game; g.player.teleport(150, 75, 0); g.player.damage(1000); }")
        s = step(30)
        check('death state', s['state'] == 'dead', json.dumps(s))
        s = step(600, 200)
        check('respawn after death', s['state'] == 'playing' and s['hp'] > 50, json.dumps(s))
        # storm + night rendering
        pg.evaluate("() => { const g = window.__game; g.weather.set('storm', true); g.clock.setHour(23); }")
        s = step(300, 75)
        check('storm night runs', s['state'] == 'playing' and not s['nan'], json.dumps(s))
        # save -> reload -> continue
        pg.evaluate("() => { const g = window.__game; g.player.teleport(450, 225, 1); }")
        step(5)
        saved = pg.evaluate("() => window.__game.save(true)")
        check('save succeeds', saved, '')
        boot()
        has = pg.evaluate("() => window.__game.hasSave()")
        ok = pg.evaluate("() => { const g = window.__game; g.loopStarted = true; const r = g.continueGame(); g.start(); return r; }")
        s = step(30, 10)
        check('continue restores position', has and ok and abs(s['p'][0] - 450) < 6 and abs(s['p'][2] - 225) < 6, json.dumps(s))
        b.close()
finally:
    srv.terminate()
seen = set()
for e in errors:
    if e[:120] in seen: continue
    seen.add(e[:120]); print('ERR', e)
fails = [c for c in checks if not c[1]]
print(f'{len(checks) - len(fails)}/{len(checks)} checks passed, {len(seen)} distinct errors')
sys.exit(1 if fails or errors else 0)
