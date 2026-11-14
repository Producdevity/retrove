import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {coreGraphics} from '../../web/coregraphics.mjs';
import {floatBits} from '../../src/runtime/ios/abi/scalars.ts';

async function setup(t,call,options) {
 const x=await fixture(t,call,new Map(),options),cg=coreGraphics(x.cpu,x.heap,x.objc);
 x.objc.attachCoreGraphics(cg);
 const f=(name,...values)=>cg.funcs[name](i=>values[i]??0);
 const components=color=>{
  const count=f('_CGColorGetNumberOfComponents',color),pointer=f('_CGColorGetComponents',color);
  const bytes=x.cpu.read(pointer,count*4),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  return Array.from({length:count},(_,i)=>view.getFloat32(i*4,true));
 };
 const buffer=values=>{const p=x.heap.zero(values.length*4);values.forEach((v,i)=>x.write(p+i*4,floatBits(v)));return p;};
 return {...x,cg,f,components,buffer};
}

test('WinObjC CGColorGetComponents: RGB copies own immutable components and an independent alpha',async t=>{
 const x=await setup(t),space=x.f('_CGColorSpaceCreateDeviceRGB'),source=x.buffer([1,0,0,1]);
 const color=x.f('_CGColorCreate',space,source),copy=x.f('_CGColorCreateCopyWithAlpha',color,floatBits(.5));
 x.write(source,floatBits(0));x.heap.free(source);
 assert.deepEqual(x.components(color),[1,0,0,1]);assert.deepEqual(x.components(copy),[1,0,0,.5]);
 assert.equal(x.f('_CGColorGetColorSpace',copy),space);assert.equal(x.f('_CGColorGetAlpha',copy),floatBits(.5));
 assert.equal(x.f('_CGColorSpaceGetModel',space),1);
 await x.f('_CGColorSpaceRelease',space);assert.equal(x.cg.retainCount(space),2);
 await x.f('_CGColorRelease',color);assert.deepEqual(x.components(copy),[1,0,0,.5]);
 const pointer=x.f('_CGColorGetComponents',copy);await x.f('_CGColorRelease',copy);
 for(const p of [space,color,copy,pointer])assert.equal(x.heap.live.has(p),false);
});

test('WinObjC CGGenericGray and CGGenericRGB: constructors and model equality agree',async t=>{
 const x=await setup(t);
 for(const [kind,values] of [['Gray',[.5,1]],['RGB',[1,0,0,1]]]) {
  const space=x.f('_CGColorSpaceCreateDevice'+kind),buffer=x.buffer(values);
  const color=x.f('_CGColorCreate',space,buffer),generic=await x.f('_CGColorCreateGeneric'+kind,...values.map(floatBits));
  assert.equal(x.f('_CGColorEqualToColor',color,generic),1);assert.deepEqual(x.components(generic),values);
  assert.equal(x.f('_CGColorGetNumberOfComponents',color),values.length);
  await x.f('_CGColorRelease',color);await x.f('_CGColorRelease',generic);await x.f('_CGColorSpaceRelease',space);x.heap.free(buffer);
 }
});

test('WinObjC CGColorEquals: retained copies survive their original and alpha changes compare unequal',async t=>{
 const x=await setup(t),color=await x.f('_CGColorCreateGenericRGB',...[1,0,0,1].map(floatBits));
 const copy=x.f('_CGColorCreateCopy',color),changed=x.f('_CGColorCreateCopyWithAlpha',color,floatBits(.9));
 assert.equal(x.f('_CGColorEqualToColor',color,copy),1);assert.equal(x.f('_CGColorEqualToColor',color,changed),0);
 assert.equal(await x.objc.funcs._CFEqual(i=>[color,changed][i]),0);
 await x.f('_CGColorRelease',color);assert.deepEqual(x.components(copy),[1,0,0,1]);
 await x.f('_CGColorRelease',copy);await x.f('_CGColorRelease',changed);
 assert.equal(x.f('_CGColorRetain',0),0);assert.equal(x.f('_CGColorCreate',0,0),0);
 assert.equal(x.f('_CGColorCreateCopy',0),0);assert.equal(x.f('_CGColorCreateCopyWithAlpha',0,floatBits(.5)),0);
 await x.f('_CGColorRelease',0);
});

test('WinObjC GetConstantColor and native gray oracle: borrowed colors have two components and stable identity',async t=>{
 const x=await setup(t);
 for(const [symbol,values] of [['_kCGColorBlack',[0,1]],['_kCGColorWhite',[1,1]],['_kCGColorClear',[0,0]]]) {
  const name=x.read(x.objc.resolveData(symbol)),[color,concurrent]=await Promise.all([x.f('_CGColorGetConstantColor',name),x.f('_CGColorGetConstantColor',name)]);
  assert.equal(color,concurrent);
  assert.ok(color);assert.equal(await x.f('_CGColorGetConstantColor',name),color);
  assert.deepEqual(x.components(color),values);
  assert.equal(x.f('_CGColorSpaceGetModel',x.f('_CGColorGetColorSpace',color)),0);
  x.f('_CGColorRetain',color);await x.f('_CGColorRelease',color);assert.equal(x.cg.retainCount(color),1);
 }
 const unknown=await x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string('unknown'));
 assert.equal(await x.f('_CGColorGetConstantColor',unknown),0);
});

