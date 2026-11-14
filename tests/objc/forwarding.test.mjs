import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
function typedMethod(x,cls,encoding){const data=x.read(cls+16),list=x.read(data+20);x.write(list+12,x.heap.string(encoding));}
const text=(x,value)=>x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string(value));
test('NSProxy uses a guest protocol signature to archive arguments and return the forwarded object',async t=>{
 let signature=0,seen,retained;
 const x=await fixture(t,async(pc,args)=>{
  if(pc===0x5301)return signature;
  assert.equal(pc,0x5311);
  const inv=args[2],buffer=x.heap.zero(8);
  assert.equal(await x.send(inv,'selector'),x.sel('createUsingUser:'));
  await x.send(inv,'getArgument:atIndex:',buffer,2);seen=x.read(buffer);
  await x.send(inv,'retainArguments');retained=await x.send(inv,'argumentsRetained');
  x.write(buffer,seen);await x.send(inv,'setReturnValue:',buffer);x.heap.free(buffer);
 });
 const proxy=x.instance('RemoteProxy',[['methodSignatureForSelector:',0x5301],['forwardInvocation:',0x5311]],[],x.cls('NSProxy'));
 x.install({'__objc_classlist':[proxy]});
 signature=await x.send(x.cls('NSMethodSignature'),'signatureWithObjCTypes:',x.heap.string('@@:@'));
 const self=await x.send(proxy,'alloc'),user=await x.send(x.cls('NSObject'),'new');
 assert.equal(await x.send(self,'createUsingUser:',user),user);assert.equal(seen,user);assert.equal(retained,1);
 assert.equal(await x.send(user,'retainCount'),1);
 await x.send(self,'release');await x.send(user,'release');await x.send(signature,'release');
});
test('forwarding preserves 64 bit scalars, structures and stack arguments across nested dispatch',async t=>{
 let signature;const calls=[];
 const x=await fixture(t,async(pc,args)=>{
  if(pc===0x5401)return signature;
  calls.push(args[2]);const inv=args[2],buf=x.heap.zero(12);
  await x.send(inv,'getArgument:atIndex:',buf,2);assert.deepEqual([...x.cpu.read(buf,8)],[1,0,0,0,2,0,0,0]);
  await x.send(inv,'getArgument:atIndex:',buf,3);assert.equal(x.read(buf),3);
  x.write(buf,0x89abcdef);x.write(buf+4,0x12345678);await x.send(inv,'setReturnValue:',buf);x.heap.free(buf);
 });
 const cls=x.instance('WideProxy',[['methodSignatureForSelector:',0x5401],['forwardInvocation:',0x5411]],[],x.cls('NSProxy'));x.install({'__objc_classlist':[cls]});
 const self=await x.send(cls,'alloc');signature=await x.send(x.cls('NSMethodSignature'),'signatureWithObjCTypes:',x.heap.string('Q@:Qi'));
 assert.equal(await x.send(self,'wide:tail:',1,2,3),0x1234567889abcdefn);assert.equal(x.heap.live.has(calls[0]),false);
 await x.send(signature,'release');signature=await x.send(x.cls('NSMethodSignature'),'signatureWithObjCTypes:',x.heap.string('{Pair=II}@:{Pair=II}i'));
 const out=x.heap.zero(8);assert.equal(await x.f('_objc_msgSend_stret',out,self,x.sel('pair:tail:'),1,2,3),out);assert.equal(x.read(out),0x89abcdef);assert.equal(x.read(out+4),0x12345678);
 assert.equal(calls.length,2);assert.equal(x.heap.live.has(calls[1]),false);
 await x.send(signature,'release');await x.send(self,'release');x.heap.free(out);
});
test('NSInvocation invokes a guest implementation using signature types and owns retained arguments',async t=>{
 let called;const x=await fixture(t,(pc,args,wide)=>{assert.equal(pc,0x5501);called=[args,wide];return 0x1122334455667788n;});
 const cls=x.instance('InvocationTarget',[['calculate:',0x5501]]);typedMethod(x,cls,'Q@:@');x.install({'__objc_classlist':[cls]});
 const target=await x.send(cls,'new'),signature=await x.send(target,'methodSignatureForSelector:',x.sel('calculate:'));
 assert.equal(await x.send(signature,'numberOfArguments'),3);assert.equal(await x.send(signature,'methodReturnLength'),8);
 const invocation=await x.send(x.cls('NSInvocation'),'invocationWithMethodSignature:',signature),value=await text(x,'argument'),buffer=x.heap.zero(8);
 await x.send(invocation,'setTarget:',target);await x.send(invocation,'setSelector:',x.sel('calculate:'));x.write(buffer,value);await x.send(invocation,'setArgument:atIndex:',buffer,2);
 await x.send(invocation,'retainArguments');await x.send(target,'release');await x.send(value,'release');
 await x.send(invocation,'invoke');assert.deepEqual(called,[[target,x.sel('calculate:'),value],true]);
 await x.send(invocation,'getReturnValue:',buffer);assert.equal(x.read(buffer),0x55667788);assert.equal(x.read(buffer+4),0x11223344);
 await x.send(invocation,'release');assert.equal(x.heap.live.has(target),false);assert.equal(x.heap.live.has(value),false);
 await x.send(signature,'release');x.heap.free(buffer);
});
test('protocol method descriptions search adopted protocols and distinguish required from optional',async t=>{
 const x=await fixture(t),base=x.heap.zero(44),child=x.heap.zero(44),list=x.heap.zero(20),adopted=x.heap.zero(8),out=x.heap.zero(8),types=x.heap.string('@@:@');
 x.write(list,12);x.write(list+4,1);x.write(list+8,x.heap.string('fetch:'));x.write(list+12,types);x.write(base+12,list);
 x.write(adopted,1);x.write(adopted+4,base);x.write(child+8,adopted);
 assert.equal(x.f('_protocol_getMethodDescription',out,child,x.sel('fetch:'),1,1),out);assert.equal(x.read(out),x.sel('fetch:'));assert.equal(x.read(out+4),types);
 x.f('_protocol_getMethodDescription',out,child,x.sel('fetch:'),0,1);assert.deepEqual([x.read(out),x.read(out+4)],[0,0]);
});
