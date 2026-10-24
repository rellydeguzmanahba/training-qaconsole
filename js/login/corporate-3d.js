// Adapted from the user's corporate website Three.js logo geometry and motion.
// No services, scrolling camera, navigation, or authentication dependencies.
export function startCorporateLogo(canvas) {
  const THREE = window.THREE;
  if (!THREE) throw new Error('Three.js missing. Add the script tag documented in README.');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:true});
  renderer.setClearColor(0x000000,0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(43,1,.1,200);
  scene.add(new THREE.HemisphereLight(0xffffff,0x7f9f86,1.15));
  const light = new THREE.DirectionalLight(0xffffff,1.15); light.position.set(-12,18,26);scene.add(light);
  const rim = new THREE.DirectionalLight(0xbfffd0,.5);rim.position.set(16,-6,-10);scene.add(rim);
  const S=.011,CX=1000,CY=625;
  const W=(x,y)=>new THREE.Vector2((x-CX)*S,-(y-CY)*S);
  const WS=a=>a.map(p=>W(p[0],p[1]));
  const mat=(color)=>new THREE.MeshStandardMaterial({color,roughness:.42,metalness:.12,emissive:0x03300a,emissiveIntensity:.6,side:THREE.DoubleSide});
  const green1=mat(0x087a1c),green2=mat(0x0c8f23),swooshMat=mat(0x16a832),secondMat=mat(0x1fb83a),arrowMat=mat(0x0d8a22);
  function solid(shape,depth,material){const geo=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelThickness:.07,bevelSize:.07,bevelSegments:2,curveSegments:14});geo.translate(0,0,-depth/2);return new THREE.Mesh(geo,material)}
  const group=new THREE.Group();scene.add(group);
  const right=new THREE.Shape(), a0=W(655,150);right.moveTo(a0.x,a0.y);let a1=W(790,122);right.lineTo(a1.x,a1.y);
  right.splineThru(WS([[880,270],[950,410],[985,560],[975,700],[940,800],[913,872]]));
  right.splineThru(WS([[905,760],[890,640],[850,520],[790,400],[720,290],[648,195]]));right.lineTo(a0.x,a0.y);
  const gr=solid(right,1.6,green1);group.add(gr);
  const left=new THREE.Shape(), b0=W(470,1000);left.moveTo(b0.x,b0.y);
  left.splineThru(WS([[478,880],[520,740],[585,560],[650,430],[712,368]]));
  left.splineThru(WS([[690,440],[655,540],[625,650],[600,760],[582,880],[640,1085]]));
  let b1=W(612,1130),b2=W(490,1095);left.lineTo(b1.x,b1.y);left.lineTo(b2.x,b2.y);left.lineTo(b0.x,b0.y);
  const gl=solid(left,1.4,green2);group.add(gl);
  const center=WS([[770,1130],[1050,1055],[1300,900],[1500,700],[1620,520],[1640,390],[1560,300],[1380,278],[1150,335],[920,452]]);
  const ctr=W(1150,700), sw=new THREE.Group();group.add(sw);
  function ribbon(offPx,widPx,depth,material){
    const pts=new THREE.SplineCurve(center).getPoints(90),L=[],R=[],n=pts.length;
    for(let i=0;i<n;i++){
      const t=i/(n-1),p=pts[i],pa=pts[Math.max(0,i-1)],pb=pts[Math.min(n-1,i+1)];
      const tg=pb.clone().sub(pa).normalize(),nm=new THREE.Vector2(-tg.y,tg.x);
      if(nm.dot(ctr.clone().sub(p))<0)nm.negate();
      const env=Math.sin(Math.PI*t),c=p.clone().addScaledVector(nm,offPx*S*env),h=widPx*S*Math.pow(env,.8)/2;
      L.push(c.clone().addScaledVector(nm,h));R.push(c.clone().addScaledVector(nm,-h));
    }
    return solid(new THREE.Shape(L.concat(R.reverse())),depth,material);
  }
  sw.add(ribbon(0,88,.5,swooshMat));sw.add(ribbon(66,28,.4,secondMat));sw.add(ribbon(112,17,.32,secondMat));sw.position.z=-.4;
  const arrow=new THREE.Group();group.add(arrow);
  const p0=W(830,492),p1=W(392,905),d=p1.clone().sub(p0).normalize(),nm=new THREE.Vector2(-d.y,d.x);
  arrow.add(solid(new THREE.Shape([p0.clone().addScaledVector(nm,11*S),p1.clone().addScaledVector(nm,6*S),p1.clone().addScaledVector(nm,-6*S),p0.clone().addScaledVector(nm,-11*S)]),.35,arrowMat));
  arrow.add(solid(new THREE.Shape(WS([[343,943],[372,880],[394,903],[433,895]])),.35,arrowMat));arrow.position.z=.3;
  // Wordmark uses the same canvas-text approach as the corporate website.
  const cv=document.createElement('canvas');cv.width=2048;cv.height=512;const ctx=cv.getContext('2d');
  function wordmark(){
    ctx.clearRect(0,0,2048,512);ctx.lineJoin='round';ctx.textBaseline='alphabetic';
    const fam="Anton, Impact, 'Arial Narrow', sans-serif";
    ctx.font='340px '+fam;const w1=ctx.measureText('AHBA').width;
    ctx.font='250px '+fam;const w2=ctx.measureText('Development').width;
    const gap=44,k=Math.min(1,1960/(w1+gap+w2)),x=(2048-(w1+gap+w2)*k)/2;
    [['AHBA',340,0],['Development',250,w1+gap]].forEach(v=>{
      ctx.font=Math.round(v[1]*k)+'px '+fam;const px=x+v[2]*k;
      ctx.strokeStyle='#ffffff';ctx.lineWidth=30*k;ctx.strokeText(v[0],px,400);
      ctx.fillStyle='#6B6A0A';ctx.fillText(v[0],px,400);
    });tex.needsUpdate=true;
  }
  const tex=new THREE.CanvasTexture(cv),wmMat=new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false});
  const wm=new THREE.Mesh(new THREE.PlaneGeometry(18,4.5),wmMat);wm.position.set(.4,-.3,1.5);group.add(wm);wordmark();
  document.fonts?.ready?.then(wordmark);
  // A luminous particle trail follows the original orbital curve.
  const path=new THREE.CatmullRomCurve3(center.map(v=>new THREE.Vector3(v.x,v.y,.7)));
  const tracer=new THREE.Mesh(new THREE.SphereGeometry(.19,12,10),new THREE.MeshBasicMaterial({color:0xd6ffe0}));group.add(tracer);
  const rand=(function(){let s=2003;return()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296}})();
  const PC=500,positions=new Float32Array(PC*3),starts=new Float32Array(PC*3);
  for(let i=0;i<PC;i++){const th=rand()*Math.PI*2,r=18+rand()*24;starts[i*3]=Math.cos(th)*r;starts[i*3+1]=Math.sin(th)*r;starts[i*3+2]=(rand()-.5)*22;}
  const pgeo=new THREE.BufferGeometry();pgeo.setAttribute('position',new THREE.BufferAttribute(positions,3));
  const pm=new THREE.PointsMaterial({color:0x0a7a1d,size:.09,transparent:true,opacity:.5,depthWrite:false});group.add(new THREE.Points(pgeo,pm));
  let start=performance.now(),raf=0,stopped=false;
  const ease=x=>{x=Math.max(0,Math.min(1,x));return x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2};
  function resize(){const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return;renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.75));renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.fov=r.width/r.height<1.15?55:43;camera.updateProjectionMatrix()}
  const observer=new ResizeObserver(resize);observer.observe(canvas);resize();
  function frame(now){if(stopped)return;
    if(!canvas.isConnected){stopped=true;observer.disconnect();renderer.dispose();return;}
    const t=reduced?9:(now-start)/1000;
    const er=ease((t-.25)/1.25),el=ease((t-.7)/1.25);
    gr.position.y=(1-er)*16;gr.rotation.z=(1-er)*.5;gr.visible=er>.001;
    gl.position.y=-(1-el)*16;gl.rotation.z=-(1-el)*.5;gl.visible=el>.001;
    const orbit=ease((t-1.35)/2.2);sw.scale.setScalar(Math.max(.001,orbit));sw.visible=orbit>.001;
    arrow.visible=t>3.05;arrow.scale.setScalar(Math.max(.001,ease((t-3.05)/.55)));
    tracer.visible=!reduced&&t>1.35&&t<3.6;if(tracer.visible)tracer.position.copy(path.getPoint(orbit));
    wmMat.opacity=ease((t-2.8)/.9);
    const arr=pgeo.attributes.position.array;
    for(let i=0;i<PC;i++){const a=ease((t-i/PC*.85)/2.3),pt=path.getPoint(i/PC);arr[i*3]=starts[i*3]*(1-a)+pt.x*a;arr[i*3+1]=starts[i*3+1]*(1-a)+pt.y*a;arr[i*3+2]=starts[i*3+2]*(1-a)+pt.z*a;}
    pgeo.attributes.position.needsUpdate=true;
    group.rotation.y=reduced?0:Math.sin(t*.4)*.11;
    group.rotation.x=reduced?0:Math.sin(t*.27)*.035;
    camera.position.set(0,1,35);camera.lookAt(0,0,0);
    renderer.render(scene,camera);raf=requestAnimationFrame(frame);
  }
  raf=requestAnimationFrame(frame);
}