test('UIColor owns a separate cached CGColor and CALayer retains it across autorelease-pool draining',async t=>{
 const x=await setup(t),pool=x.objc.funcs._objc_autoreleasePoolPush();
 const layer=await x.send(x.cls('CALayer'),'new'),ui=await x.send(x.cls('UIColor'),'colorWithWhite:alpha:',floatBits(.75),floatBits(.5));
 const color=await x.send(ui,'CGColor');assert.notEqual(color,ui);assert.equal(await x.send(ui,'CGColor'),color);
 assert.deepEqual(x.components(color),[.75,.5]);
 await x.send(layer,'setBackgroundColor:',color);await x.send(layer,'setBorderColor:',color);
 assert.equal(x.cg.retainCount(color),3);await x.objc.funcs._objc_autoreleasePoolPop(()=>pool);
 assert.equal(x.heap.live.has(ui),false);assert.equal(x.cg.retainCount(color),2);
 assert.equal(await x.send(layer,'backgroundColor'),color);assert.equal(await x.send(layer,'borderColor'),color);
 await x.send(layer,'setBackgroundColor:',0);assert.equal(x.cg.retainCount(color),1);
 await x.send(layer,'release');assert.equal(x.heap.live.has(color),false);
});

test('UIColor copies CGColor channels, CF retain/release routes Quartz ownership and invalid layer colors fail',async t=>{
 const x=await setup(t),pool=x.objc.funcs._objc_autoreleasePoolPush();
 const color=await x.f('_CGColorCreateGenericGray',floatBits(.75),floatBits(.5));
 const ui=await x.send(x.cls('UIColor'),'colorWithCGColor:',color);
 assert.equal(x.objc.funcs._CFRetain(()=>color),color);assert.equal(x.objc.funcs._CFGetRetainCount(()=>color),2);
 await x.f('_CGColorRelease',color);await x.objc.funcs._CFRelease(()=>color);
 const borrowed=await x.send(ui,'CGColor');assert.deepEqual(x.components(borrowed),[.75,.5]);
 const layer=await x.send(x.cls('CALayer'),'new');await assert.rejects(()=>x.send(layer,'setBorderColor:',ui),/Invalid CALayer color/);
 await x.send(layer,'release');await x.objc.funcs._objc_autoreleasePoolPop(()=>pool);
 assert.equal(x.cg.colors.has(borrowed),false);
});

test('CGContext color setters target the selected context without mutating the color or another context',async t=>{
 const x=await setup(t),color=await x.f('_CGColorCreateGenericRGB',...[1,0,.5,.25].map(floatBits));
 const canvas=()=>({save(){},restore(){},fillStyle:'black',strokeStyle:'black'}),outer=canvas(),inner=canvas();
 await x.cg.withContext(outer,async()=>{
  const parent=x.f('_UIGraphicsGetCurrentContext');
  await x.cg.withContext(inner,async()=>{
   const child=x.f('_UIGraphicsGetCurrentContext');
   x.f('_CGContextSetFillColorWithColor',parent,color);x.f('_CGContextSetStrokeColorWithColor',child,color);
  });
 });
 assert.equal(outer.fillStyle,'rgba(255,0,127.5,0.25)');assert.equal(inner.fillStyle,'black');
 assert.equal(inner.strokeStyle,'rgba(255,0,127.5,0.25)');assert.equal(outer.strokeStyle,'black');
 assert.deepEqual(x.components(color),[1,0,.5,.25]);await x.f('_CGColorRelease',color);
});


test('CFType collection callbacks retain Quartz colors and compare/hash equal values without Objective-C messaging',async t=>{
 const gates=new Map();let next=0x44000000;
 const x=await setup(t,(pc,args)=>gates.get(pc)(i=>args[i]??0),{hostGate:(_meta,fn)=>{next+=4;gates.set(next,fn);return next;}});
 const original=await x.f('_CGColorCreateGenericRGB',...[1,0,-0,1].map(floatBits));
 const equal=await x.f('_CGColorCreateGenericRGB',...[1,-0,0,1].map(floatBits));
 const callbacks=x.objc.resolveData('_kCFTypeArrayCallBacks'),array=await x.objc.funcs._CFArrayCreateMutable(i=>[0,0,callbacks][i]);
 await x.objc.funcs._CFArrayAppendValue(i=>[array,original][i]);
 assert.equal(x.cg.retainCount(original),2);assert.equal(await x.objc.funcs._CFEqual(i=>[original,equal][i]),1);
 assert.equal(await x.objc.funcs._CFArrayContainsValue(i=>[array,0,1,equal][i]),1);
 assert.equal(await x.objc.funcs._CFHash(()=>original),await x.objc.funcs._CFHash(()=>equal));
 const originalSpace=x.f('_CGColorGetColorSpace',original);
 await x.f('_CGColorRelease',original);assert.ok(x.cg.colors.has(original));
 await x.objc.funcs._CFRelease(()=>array);assert.equal(x.cg.colors.has(original),false);assert.equal(x.heap.live.has(originalSpace),false);
 await x.f('_CGColorRelease',equal);
});
