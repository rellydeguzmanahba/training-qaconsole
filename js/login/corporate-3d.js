// Adapted directly from the corporate website's actual Three.js geometry/shaders.
// No SVG approximation or morph into a different logo.
export function startCorporateLogo(canvas) {
  const THREE = window.THREE;
  if (!THREE) throw new Error('Three.js unavailable');
  const root = document.documentElement;
  const TAU = Math.PI * 2;
  const clamp = (x,a,b)=>Math.max(a,Math.min(b,x));
  const ease = x => { x=clamp(x,0,1);return x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2; };
  const css = name => getComputedStyle(root).getPropertyValue(name).trim();
  const rng = seed => () => { seed |= 0; seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296; };
  const rand=rng(2003), narrow=window.innerWidth<760;
  const scene=new THREE.Scene();
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
  renderer.setClearColor(0x000000,0);
  const camera=new THREE.PerspectiveCamera(42,1,.1,300);
  const hemi=new THREE.HemisphereLight(0xffffff,0x7f9f86,.95);scene.add(hemi);
  const keyL=new THREE.DirectionalLight(0xffffff,.95);keyL.position.set(-12,18,26);scene.add(keyL);
  const rimL=new THREE.DirectionalLight(0xbfffd0,.45);rimL.position.set(16,-6,-10);scene.add(rimL);
  /* ---- the logo, rebuilt as 3D from its own shapes (logo pixel space to world units) ---- */
  var S = 0.011, CX = 1000, CY = 625;
  function Wv(px, py) { return new THREE.Vector2((px - CX) * S, -(py - CY) * S); }
  function Ws(arr) { return arr.map(function (p) { return Wv(p[0], p[1]); }); }
  function mk(color) { return new THREE.MeshStandardMaterial({ color: color, roughness: 0.42, metalness: 0.12, emissive: 0x03300a, emissiveIntensity: 0.6 }); }
  var matBarR = mk(0x087a1c), matBarL = mk(0x0c8f23), matSw = mk(0x16a832), matSw2 = mk(0x1fb83a), matAr = mk(0x0d8a22);
  function solid(shape, depth, mat, tFn) {
    var g = new THREE.ExtrudeGeometry(shape, { depth: depth, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 2, curveSegments: 14 });
    g.translate(0, 0, -depth / 2);
    if (tFn) {
      var pa = g.attributes.position, tA = new Float32Array(pa.count);
      for (var i = 0; i < pa.count; i++) tA[i] = tFn(pa.getX(i), pa.getY(i));
      g.setAttribute('aT', new THREE.BufferAttribute(tA, 1));
    }
    return new THREE.Mesh(g, mat);
  }
  /* "draw-on" reveal: each vertex knows how far along its path it is (aT, 0 to 1);
     anything further along than uReveal is not drawn yet */
  var swReveal = { value: 0 }, arReveal = { value: 0 };
  function revealMat(mat, u) {
    mat.onBeforeCompile = function (sh) {
      sh.uniforms.uReveal = u;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aT;\nvarying float vT;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvT = aT;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vT;\nuniform float uReveal;').replace('void main() {', 'void main() {\nif (vT > uReveal) discard;');
    };
    mat.customProgramCacheKey = function () { return 'ahba-reveal'; };
    return mat;
  }
  revealMat(matSw, swReveal); revealMat(matSw2, swReveal); revealMat(matAr, arReveal);

  /* right bar of the A */
  var shR = new THREE.Shape();
  var a0 = Wv(655, 150); shR.moveTo(a0.x, a0.y);
  var a1 = Wv(790, 122); shR.lineTo(a1.x, a1.y);
  shR.splineThru(Ws([[880, 270], [950, 410], [985, 560], [975, 700], [940, 800], [913, 872]]));
  shR.splineThru(Ws([[905, 760], [890, 640], [850, 520], [790, 400], [720, 290], [648, 195]]));
  shR.lineTo(a0.x, a0.y);
  var gRight = new THREE.Group(); gRight.add(solid(shR, 1.6, matBarR)); scene.add(gRight);

  /* left bar of the A */
  var shL = new THREE.Shape();
  var b0 = Wv(470, 1000); shL.moveTo(b0.x, b0.y);
  shL.splineThru(Ws([[478, 880], [520, 740], [585, 560], [650, 430], [712, 368]]));
  shL.splineThru(Ws([[690, 440], [655, 540], [625, 650], [600, 760], [582, 880], [640, 1085]]));
  var b1 = Wv(612, 1130); shL.lineTo(b1.x, b1.y);
  var b2 = Wv(490, 1095); shL.lineTo(b2.x, b2.y);
  shL.lineTo(b0.x, b0.y);
  var gLeft = new THREE.Group(); gLeft.add(solid(shL, 1.4, matBarL)); scene.add(gLeft);

  /* swoosh: three nested ribbons that taper to points at both ends */
  var center = Ws([[770, 1130], [1050, 1055], [1300, 900], [1500, 700], [1620, 520], [1640, 390], [1560, 300], [1380, 278], [1150, 335], [920, 452]]);
  var ctr = Wv(1150, 700);
  var swPts0 = new THREE.SplineCurve(center).getPoints(90);
  function swT(x, y) {
    var best = 0, bd = 1e9;
    for (var i = 0; i < swPts0.length; i++) { var dx = swPts0[i].x - x, dy = swPts0[i].y - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
    return best / (swPts0.length - 1);
  }
  function ribbon(offPx, widPx, depth, mat) {
    var pts = new THREE.SplineCurve(center).getPoints(90), L = [], Rr = [], n = pts.length;
    for (var i = 0; i < n; i++) {
      var t = i / (n - 1), p = pts[i], pa = pts[Math.max(0, i - 1)], pb = pts[Math.min(n - 1, i + 1)];
      var tg = pb.clone().sub(pa).normalize(), nm = new THREE.Vector2(-tg.y, tg.x);
      if (nm.dot(ctr.clone().sub(p)) < 0) nm.negate();
      var env = Math.sin(Math.PI * t), c = p.clone().addScaledVector(nm, offPx * S * env), h = widPx * S * Math.pow(env, 0.8) / 2;
      L.push(c.clone().addScaledVector(nm, h)); Rr.push(c.clone().addScaledVector(nm, -h));
    }
    var sh = new THREE.Shape(L.concat(Rr.reverse()));
    return solid(sh, depth, mat, swT);
  }
  var gSw = new THREE.Group();
  gSw.add(ribbon(0, 88, 0.5, matSw)); gSw.add(ribbon(66, 28, 0.4, matSw2)); gSw.add(ribbon(112, 17, 0.32, matSw2));
  scene.add(gSw);

  /* arrow */
  var gAr = new THREE.Group();
  (function () {
    var p0 = Wv(830, 492), p1 = Wv(392, 905), d = p1.clone().sub(p0).normalize(), nm = new THREE.Vector2(-d.y, d.x), w0 = 11 * S, w1 = 6 * S;
    var shaft = new THREE.Shape([p0.clone().addScaledVector(nm, w0), p1.clone().addScaledVector(nm, w1), p1.clone().addScaledVector(nm, -w1), p0.clone().addScaledVector(nm, -w0)]);
    var len = p1.distanceTo(p0);
    gAr.add(solid(shaft, 0.35, matAr, function (x, y) { return clamp(((x - p0.x) * d.x + (y - p0.y) * d.y) / len, 0, 0.97); }));
    gAr.add(solid(new THREE.Shape(Ws([[343, 943], [372, 880], [394, 903], [433, 895]])), 0.35, matAr, function () { return 1; }));
  })();
  scene.add(gAr);

  /* the running arrow: one path from the swoosh tail, round the arch and on into the arrow */
  var flowPts = center.map(function (v) { return new THREE.Vector3(v.x, v.y, -0.05); })
    .concat(Ws([[830, 492], [610, 700], [392, 905], [343, 943]]).map(function (v, i) { return new THREE.Vector3(v.x, v.y, i === 0 ? 0.25 : 0.55); }));
  var flowCurve = new THREE.CatmullRomCurve3(flowPts, false, 'centripetal');
  var uSwEnd = new THREE.CatmullRomCurve3(flowPts.slice(0, center.length), false, 'centripetal').getLength() / flowCurve.getLength();
  var flowMat = new THREE.MeshBasicMaterial({ color: 0xd6ffe0, transparent: true, opacity: 1, depthTest: false });
  var UP = new THREE.Vector3(0, 1, 0), COMETS = 3, TR = 24, comets = [];
  var coneG = new THREE.ConeGeometry(0.32, 0.95, 4);
  for (var cm = 0; cm < COMETS; cm++) { var cn = new THREE.Mesh(coneG, flowMat); cn.frustumCulled = false; cn.visible = false; scene.add(cn); comets.push(cn); }
  var trPos = new Float32Array(COMETS * TR * 3), trA = new Float32Array(COMETS * TR), trS = new Float32Array(COMETS * TR);
  var trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trPos, 3));
  trailGeo.setAttribute('aA', new THREE.BufferAttribute(trA, 1));
  trailGeo.setAttribute('aS', new THREE.BufferAttribute(trS, 1));
  var trailU = { uColor: { value: new THREE.Color(0xd6ffe0) }, uScale: { value: 800 } };
  var trail = new THREE.Points(trailGeo, new THREE.ShaderMaterial({
    uniforms: trailU, transparent: true, depthWrite: false, depthTest: false,
    vertexShader: 'uniform float uScale; attribute float aA; attribute float aS; varying float vA; void main() { vA = aA; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = max(1.0, aS * uScale / max(0.5, -mv.z)); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 uColor; varying float vA; void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(uColor, vA * (1.0 - smoothstep(0.15, 0.5, d))); }'
  }));
  trail.frustumCulled = false; scene.add(trail);

  /* wordmark as a textured plane in front of the logo */
  var wmCanvas = document.createElement('canvas'); wmCanvas.width = 2048; wmCanvas.height = 512;
  var wmTex = new THREE.CanvasTexture(wmCanvas);
  function drawWordmark() {
    var c = wmCanvas.getContext('2d'), fam = "Anton, Impact, 'Arial Narrow', sans-serif";
    c.clearRect(0, 0, 2048, 512); c.lineJoin = 'round'; c.textBaseline = 'alphabetic';
    c.font = '340px ' + fam; var w1 = c.measureText('AHBA').width;
    c.font = '250px ' + fam; var w2 = c.measureText('Development').width;
    var gap = 44, k = Math.min(1, 1960 / (w1 + gap + w2)), x = (2048 - (w1 + gap + w2) * k) / 2, base = 400;
    var olive = css('--olive') || '#6B6A0A';
    [['AHBA', 340, 0, w1], ['Development', 250, w1 + gap, w2]].forEach(function (s) {
      c.font = Math.round(s[1] * k) + 'px ' + fam;
      var px = x + s[2] * k;
      c.strokeStyle = '#ffffff'; c.lineWidth = 30 * k; c.strokeText(s[0], px, base);
      c.fillStyle = olive; c.fillText(s[0], px, base);
    });
    wmTex.needsUpdate = true;
  }
  var wmMat = new THREE.MeshBasicMaterial({ map: wmTex, transparent: true, depthWrite: false });
  var wm = new THREE.Mesh(new THREE.PlaneGeometry(18, 4.5), wmMat);
  wm.position.set(0.4, -0.3, 1.5);
  scene.add(wm);
  /* particles gather onto the logo */
  var PC = narrow ? 800 : 1500;
  var pS = new Float32Array(PC * 3), pE = new Float32Array(PC * 3), pPh = new Float32Array(PC), pDl = new Float32Array(PC);
  function inPoly(x, y, poly) {
    var c = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if (((poly[i].y > y) !== (poly[j].y > y)) && (x < (poly[j].x - poly[i].x) * (y - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x)) c = !c;
    }
    return c;
  }
  var polyR = shR.getPoints(14), polyL = shL.getPoints(14), swPts = new THREE.SplineCurve(center).getPoints(90);
  function sampleIn(poly) {
    var mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
    poly.forEach(function (p) { mnx = Math.min(mnx, p.x); mxx = Math.max(mxx, p.x); mny = Math.min(mny, p.y); mxy = Math.max(mxy, p.y); });
    for (var tries = 0; tries < 40; tries++) { var x = mnx + rand() * (mxx - mnx), y = mny + rand() * (mxy - mny); if (inPoly(x, y, poly)) return [x, y]; }
    return [poly[0].x, poly[0].y];
  }
  for (var p = 0; p < PC; p++) {
    var u = rand(), vv = rand(), rs = 30 + rand() * 40, th = TAU * u, ph = Math.acos(2 * vv - 1);
    pS[p * 3] = Math.sin(ph) * Math.cos(th) * rs; pS[p * 3 + 1] = Math.cos(ph) * rs * 0.7; pS[p * 3 + 2] = Math.sin(ph) * Math.sin(th) * rs;
    var kind = rand(), ex, ey, ez = (rand() - 0.5) * 1.4, pt;
    if (kind < 0.28) { pt = sampleIn(polyR); ex = pt[0]; ey = pt[1]; }
    else if (kind < 0.46) { pt = sampleIn(polyL); ex = pt[0]; ey = pt[1]; }
    else if (kind < 0.9) { var si = Math.floor(rand() * 91), sp = swPts[si]; ex = sp.x + (rand() - 0.5) * 0.9 * Math.sin(Math.PI * si / 90); ey = sp.y + (rand() - 0.5) * 0.9 * Math.sin(Math.PI * si / 90); ez = (rand() - 0.5) * 0.6 - 0.4; }
    else { ex = (rand() - 0.5) * 24; ey = (rand() - 0.5) * 14; ez = (rand() - 0.5) * 8; }
    pE[p * 3] = ex; pE[p * 3 + 1] = ey; pE[p * 3 + 2] = ez;
    pPh[p] = rand() * TAU; pDl[p] = rand() * 1.4;
  }
  var pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PC * 3), 3));
  var pointMat = new THREE.PointsMaterial({ color: 0x0a7a1d, size: 0.11, transparent: true, opacity: 0.9, depthWrite: false });
  scene.add(new THREE.Points(pGeo, pointMat));

  // Frame the entire corporate logo; no service-chapter camera fly-through.
  let width=0,height=0,raf=0,disposed=false,started=performance.now();
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const resize=()=>{
    const r=canvas.getBoundingClientRect();
    const w=Math.max(1,Math.round(r.width)),h=Math.max(1,Math.round(r.height));
    if(w===width&&h===height)return;
    width=w;height=h;
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.75));renderer.setSize(w,h,false);
    camera.aspect=w/h;camera.fov=40;camera.updateProjectionMatrix();
  };
  function frame(now){
    if(disposed||!canvas.isConnected){dispose();return;}
    resize();
    const T=reduced?7:Math.min((now-started)/1000,7);
    const eR=ease((T-.4)/1.4);
    gRight.position.set(0,(1-eR)*16,.3);gRight.rotation.z=(1-eR)*.5;gRight.visible=eR>.001;
    const eL=ease((T-.8)/1.4);
    gLeft.position.set(0,- (1-eL)*16,0);gLeft.rotation.z=-(1-eL)*.5;gLeft.visible=eL>.001;
    const DRAW0=1.3,DRAW1=3.7,uDraw=ease((T-DRAW0)/(DRAW1-DRAW0));
    swReveal.value=clamp(uDraw,0,1);
    arReveal.value=clamp((T-2.8)/.9,0,1);
    gSw.position.z=-.4;gAr.position.set(0,0,.3);
    wmMat.opacity=ease((T-2.7)/.9);
    const arr=pGeo.attributes.position.array;
    for(let p=0;p<PC;p++){
      const e=ease((T-pDl[p])/1.9),ph=pPh[p];
      arr[p*3]=pS[p*3]+(pE[p*3]-pS[p*3])*e;
      arr[p*3+1]=pS[p*3+1]+(pE[p*3+1]-pS[p*3+1])*e;
      arr[p*3+2]=pS[p*3+2]+(pE[p*3+2]-pS[p*3+2])*e;
    }
    pGeo.attributes.position.needsUpdate=true;
<<<<<<< HEAD
    // Responsive fit: account for aspect ratio, not just viewport width.
    const d = Math.max(17.5, 12.0 / Math.max(0.52, camera.aspect));
    camera.position.set(0,1,d);
=======
    camera.position.set(0,1,window.innerWidth<760?28:22);
>>>>>>> 5481ee098350e79475b957ada288d106a9ce7aa3
    camera.lookAt(0,0,0);
    renderer.render(scene,camera);
    raf=requestAnimationFrame(frame);
  }
  function dispose(){if(disposed)return;disposed=true;cancelAnimationFrame(raf);renderer.dispose();}
  drawWordmark();
  if(document.fonts?.load)document.fonts.load('400 100px Anton').then(()=>{if(!disposed)drawWordmark();}).catch(()=>{});
  raf=requestAnimationFrame(frame);
  return dispose;
}
