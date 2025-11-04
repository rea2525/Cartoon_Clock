
(function(){
  'use strict';
  function boot(){
    // ---------------- Config ----------------
    const N = 1500;
    const HN = 525, MN = 525, SN = 450;          // H/M/S allocation
    const IDLE_JITTER = 0.35, SEEK_STRENGTH = 0.085, DAMP = 0.78;
    const DETECT_EVERY_N_FRAMES = 6, SEEN_DEBOUNCE_MS = 1200;

    // ---- Linger-head gag ----
    const LAG_FRACTION_MIN = 0.15, LAG_FRACTION_MAX = 0.25;
    const LAG_LINGER_MIN_MS = 700, LAG_LINGER_MAX_MS = 1100;
    const LAG_WIGGLE = 0.12, CATCHUP_MS = 320, CATCHUP_GAIN = 1.85;

    // ---- SLIME renderer params (guided) ----
    const MAX_BLOB_PIXELS = 300000;       // increase a bit for readability
    const MAX_SAMPLE_PARTICLES = 800;     // more samples → detail up
    const DISC_RADIUS = 12;               // smaller radius → sharper edge
    const BLUR_AMOUNT = 2;                // less blur
    const THRESH_LEVEL = 0.58;            // higher threshold → crisper
    const USE_GUIDE = true;               // draw faint target guides when seen
    const GUIDE_ALPHA = 12;               // 0..255 faint
    const GUIDE_RADIUS = Math.floor(DISC_RADIUS * 0.75);
    const GUIDE_STRIDE = 2;               // use every n-th target

    // Font
    const USE_FONT = true;
    const FONT_FAMILY_PRIMARY = 'Noto Sans';
    const FONT_FAMILY_LOCAL   = 'ClockFontLocal';
    const FONT_WEIGHT = 100;
    const LETTER_SPACING = -0.06;
    let fontSize = 280;

    let sketch = (p)=>{
      // --------------- State ---------------
      let pts = new Array(N).fill(0).map(()=>({x:0,y:0,vx:0,vy:0,tx:0,ty:0, group:0, activeAt:0, ax:0, ay:0, catchUntil:0}));
      let seen = true, prevSeen = true, lastTimeStr = "";
      let frames=0, lastFPS=0, lastFPSTime=performance.now();

      // Camera state
      const cam = { enabled:false, preview:false, video: document.getElementById('cam'), wrap: document.getElementById('camWrap'),
                    stream:null, detector:null, api:'none', lastSeenAt: 0,
                    motion: {prev:null, w:160, h:90, tmp:null, tctx:null} };

      // UI
      const holder = document.getElementById('canvas-holder');
      const fakeSeen = document.getElementById('fakeSeen');
      const btnCam = document.getElementById('btnCam');
      const btnSim = document.getElementById('btnSim');
      const togglePreview = document.getElementById('togglePreview');
      const diag = document.getElementById('diag');

      if (fakeSeen){ fakeSeen.addEventListener('change', ()=>{ seen = fakeSeen.checked; }); seen = fakeSeen.checked; }
      if (btnSim){
        btnSim.addEventListener('click', ()=>{
          cam.enabled = false;
          if (cam.wrap) cam.wrap.style.display = 'none';
          seen = true; if (fakeSeen) fakeSeen.checked = true;
          updateDiag('診断: シミュレーション ON');
        });
      }
      if (togglePreview){
        togglePreview.addEventListener('change', ()=>{
          cam.preview = togglePreview.checked;
          cam.wrap.style.display = (cam.preview && cam.enabled) ? 'block' : 'none';
        });
      }
      if (btnCam){ btnCam.addEventListener('click', startCamera); }
      function updateDiag(text){ if (diag) diag.textContent = text; }

      // Canvas + slime buffer
      let gBlob = null, blobScale = 4;

      function resize(){
        p.resizeCanvas(window.innerWidth, window.innerHeight);
        // Decide blob resolution
        const area = p.width * p.height;
        blobScale = Math.max(2, Math.ceil(Math.sqrt(area / MAX_BLOB_PIXELS)));
        const bw = Math.max(64, Math.floor(p.width / blobScale));
        const bh = Math.max(64, Math.floor(p.height / blobScale));
        gBlob = p.createGraphics(bw, bh);
        gBlob.pixelDensity(1);
        layoutInitial(); rebuildTargets();
      }

      p.setup = function(){
        const c = p.createCanvas(window.innerWidth, window.innerHeight); c.parent(holder);
        p.pixelDensity(1); p.frameRate(60);
        resize();
        const waitFonts = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
        waitFonts.then(()=>{ rebuildTargets(); setTimeout(rebuildTargets, 0); });
        updateDiag('診断: OK / slime-guided');
      };

      function layoutInitial(){
        for (let i=0;i<N;i++){
          const g = (i<HN)?0:(i<HN+MN?1:2);
          pts[i].x = Math.random()*p.width; pts[i].y = Math.random()*p.height;
          pts[i].vx = pts[i].vy = 0; pts[i].group = g;
          pts[i].activeAt = 0; pts[i].ax = pts[i].x; pts[i].ay = pts[i].y; pts[i].catchUntil = 0;
        }
      }

      function clockString(){ const d=new Date(); const pad=n=>String(n).padStart(2,'0'); return pad(d.getHours())+pad(d.getMinutes())+pad(d.getSeconds()); }

      // ----- Font-based digits (fill) -----
      function drawFontDigits(g, text, size, cx, cy){
        const ctx = g.drawingContext;
        ctx.save();
        const fam = `'${FONT_FAMILY_LOCAL}', '${FONT_FAMILY_PRIMARY}', sans-serif`;
        ctx.font = `${FONT_WEIGHT} ${size}px ${fam}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        let total = 0;
        for (const ch of text){
          const w = ctx.measureText(ch).width;
          total += w * (1 + LETTER_SPACING);
        }
        let x = cx - total/2;
        for (const ch of text){
          const w = ctx.measureText(ch).width * (1 + LETTER_SPACING);
          ctx.fillText(ch, x, cy);
          x += w;
        }
        ctx.restore();
      }

      function drawVectorDigits(g, text, size, cx, cy){
        g.push(); g.translate(cx, cy);
        g.stroke(255); g.strokeWeight(Math.max(2, size*0.065)); g.noFill();
        if (g.drawingContext){ g.drawingContext.lineJoin='round'; g.drawingContext.lineCap='round'; }
        const w=size*0.62, gap=size*0.18, halfH=size*0.52, halfW=w*0.5;
        function b(){g.beginShape();} function v(x,y){g.vertex(x,y);} function e(){g.endShape();}
        function digitPath(d, ox){
          const hw=halfW, hh=halfH, r=size*0.2; g.push(); g.translate(ox,0);
          switch(d){
            case '0': g.rectMode(g.CENTER); g.rect(0,0,w,size*1.04,r); break;
            case '1': b(); v(-hw*0.2,-hh); v(0,-hh); v(0,hh); e(); break;
            case '2': b(); v(-hw,-hh+2); v(hw,-hh+2); v(hw,0); v(-hw,0); v(-hw,hh); v(hw,hh); e(); break;
            case '3': b(); v(-hw,-hh+2); v(hw,-hh+2); v(hw,0); v(-hw*0.1,0); e(); b(); v(-hw*0.1,0); v(hw,0); v(hw,hh-2); v(-hw,hh-2); e(); break;
            case '4': b(); v(-hw,-hh); v(-hw,0); v(hw,0); e(); b(); v(hw,-hh); v(hw,hh); e(); break;
            case '5': b(); v(hw,-hh+2); v(-hw,-hh+2); v(-hw,0); v(hw,0); v(hw,hh-2); v(-hw,hh-2); e(); break;
            case '6': g.ellipseMode(g.CENTER); g.ellipse(-hw*0.05, hh*0.25, w*1.0, size*0.9); b(); v(hw*0.7,-hh+2); v(-hw,-hh+2); v(-hw,0); v(hw,0); e(); break;
            case '7': b(); v(-hw,-hh+2); v(hw,-hh+2); v(0,hh); e(); break;
            case '8': g.ellipseMode(g.CENTER); g.ellipse(0,-hh*0.38,w*0.9,size*0.70); g.ellipse(0,hh*0.42,w*0.98,size*0.80); break;
            case '9': g.ellipseMode(g.CENTER); g.ellipse(hw*0.05,-hh*0.25,w*1.0,size*0.9); b(); v(-hw,0); v(hw,0); v(hw,hh-2); v(-hw,hh-2); e(); break;
            case ':': g.noStroke(); g.fill(255); g.circle(0,-hh*0.35,size*0.10); g.circle(0,hh*0.35,size*0.10); g.noFill(); g.stroke(255); break;
          } g.pop();
        }
        const digW=size*0.62; const totalW = text.length*(digW+gap)-gap; 
        let x=-totalW/2+digW*0.5;
        for (const ch of text){ digitPath(ch,x); x+=digW+gap; }
        g.pop();
      }

      function buildTargetsFor(text, maxCount, xCenter, yCenter){
        const g = p.createGraphics(Math.max(10, Math.floor(p.width*0.32)), p.height);
        g.pixelDensity(1); g.clear(); g.background(0,0);
        (USE_FONT ? drawFontDigits : drawVectorDigits)(g, text, fontSize, g.width/2, yCenter);
        g.loadPixels();
        const d=g.pixelDensity(), W=g.width*d, H=g.height*d;
        let step=Math.max(2, Math.floor(Math.min(p.width,p.height)*0.0035)*d); // denser than v0.8.0
        const arr=[];
        for (let y=0;y<H;y+=step){
          for (let x=0;x<W;x+=step){
            const a=g.pixels[4*(y*W+x)+3];
            if (a>128){ arr.push({x: x/d + (xCenter - g.width/2), y: y/d}); }
          }
        }
        if (arr.length>maxCount){
          const stride=Math.max(1, Math.ceil(arr.length/maxCount));
          const thin=[]; for (let i=0;i<arr.length;i+=stride) thin.push(arr[i]); return thin;
        }
        return arr;
      }

      function rebuildTargets(){
        const yCenter=Math.floor(p.height*0.56);
        const str=clockString(); lastTimeStr=str;
        const HH=str.slice(0,2), MM=str.slice(2,4), SS=str.slice(4,6);
        const segW=Math.floor(p.width/3);
        const txH=buildTargetsFor(HH,HN,segW*0.5,yCenter);
        const txM=buildTargetsFor(MM,MN,segW*1.5,yCenter);
        const txS=buildTargetsFor(SS,SN,segW*2.5,yCenter);
        function assign(start,count,targets){ for (let i=0;i<count;i++){ const idx=start+i; const t=targets[i%targets.length]; pts[idx].tx=t.x; pts[idx].ty=t.y; } }
        assign(0,HN,txH); assign(HN,MN,txM); assign(HN+MN,SN,txS);

        // cache guides for speed
        guides = txH.concat(txM, txS);
      }

      // cached guide points
      let guides = [];

      function scheduleLagCluster(){
        const now = performance.now();
        for (let i=0;i<N;i++){ pts[i].activeAt = now; pts[i].catchUntil = 0; }
        const yCenter = Math.floor(p.height*0.56);
        const headY   = yCenter - fontSize*0.40;
        const headX   = p.width*0.5 + (Math.random()*2-1)*p.width*0.06;
        const frac = LAG_FRACTION_MIN + Math.random()*(LAG_FRACTION_MAX - LAG_FRACTION_MIN);
        const k = Math.max(1, Math.floor(N*frac));
        const idxs = Array.from({length:N}, (_,i)=>i).sort((a,b)=>{
          const da = (pts[a].x-headX)**2 + (pts[a].y-headY)**2;
          const db = (pts[b].x-headX)**2 + (pts[b].y-headY)**2;
          return da - db;
        });
        for (let j=0;j<k;j++){
          const i = idxs[j];
          const linger = LAG_LINGER_MIN_MS + Math.random()*(LAG_LINGER_MAX_MS - LAG_LINGER_MIN_MS);
          pts[i].ax = pts[i].x; pts[i].ay = pts[i].y;
          pts[i].activeAt = now + linger;
          pts[i].catchUntil = pts[i].activeAt + CATCHUP_MS;
        }
      }

      async function startCamera(){
        try{
          const stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'}, audio:false});
          cam.stream=stream; cam.video.srcObject=stream; await cam.video.play();
          cam.enabled=true; cam.wrap.style.display=(cam.preview || (togglePreview && togglePreview.checked))?'block':'none';
          if ('FaceDetector' in window){ cam.detector=new window.FaceDetector({fastMode:true, maxDetectedFaces:1}); cam.api='FaceDetector'; updateDiag('診断: FaceDetector'); }
          else { cam.motion.tmp=document.createElement('canvas'); cam.motion.tmp.width=cam.motion.w; cam.motion.tmp.height=cam.motion.h; cam.motion.tctx=cam.motion.tmp.getContext('2d',{willReadFrequently:true}); cam.api='Motion'; updateDiag('診断: Motion Fallback'); }
          if (fakeSeen) fakeSeen.checked=false;
        }catch(e){ console.error(e); updateDiag('診断: カメラ不可（権限/環境）'); }
      }

      function runDetection(now){
        if (!cam.enabled) return;
        if (cam.api==='FaceDetector' && cam.detector){
          cam.detector.detect(cam.video).then(faces=>{ if (faces && faces.length>0) cam.lastSeenAt=now; }).catch(()=>{});
        } else if (cam.api==='Motion'){
          const {w,h,tctx}=cam.motion; if (!tctx) return;
          tctx.drawImage(cam.video,0,0,w,h);
          const frame=tctx.getImageData(0,0,w,h);
          if (!cam.motion.prev){ cam.motion.prev=frame; }
          else {
            const prev=cam.motion.prev; let sum=0; const n=frame.data.length;
            for (let i=0;i<n;i+=4){
              sum += Math.abs(frame.data[i]-prev.data[i]) + Math.abs(frame.data[i+1]-prev.data[i+1]) + Math.abs(frame.data[i+2]-prev.data[i+2]);
            }
            const avg = sum/(w*h)/3;
            if (avg>20) cam.lastSeenAt=now;
            cam.motion.prev=frame;
          }
        }
      }

      function drawSlime(){
        if (!gBlob) return;
        // Clear
        gBlob.push();
        gBlob.blendMode(gBlob.BLEND);
        gBlob.background(0);
        // Additive discs from particles
        gBlob.blendMode(gBlob.ADD);
        gBlob.noStroke();
        gBlob.fill(255, 22); // faint; overlap builds body
        const stride = Math.max(1, Math.floor(N / MAX_SAMPLE_PARTICLES));
        const r = DISC_RADIUS;
        for (let i=0;i<N;i+=stride){
          const a = pts[i];
          const bx = a.x / blobScale;
          const by = a.y / blobScale;
          gBlob.circle(bx, by, r*2);
        }
        // Guide: softly stamp target points to keep readable silhouette
        if (USE_GUIDE && seen && guides && guides.length){
          gBlob.fill(255, GUIDE_ALPHA);
          const gr = Math.max(2, GUIDE_RADIUS);
          for (let gi=0; gi<guides.length; gi+=GUIDE_STRIDE){
            const t = guides[gi];
            gBlob.circle(t.x / blobScale, t.y / blobScale, gr*2);
          }
        }
        gBlob.pop();

        // Blur + threshold
        try { gBlob.filter(p.BLUR, BLUR_AMOUNT); } catch(e){}
        try { gBlob.filter(p.THRESHOLD, THRESH_LEVEL); } catch(e){ gBlob.filter(p.THRESHOLD); }

        // Draw to main
        p.image(gBlob, 0, 0, p.width, p.height);
      }

      p.draw = function(){
        frames++; const now=performance.now();
        if (now-lastFPSTime>=500){ lastFPS=Math.round(frames*1000/(now-lastFPSTime)); frames=0; lastFPSTime=now; }

        if (cam.enabled && (p.frameCount%DETECT_EVERY_N_FRAMES===0)) runDetection(now);
        const camSeen = cam.enabled ? (now-cam.lastSeenAt<=SEEN_DEBOUNCE_MS) : false;
        const effectiveSeen = cam.enabled ? camSeen : seen;
        seen = effectiveSeen;

        // Rising / Falling edge
        if (!prevSeen && seen){ rebuildTargets(); scheduleLagCluster(); }
        if (prevSeen && !seen){ for (let i=0;i<N;i++){ pts[i].activeAt = 0; pts[i].catchUntil=0; } }
        prevSeen = seen;

        p.background(0);
        const nowStr=clockString(); if (seen && nowStr!==lastTimeStr) rebuildTargets();

        // Physics step
        for (let i=0;i<N;i++){
          const a=pts[i];
          if (seen){
            if (now < a.activeAt){
              const toAx = a.ax - a.x, toAy = a.ay - a.y;
              a.vx = a.vx*0.88 + toAx*0.10 + (Math.random()-0.5)*LAG_WIGGLE;
              a.vy = a.vy*0.88 + toAy*0.10 + (Math.random()-0.5)*LAG_WIGGLE;
            } else {
              const dx=a.tx-a.x, dy=a.ty-a.y;
              const gain = (now < a.catchUntil) ? CATCHUP_GAIN : 1.0;
              a.vx=(a.vx+dx*SEEK_STRENGTH*gain)*DAMP; 
              a.vy=(a.vy+dy*SEEK_STRENGTH*gain)*DAMP;
            }
          } else {
            a.vx=(a.vx+(Math.random()-0.5)*IDLE_JITTER)*0.98; 
            a.vy=(a.vy+(Math.random()-0.5)*IDLE_JITTER)*0.98;
          }
          a.x+=a.vx; a.y+=a.vy;
          if (a.x<0){a.x=0;a.vx*=-0.5;} if (a.x>p.width){a.x=p.width;a.vx*=-0.5;}
          if (a.y<0){a.y=0;a.vy*=-0.5;} if (a.y>p.height){a.y=p.height;a.vy*=-0.5;}
        }

        // SLIME rendering
        drawSlime();

        // tiny overlay diag
        p.noStroke(); p.fill(255); p.textSize(12); p.textAlign(p.LEFT,p.TOP);
        p.text(`v0.8.1 fps:${lastFPS} seen:${seen} scale:${blobScale} N:${N}`, 8,8);
      };

      window.addEventListener('resize', resize);
    };
    new p5(sketch);
  }
  if (document.readyState==='loading'){ window.addEventListener('DOMContentLoaded', boot); } else { boot(); }
})();