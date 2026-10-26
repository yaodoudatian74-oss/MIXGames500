"""Per-group render cost probe (headless swiftshader). Prints ms per group for the
first (compile) and second render, plus geometry/texture memory estimates."""
import sys, time, json, subprocess, os
from playwright.sync_api import sync_playwright
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '--directory', 'dist'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
JS = r"""
async (pos) => {
  const g = window.__game; const W = g.W; const THREE_R = g.renderer; const gl = THREE_R.getContext();
  g.frame = () => {};
  await new Promise(r => setTimeout(r, 300));
  const cam = g.rig.cam;
  if (pos) { cam.position.set(pos[0], pos[1], pos[2]); cam.lookAt(pos[3], pos[4], pos[5]); cam.updateMatrixWorld(); }
  const groups = { terrain: W.terrain.group, roads: W.root.children[1], buildings: W.root.children[2], billboards: W.billboards, veg: W.vegetation.group, props: W.props.group, water: W.water.group, landmarks: W.landmarks.group };
  const px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const res = {};
  const all = Object.keys(groups);
  for (const k of all) groups[k].visible = false;
  // baseline: everything else in scene (sky, vehicles, player...)
  let t = performance.now(); THREE_R.render(g.scene, cam); sync(); res.base1 = Math.round(performance.now() - t);
  t = performance.now(); THREE_R.render(g.scene, cam); sync(); res.base2 = Math.round(performance.now() - t);
  for (const k of all) {
    groups[k].visible = true;
    let t0 = performance.now(); THREE_R.render(g.scene, cam); sync(); const a = performance.now() - t0;
    t0 = performance.now(); THREE_R.render(g.scene, cam); sync(); const b = performance.now() - t0;
    res[k] = [Math.round(a), Math.round(b), THREE_R.info.render.calls, THREE_R.info.render.triangles];
    groups[k].visible = false;
  }
  for (const k of all) groups[k].visible = true;
  let t0 = performance.now(); THREE_R.render(g.scene, cam); sync(); res.allRaw = [Math.round(performance.now() - t0), THREE_R.info.render.calls, THREE_R.info.render.triangles];
  t0 = performance.now(); g.post.render(0.016); sync(); res.post1 = Math.round(performance.now() - t0);
  t0 = performance.now(); g.post.render(0.016); sync(); res.post2 = Math.round(performance.now() - t0);
  // memory estimate
  let geoBytes = 0; const seen = new Set();
  g.scene.traverse(o => { const geo = o.geometry; if (!geo || seen.has(geo)) return; seen.add(geo);
    for (const n in geo.attributes) geoBytes += geo.attributes[n].array.byteLength; if (geo.index) geoBytes += geo.index.array.byteLength; });
  res.geoMB = Math.round(geoBytes / 1e6); res.geos = seen.size;
  res.heapMB = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : -1;
  res.programs = THREE_R.info.programs ? THREE_R.info.programs.length : -1;
  res.textures = THREE_R.info.memory.textures; res.geometries = THREE_R.info.memory.geometries;
  return res;
}
"""
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--enable-precise-memory-info', '--js-flags=--max-old-space-size=4096'])
        W = int(os.environ.get('VW', '480')); H = int(os.environ.get('VH', '270'))
        pg = b.new_page(viewport={'width': W, 'height': H})
        tier = os.environ.get('TIER', 'low')
        pg.add_init_script("try{localStorage.setItem('vistacoast.settings', JSON.stringify({tier:'%s', resScale: 1, shadows: %s, autoQuality:false, fpsLimit:0}))}catch(e){}" % (tier, os.environ.get('SHADOWS', 'false')))
        pg.set_default_timeout(900000)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)[:300]))
        pg.on('console', lambda m: errs.append(m.text[:300]) if m.type == 'error' else None)
        t0 = time.time()
        pg.goto('http://localhost:8765/standalone.html?noloop=1')
        pg.wait_for_function("() => window.__ready === true || document.getElementById('err').textContent.length > 0", polling=500)
        print('loaded in', round(time.time() - t0, 1), 's', flush=True)
        pos = json.loads(os.environ['POS']) if os.environ.get('POS') else None
        print(json.dumps(pg.evaluate(JS, pos)), flush=True)
        for e in errs[:10]: print('ERR', e)
        b.close()
finally:
    srv.terminate()
