import { createCPU } from '../web/cpu.mjs';
import { Heap, read32, write32 } from '../web/memory.mjs';
import { objcImports } from '../web/objc.mjs';

// Exercise the same UIApplication loop and Objective-C dispatch as a loaded app.
// Each guest IMP saves r0-r3 into guest memory before returning through LR.
export async function startTouchTest(canvas, orientation, {multiple=false,onTurn=()=>{}} = {}) {
  const cpu=await createCPU(), heap=new Heap(cpu), abort=new AbortController();
  const read=p=>read32(cpu,p), write=(p,v)=>write32(cpu,p,v);
  const events=[];
  let objc, view;
  const f=(name,...args)=>objc.funcs[name](i=>args[i] ?? 0);
  const sel=name=>f('_sel_registerName',heap.string(name));
  const send=(self,name,...args)=>f('_objc_msgSend',self,sel(name),...args);
  const cls=name=>objc.resolveData('_OBJC_CLASS_$_'+name);
  const getPoint=async(t,selector)=>{
    const p=heap.zero(8); await f('_objc_msgSend_stret',p,t,sel(selector),view);
    const b=cpu.read(p,8), d=new DataView(b.buffer,b.byteOffset,8);
    const xy=[d.getFloat32(0,true),d.getFloat32(4,true)]; heap.free(p); return xy;
  };
  cpu.map(0x4000,4096,5); const captured=heap.zero(16);
  const words=[0xe59fc004,0xe88c000f,0xe12fff1e,captured];
  const code=new Uint8Array(16),d=new DataView(code.buffer);
  words.forEach((w,i)=>d.setUint32(i*4,w,true)); cpu.write(0x4000,code);
  objc=objcImports(cpu,heap,{info:orientation?{UIInterfaceOrientation:orientation}:{},bundlePath:'Payload/Test.app'},()=>({canvas}),async(pc,args)=>{
    cpu.setReg(14,0x4ff0); args.forEach((v,i)=>cpu.setReg(i,v));
    const status=cpu.run(pc,{until:0x4ff0,count:100});
    if(status.reason!=='until' || read(captured)!==view)throw Error('ARM touch callback failed');
    const set=read(captured+8), evt=read(captured+12);
    const touch=await send(set,'anyObject'), all=await send(evt,'allTouches');
    const objects=await send(all,'allObjects'), allPhases=[];
    for(let i=0;i<await send(objects,'count');i++)allPhases.push(await send(await send(objects,'objectAtIndex:',i),'phase'));
    events.push({allPhases,phase:await send(touch,'phase'),target:await send(touch,'view'),expected:view,
      point:await getPoint(touch,'locationInView:'),previous:await getPoint(touch,'previousLocationInView:'),
      count:await send(all,'count'),touch});
  },abort.signal,onTurn);
  const child=heap.zero(20), meta=heap.zero(20), methods=heap.zero(8+4*12);
  const host=cls('UIView'), name=heap.string('TouchTestView');
  for(const [p,isa,superclass] of [[child,meta,host],[meta,read(read(host)),read(host)]]) {
    const ro=heap.zero(40); write(p,isa);write(p+4,superclass);write(p+16,ro);
    write(ro+8,p===child?4:20);write(ro+16,name);if(p===child)write(ro+20,methods);
  }
  write(methods,12);write(methods+4,4);
  ['Began','Moved','Ended','Cancelled'].forEach((part,i)=>{
    write(methods+8+i*12,heap.string('touches'+part+':withEvent:'));write(methods+16+i*12,0x4000);
  });
  const list=heap.zero(4);write(list,child);
  objc.install({segments:[{sections:[{name:'__objc_classlist',address:list,size:4}]}]});
  const bits=n=>new Uint32Array(Float32Array.of(n).buffer)[0];
  const win=await send(cls('UIWindow'),'alloc');
  await send(win,'initWithFrame:',...(orientation?[0,0,320,568]:[0,0,200,100]).map(bits));
  view=await send(child,'alloc');await send(view,'initWithFrame:',...[10,20,180,80].map(bits));
  if(orientation) {
    const controller=await send(cls('UIViewController'),'alloc'),rootView=await send(cls('UIView'),'alloc');
    await send(rootView,'initWithFrame:',...[0,0,568,320].map(bits));
    await send(controller,'setView:',rootView);
    await send(rootView,'addSubview:',view);
    await send(win,'setRootViewController:',controller);
  } else {
    await send(win,'addSubview:',view);
  }
  await send(win,'makeKeyAndVisible');
  await send(view,'setMultipleTouchEnabled:',Number(multiple));
  const running=f('_UIApplicationMain',0,0,0,0).catch(e=>{if(!abort.signal.aborted)throw e;});
  return {events, async stop(){abort.abort();await running;cpu.close();}};
}
