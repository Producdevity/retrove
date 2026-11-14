import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {readString} from '../../web/memory.mjs';
test('legacy and explicit NSString C-string constructors use the same decoder and preserve mutable subclasses',async t=>{
 const x=await fixture(t),pointer=x.heap.string('café 🎮');
 assert.equal(await x.send(x.cls('NSString'),'defaultCStringEncoding'),4);
 const string=await x.send(x.cls('NSString'),'stringWithCString:',pointer);
 assert.equal(readString(x.cpu,await x.send(string,'cString')),'café 🎮');
 const mutable=await x.send(x.cls('NSMutableString'),'stringWithCString:encoding:',pointer,4);
 assert.equal(x.read(mutable),x.cls('NSMutableString'));
 const instance=await x.send(x.cls('NSString'),'alloc');assert.equal(await x.send(instance,'initWithCString:',pointer),instance);
 assert.equal(readString(x.cpu,await x.send(instance,'UTF8String')),'café 🎮');
});
test('C-string construction rejects invalid encoding and releases failed initializer receivers',async t=>{
 const x=await fixture(t),pointer=x.heap.alloc(4);x.cpu.write(pointer,Uint8Array.of(0xc3,0x28,0));
 assert.equal(await x.send(x.cls('NSString'),'stringWithCString:',pointer),0);
 const init=x.sel('initWithUTF8String:'),instance=await x.send(x.cls('NSString'),'alloc');
 assert.equal(await x.f('_objc_msgSend',instance,init,pointer),0);assert.equal(x.heap.live.has(instance),false);
 const latin=x.heap.alloc(4);x.cpu.write(latin,Uint8Array.of(0xe9,0));
 const value=await x.send(x.cls('NSString'),'stringWithCString:encoding:',latin,5);
 assert.equal(readString(x.cpu,await x.send(value,'UTF8String')),'é');
});


test('Core Foundation bundle keys are stable string data symbols backed by the imported metadata',async t=>{
 const x=await fixture(t),bundle=await x.send(x.cls('NSBundle'),'mainBundle');
 const symbol=x.objc.resolveData('_kCFBundleIdentifierKey');assert.ok(symbol);assert.equal(x.objc.resolveData('_kCFBundleIdentifierKey'),symbol);
 const key=x.read(symbol),value=await x.send(bundle,'objectForInfoDictionaryKey:',key);
 assert.equal(readString(x.cpu,await x.send(value,'UTF8String')),'com.test.fixture');
 const version=x.read(x.objc.resolveData('_kCFBundleVersionKey'));
 assert.equal(readString(x.cpu,await x.send(version,'UTF8String')),'CFBundleVersion');
 assert.equal(await x.send(bundle,'objectForInfoDictionaryKey:',version),0);
});
