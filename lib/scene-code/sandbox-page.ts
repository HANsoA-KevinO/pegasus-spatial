/** Trusted bridge only. Program code never executes in the business document. */
export const SCENE_SANDBOX_HTML = String.raw`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob: 'wasm-unsafe-eval'; worker-src blob:; connect-src blob: data:; img-src blob: data:; style-src 'unsafe-inline'"><style>html,body,canvas{width:100%;height:100%;margin:0;display:block;overflow:hidden}canvas{outline:none;touch-action:none}</style></head><body><canvas tabindex="0" aria-label="Three.js 场景：拖动旋转，右键平移，滚轮缩放；WASD 和 Q/E 移动"></canvas><script>
let booted=false;
addEventListener('message',async event=>{
 if(booted||event.source!==parent||event.data?.kind!=='scene-boot'||!event.ports[0])return;booted=true;
 const port=event.ports[0],canvas=document.querySelector('canvas'),worker=new Worker(URL.createObjectURL(new Blob([event.data.bundle],{type:'text/javascript'})));
 let serial=0,time=0,stopped=false,animated=false,user=null,agent=null,mode='user',drag=null,frameBusy=false,drawBudget=1,splats=false,directSplats=false;const pending=new Map();
 const send=(kind,data)=>port.postMessage({kind,...data});
 worker.onmessage=e=>{const p=pending.get(e.data.id);if(p){pending.delete(e.data.id);e.data.ok?p.resolve(e.data.result):p.reject(new Error(e.data.error.message))}};
 worker.onerror=e=>{for(const p of pending.values())p.reject(new Error(e.message));pending.clear();send('error',{message:e.message})};
 const call=(method,input={},transfer=[])=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});worker.postMessage({id,method,input},transfer)});
 const view=()=>({camera:mode==='agent'&&agent?agent:user,time_s:time,width:Math.max(64,Math.round(innerWidth*devicePixelRatio)),height:Math.max(64,Math.round(innerHeight*devicePixelRatio))});
 const invalidate=()=>{drawBudget=splats?4:1};
 const changed=()=>{invalidate();send('camera',{camera:user,time_s:time})};
 addEventListener('resize',invalidate);
 async function draw(){if(stopped||frameBusy||(!animated&&!drawBudget))return;frameBusy=true;if(drawBudget)drawBudget--;try{const camera=await call('frame',view());if(!user)user=camera;send('time',{time_s:time});if(animated)time=Math.min(120,Math.round((time+1/30)*30)/30)}catch(e){stopped=true;throw e}finally{frameBusy=false}}
 const loop=async()=>{try{await draw();if(!stopped)setTimeout(loop,33)}catch(e){send('error',{message:e.message})}};
 const minus=(a,b)=>a.map((v,i)=>v-b[i]),length=a=>Math.hypot(...a),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=a=>{const l=length(a)||1;return a.map(v=>v/l)};
 const move=d=>{user.position=user.position.map((v,i)=>v+d[i]);user.target=user.target.map((v,i)=>v+d[i]);changed()};
 canvas.oncontextmenu=e=>e.preventDefault();canvas.onpointerdown=e=>{canvas.focus();canvas.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,button:e.button}};
 canvas.onpointermove=e=>{if(!drag||mode!=='user'||!user)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.x=e.clientX;drag.y=e.clientY;
  const delta=minus(user.position,user.target),r=length(delta)||1;
  if(drag.button===2){const f=norm(minus(user.target,user.position)),right=norm(cross(f,[0,0,1])),up=norm(cross(right,f));move(right.map((v,i)=>(-v*dx+up[i]*dy)*r/innerHeight))}
  else{const yaw=Math.atan2(delta[1],delta[0])-dx*.006,pitch=Math.max(.01,Math.min(Math.PI-.01,Math.acos(delta[2]/r)+dy*.006));user.position=[user.target[0]+r*Math.sin(pitch)*Math.cos(yaw),user.target[1]+r*Math.sin(pitch)*Math.sin(yaw),user.target[2]+r*Math.cos(pitch)];changed()}};
 canvas.onpointerup=async e=>{const click=drag&&Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<5;drag=null;if(click){const hit=await call('pick',{x:e.clientX/innerWidth*2-1,y:1-e.clientY/innerHeight*2,view:view()});send('select',{key:hit?.key||null})}};
 canvas.onwheel=e=>{e.preventDefault();if(mode!=='user'||!user)return;const delta=minus(user.position,user.target),factor=Math.exp(Math.max(-1,Math.min(1,e.deltaY*.001)));user.position=user.target.map((v,i)=>v+delta[i]*factor);changed()};
 canvas.onkeydown=e=>{if(mode!=='user'||!user||!['w','a','s','d','q','e'].includes(e.key.toLowerCase()))return;e.preventDefault();const key=e.key.toLowerCase(),f=norm([...minus(user.target,user.position).slice(0,2),0]),right=norm(cross(f,[0,0,1])),step=(e.shiftKey?4:1)*Math.max(.05,length(minus(user.position,user.target))*.025);move(key==='q'?[0,0,-step]:key==='e'?[0,0,step]:(key==='w'||key==='s'?f:right).map(v=>v*step*(key==='s'||key==='a'?-1:1)))};
 port.onmessage=async event=>{const {id,method,input={}}=event.data;try{let result;
  if(method==='dispose'){stopped=true;worker.terminate();result=true}
  else if(method==='view'){mode=input.mode;agent=input.camera||null;invalidate();result=true}
  else if(method==='focus'){const camera=await call('frame',{object_keys:input.key?[input.key]:undefined,preset:'overview',time_s:time});user=camera;mode='user';changed();result=camera}
  else if(method==='quality'){result=await call(method,input,input.asset?[input.asset.stream]:[]);splats=directSplats||input.mode==='ply';invalidate();if(input.mode==='glb')await call('frame',view())}
  else if(method==='select'){result=await call(method,input);invalidate()}
  else result=await call(method,input);
  port.postMessage({id,ok:true,result})
 }catch(e){port.postMessage({id,ok:false,error:e.message})}};
 try{const offscreen=canvas.transferControlToOffscreen(),assets=event.data.assets;const snapshot=await call('init',{canvas:offscreen,width:Math.max(64,innerWidth),height:Math.max(64,innerHeight),seed:event.data.seed,assets},[offscreen,...assets.map(asset=>asset.bytes)]);animated=snapshot.animated;directSplats=splats=snapshot.assets.some(asset=>asset.instances_in_scene>0&&/\.(ply|spz)$/i.test(asset.path));await draw();changed();send('ready',{snapshot,camera:user});loop()}catch(e){send('error',{message:e.message})}
});
</script></body></html>`
