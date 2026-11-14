import {test, vi} from 'vite-plus/test';
import assert from 'node:assert/strict';
import { readString, write32 } from '../web/memory.mjs';
import { fixture } from './objc/fixture.mjs';


test('guest class and category IMP lookup, nil returns, and super2 rewrites self', async t => {
  const x = await fixture(t);
  const parent = x.instance('Parent', [['act:',0x4300]]);
  const child = x.instance('Child', [['act:',0x4311]], [], parent);
  x.install({'__objc_classlist':[parent,child]});
  const self = await x.send(child, 'alloc');
  assert.equal(x.read(self), child);
  assert.deepEqual(await x.send(self, 'act:', 7), {jump:0x4311});
  const sup = x.heap.zero(8); x.write(sup, self); x.write(sup + 4, child);
  assert.deepEqual(await x.f('_objc_msgSendSuper2', sup, x.sel('act:'), 7), {jump:0x4300});
  assert.equal(x.cpu.getReg(0), self);
  assert.equal(await x.send(0,'arbitrary'), 0);
  await assert.rejects(x.send(self,'missing:'), /Child missing:/);
  const cat = x.heap.zero(24), methods = x.heap.zero(20);
  x.write(cat + 4, child); x.write(cat + 8, methods); x.write(methods, 12); x.write(methods + 4, 1);
  x.write(methods + 8, x.heap.string('act:')); x.write(methods + 16, 0x4330);
  x.install({'__objc_catlist':[cat]});
  assert.deepEqual(await x.send(self,'act:', 7), {jump:0x4330});
});

test('calls +load and +initialize on class receivers and initializes each class once', async t => {
  const calls = [], x = await fixture(t, (pc,args) => calls.push([pc,...args]));
  const parent = x.instance('Parent', [], [['load',0x5100], ['initialize',0x5110]]);
  const child = x.instance('Child', [], [['load',0x5120]], parent);
  x.install({'__objc_classlist':[child,parent], '__objc_nlclslist':[child,parent]});
  await x.objc.start(); await x.send(child,'alloc'); await x.send(child,'alloc');
  assert.deepEqual(calls.map(c => c.slice(0,2)), [[0x5100,parent],[0x5120,child],[0x5110,parent],[0x5110,child]]);
});
test('bridges UTF-8 strings, bundle metadata and autorelease pools', async t => {
  const x = await fixture(t);
  const token = x.f('_objc_autoreleasePoolPush');
  const self = await x.send(x.cls('NSString'), 'stringWithUTF8String:', x.heap.string('café 🎮'));
  assert.equal(await x.send(self,'length'), 'café 🎮'.length);
  assert.equal(readString(x.cpu, await x.send(self,'UTF8String')), 'café 🎮');
  const bundle = await x.send(x.cls('NSBundle'), 'mainBundle');
  const value = await x.send(bundle,'bundleIdentifier');
  assert.equal(readString(x.cpu, await x.send(value,'UTF8String')), 'com.test.fixture');
  await x.f('_objc_autoreleasePoolPop', token);
  assert.equal(x.heap.live.has(value), false);
});
test('UIApplicationMain delivers guest delegate callbacks in launch order', async t => {
  const calls = [], x = await fixture(t, (pc,args) => { calls.push([pc,args]); return 1; });
  const cls = x.instance('GameDelegate', [
    ['application:willFinishLaunchingWithOptions:',0x4500],
    ['application:didFinishLaunchingWithOptions:',0x4520],
    ['applicationDidBecomeActive:',0x4530],
  ]);
  x.install({'__objc_classlist':[cls]});
  const name = await x.send(x.cls('NSString'), 'stringWithUTF8String:', x.heap.string('GameDelegate'));
  await assert.rejects(x.f('_UIApplicationMain',1,0,0,name), /without a supported event source/);
  assert.deepEqual(calls.map(c => c[0]), [0x4500,0x4520,0x4530]);
  assert.ok(calls.every(c => x.read(c[1][0]) === cls));
  assert.ok(calls.every(c => c[1][2] === calls[0][1][2]));
});

test('UIApplication forwards visibility changes and notifications through guest Objective-C methods', async t => {
  class Visibility extends EventTarget {
    hidden = false;
    show(visible) {this.hidden=!visible;this.dispatchEvent(new Event('visibilitychange'));}
  }
  const visibility=new Visibility(), calls=[];
  vi.stubGlobal('document',visibility);
  t.onTestFinished(()=>vi.unstubAllGlobals());
  let active=0,timer;
  const callback={active:0x4500,inactive:0x4520,background:0x4540,foreground:0x4560,tick:0x4580,notification:0x45a0};
  const x=await fixture(t,async(pc,args)=>{
    if(pc===callback.tick) {if(active===1)visibility.show(false);return;}
    if(pc===callback.notification) {
      const name=await x.send(args[2],'name');
      const sender=await x.send(args[2],'object');
      calls.push([readString(x.cpu,await x.send(name,'UTF8String')),await x.send(sender,'applicationState')]);
      return;
    }
    calls.push([readString(x.cpu,args[1]),await x.send(args[2],'applicationState')]);
    if(pc===callback.active && ++active===1) {
      timer=await x.send(x.cls('NSTimer'),'scheduledTimerWithTimeInterval:target:selector:userInfo:repeats:',0,0,args[0],x.sel('tick:'),0,1);
    }
    if(pc===callback.active && active===2)await x.send(timer,'invalidate');
    if(pc===callback.background)visibility.show(true);
  });
  t.onTestFinished(()=>x.objc.close());
  const delegate=x.instance('LifecycleDelegate',[
    ['applicationDidBecomeActive:',callback.active],['applicationWillResignActive:',callback.inactive],
    ['applicationDidEnterBackground:',callback.background],['applicationWillEnterForeground:',callback.foreground],
    ['tick:',callback.tick],['notified:',callback.notification],
  ]);
  x.install({'__objc_classlist':[delegate]});
  const observer=await x.send(delegate,'alloc'),center=await x.send(x.cls('NSNotificationCenter'),'defaultCenter');
  await x.send(center,'addObserver:selector:name:object:',observer,x.sel('notified:'),0,0);
  const name=await x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string('LifecycleDelegate'));
  await assert.rejects(x.f('_UIApplicationMain',0,0,0,name),/without a supported event source/);
  assert.equal(await x.send(timer,'isValid'),0);
  assert.deepEqual(calls,[
    ['applicationDidBecomeActive:',0],['UIApplicationDidBecomeActiveNotification',0],
    ['applicationWillResignActive:',1],['UIApplicationWillResignActiveNotification',1],
    ['applicationDidEnterBackground:',2],['UIApplicationDidEnterBackgroundNotification',2],
    ['UIApplicationWillEnterForegroundNotification',1],['applicationWillEnterForeground:',1],
    ['applicationDidBecomeActive:',0],['UIApplicationDidBecomeActiveNotification',0],
  ]);
});

test('Darwin returns a retained directory array and exports NSString constants through data slots', async t => {
  const x = await fixture(t);
  const token = x.f('_objc_autoreleasePoolPush');
  const paths = x.f('_NSSearchPathForDirectoriesInDomains', 9, 1, 1);
  await x.send(paths, 'retain');
  await x.f('_objc_autoreleasePoolPop', token);
  const directory = await x.send(paths, 'objectAtIndex:', 0);
  assert.equal(readString(x.cpu, await x.send(directory, 'UTF8String')), '/Documents');
  await x.send(paths, 'release');
  assert.equal(x.heap.live.has(directory), false);
  const alias = x.objc.resolveData('_kCFRunLoopDefaultMode');
  assert.equal(x.objc.resolveData('_NSDefaultRunLoopMode'), alias);
  const constant = x.read(alias);
  await x.send(constant, 'release');
  assert.equal(readString(x.cpu, await x.send(constant, 'UTF8String')), 'kCFRunLoopDefaultMode');
});

test('CFData copies guest bytes and bridges to NSData with matching ownership', async t => {
  const x = await fixture(t);
  const p = x.heap.zero(4);
  x.write(p, 0x76543210);
  const data = x.f('_CFDataCreate', 0, p, 4);
  x.write(p, 0);
  assert.equal(await x.send(data, 'length'), 4);
  const bytes = x.f('_CFDataGetBytePtr', data);
  assert.equal(bytes, await x.send(data, 'bytes'));
  assert.equal(x.read(bytes), 0x76543210);
  x.f('_CFRelease', data);
  assert.equal(x.heap.live.has(bytes), false);
});

test('CF arrays and dictionaries honor raw pointers and copied guest callbacks', async t => {
  const calls=[];
  const x=await fixture(t,(pc,args)=>{calls.push([pc,...args]); return pc===0x110?args[1]:Number(args[0]===args[1]);});
  const cb=x.heap.zero(20);x.write(cb+4,0x110); x.write(cb+8,0x120);x.write(cb+16,0x130);
  const arr=x.f('_CFArrayCreateMutable',0,0,cb);
  x.write(cb+4,0);
  await x.f('_CFArrayAppendValue',arr,0xffeffff0);
  assert.equal(await x.send(arr,'count'),1);
  assert.equal(await x.f('_CFArrayContainsValue',arr,0,1,0x1234),0);
  assert.equal(await x.f('_CFArrayGetFirstIndexOfValue',arr,0,1,0xffeffff0),0);
  await x.f('_CFArrayRemoveValueAtIndex',arr,0);
  assert.deepEqual(calls,[[0x110,0,0xffeffff0],[0x130,0xffeffff0,0x1234],[0x120,0,0xffeffff0]]);
  const dict=x.f('_CFDictionaryCreateMutable',0,2,0,0);
  await x.f('_CFDictionaryAddValue',dict,77,0x12345); await x.f('_CFDictionaryAddValue',dict,77,88);
  assert.equal(await x.send(dict,'objectForKey:',77),0x12345);
  await x.f('_CFDictionaryRemoveValue',dict,77);
  assert.equal(await x.f('_CFDictionaryGetValue',dict,77),0);
  await x.f('_CFRelease',arr); await x.f('_CFRelease',dict);
});

test('CF strings bridge UTF-16, obey C buffer bounds, and percent-escape UTF-8', async t => {
  const x=await fixture(t),buffer=x.heap.zero(64);
  const data=Buffer.from('A 🎮','utf16le');x.cpu.write(buffer,data);
  const s=x.f('_CFStringCreateWithCharacters',0,buffer,data.length/2);
  const ptr=x.f('_CFStringGetCharactersPtr',s);
  assert.deepEqual(Buffer.from(x.cpu.read(ptr,data.length)),data);
  const out=x.heap.zero(64);assert.equal(x.f('_CFStringGetCString',s,out,4,0x08000100),0);
  assert.equal(x.f('_CFStringGetCString',s,out,64,0x08000100),1);
  assert.equal(readString(x.cpu,out),'A 🎮');
  const escaped=x.f('_CFURLCreateStringByAddingPercentEscapes',0,s,0,0,0x08000100);
  assert.equal(readString(x.cpu,await x.send(escaped,'UTF8String')),'A%20%F0%9F%8E%AE');
  await x.f('_CFRelease',escaped);await x.f('_CFRelease',s);
});

test('bundle localization loads UTF-16 tables and preserves a caller-supplied fallback',async t=>{
  const table=Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('/* boot */ "start" = "Jouer 🎮";','utf16le')]);
  const x=await fixture(t,undefined,new Map([['Payload/Test.app/en.lproj/Menu.strings',table]]));
  const str=s=>x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string(s));
  const value=async s=>readString(x.cpu,await x.send(s,'UTF8String'));
  const bundle=await x.send(x.cls('NSBundle'),'mainBundle');
  const key=await str('start'),fallback=await str('Play'),name=await str('Menu');
  assert.equal(await value(await x.send(bundle,'localizedStringForKey:value:table:',key,fallback,name)),'Jouer 🎮');
  const missing=await str('settings');
  assert.equal(await x.send(bundle,'localizedStringForKey:value:table:',missing,fallback,name),fallback);
  assert.equal(await x.send(bundle,'localizedStringForKey:value:table:',missing,0,name),missing);
});

test('copy properties survive caller pool drain and preserve the original mutable string value',async t=>{
  const x=await fixture(t), owner=x.heap.zero(8),token=x.f('_objc_autoreleasePoolPush');
  const str=s=>x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string(s));
  const value=async s=>readString(x.cpu,await x.send(s,'UTF8String'));
  const mutable=await x.send(await str('first'),'mutableCopy');
  await x.f('_objc_setProperty_nonatomic_copy',owner,0,mutable,4);
  const copy=await x.f('_objc_getProperty',owner,0,4,0);
  assert.notEqual(mutable,copy);
  await x.send(mutable,'setString:',await str('second'));
  await x.send(mutable,'release');
  await x.f('_objc_autoreleasePoolPop',token);
  assert.equal(await value(copy),'first');
  await x.f('_objc_setProperty_nonatomic_copy',owner,0,0,4);
  assert.equal(x.heap.live.has(copy),false);
});

test('NSString formatting uses ARM32 varargs and dictionary keys compare by string value',async t=>{
  const x=await fixture(t);
  const str=s=>x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string(s));
  const value=async s=>readString(x.cpu,await x.send(s,'UTF8String'));
  const format=await str('%@ %d %.1f'),name=await str('café');
  const double=new DataView(new ArrayBuffer(8));double.setFloat64(0,3.5,true);
  const args=[name,12,double.getUint32(0,true),double.getUint32(4,true)];
  const words=x.heap.zero(16);args.forEach((v,i)=>x.write(words+i*4,v));
  const text=await x.send(await x.send(x.cls('NSString'),'alloc'),'initWithFormat:arguments:',format,words);
  assert.equal(await value(text),'café 12 3.5');
  const dict=await x.send(x.cls('NSMutableDictionary'),'dictionary');
  await x.send(dict,'setObject:forKey:',text,name);
  assert.equal(await x.send(dict,'objectForKey:',await str('café')),text);
  await x.send(dict,'removeObjectForKey:',await str('café'));
  assert.equal(await x.send(dict,'count'),0);
});

test('main-run-loop timers call the guest selector with the timer and invalidate after firing',async t=>{
  const calls=[], x=await fixture(t,(pc,args)=>calls.push([pc,args]));
  const cls=x.instance('TimerOwner',[['tick:',0x4410]]); x.install({'__objc_classlist':[cls]});
  const target=await x.send(cls,'alloc'), timer=await x.send(x.cls('NSTimer'),'scheduledTimerWithTimeInterval:target:selector:userInfo:repeats:',0,0,target,x.sel('tick:'),0,0);
  assert.equal(await x.send(timer,'isValid'),1);
  await assert.rejects(x.f('_UIApplicationMain',0,0,0,0),/without a supported event source/);
  assert.equal(await x.send(timer,'isValid'),0);
  assert.deepEqual(calls,[[0x4410,[target,x.sel('tick:'),timer]]]);
});

test('UIKit invokes the animation before returning and preserves completion until the main run loop',async t=>{
  const calls=[],x=await fixture(t,(pc,args)=>{calls.push([pc,...args]);});
  const changes=x.heap.zero(20),completion=x.heap.zero(20),copy=x.heap.zero(20);
  x.write(changes+12,0x8410);x.write(copy+12,0x8420);
  x.objc.setDispatch({copy:async block=>{assert.equal(block,completion);return copy;},release:async block=>assert.equal(block,copy)});
  await x.send(x.cls('UIView'),'animateWithDuration:delay:options:animations:completion:',0,0,0,0,0,changes,completion);
  assert.deepEqual(calls,[[0x8410,changes]]);
  await assert.rejects(x.f('_UIApplicationMain',0,0,0,0),/without a supported event source/);
  assert.deepEqual(calls,[[0x8410,changes],[0x8420,copy,1]]);
});


test('NSScanner retains its source, scans device identifiers, and preserves failed output', async t => {
  const x = await fixture(t);
  const pool = x.f('_objc_autoreleasePoolPush');
  const source = await x.send(x.cls('NSString'), 'stringWithUTF8String:', x.heap.string('iPhone5,1'));
  const scanner = await x.send(x.cls('NSScanner'), 'scannerWithString:', source);
  const digits = await x.send(x.cls('NSCharacterSet'), 'decimalDigitCharacterSet');
  const output = x.heap.zero(4);
  x.write(output, 73);
  assert.equal(await x.send(scanner, 'scanInt:', output), 0);
  assert.equal(x.read(output), 73);
  assert.equal(await x.send(scanner, 'scanLocation'), 0);
  assert.equal(await x.send(scanner, 'scanUpToCharactersFromSet:intoString:', digits, output), 1);
  assert.equal(readString(x.cpu, await x.send(x.read(output), 'UTF8String')), 'iPhone');
  assert.equal(await x.send(scanner, 'scanInt:', output), 1);
  assert.equal(x.read(output), 5);
  await x.send(scanner, 'setScanLocation:', 8);
  await x.send(scanner, 'retain');
  await x.f('_objc_autoreleasePoolPop', pool);
  assert.equal(x.heap.live.has(source), true);
  assert.equal(await x.send(scanner, 'scanInt:', output), 1);
  assert.equal(x.read(output), 1);
  assert.equal(await x.send(scanner, 'isAtEnd'), 1);
  await x.send(scanner, 'release');
  assert.equal(x.heap.live.has(source), false);
});

test('UILabel copies mutable text, retains fonts and releases its owned objects', async t => {
  const x = await fixture(t);
  const pool = x.f('_objc_autoreleasePoolPush');
  const bits = value => new Uint32Array(Float32Array.of(value).buffer)[0];
  const label = await x.send(x.cls('UILabel'), 'alloc');
  await x.send(label, 'initWithFrame:', ...[0,0,120,30].map(bits));
  assert.equal(await x.send(label, 'isUserInteractionEnabled'), 0);
  const text = await x.send(x.cls('NSMutableString'), 'stringWithUTF8String:', x.heap.string('Play'));
  await x.send(label, 'setText:', text);
  await x.send(text, 'appendString:', await x.send(x.cls('NSString'), 'stringWithUTF8String:', x.heap.string(' changed')));
  const copy = await x.send(label, 'text');
  assert.equal(readString(x.cpu, await x.send(copy, 'UTF8String')), 'Play');
  const font = await x.send(x.cls('UIFont'), 'systemFontOfSize:', bits(18));
  await x.send(label, 'setFont:', font);
  await x.f('_objc_autoreleasePoolPop', pool);
  assert.equal(await x.send(font, 'pointSize'), bits(18));
  assert.equal(readString(x.cpu, await x.send(copy, 'UTF8String')), 'Play');
  await x.send(label, 'release');
  assert.equal(x.heap.live.has(font), false);
  assert.equal(x.heap.live.has(copy), false);
  assert.equal(x.heap.live.has(label), false);
});

test('run loops have per-thread identity and retain mode-specific valid ports', async t => {
  let thread = 1;
  const x = await fixture(t, undefined, undefined, {threads:{funcs:{_pthread_self:()=>thread}}});
  const pool = x.f('_objc_autoreleasePoolPush');
  const main = await x.send(x.cls('NSRunLoop'), 'mainRunLoop');
  thread = 2;
  const loop = await x.send(x.cls('NSRunLoop'), 'currentRunLoop');
  assert.notEqual(loop, main);
  assert.equal(x.f('_CFRunLoopGetCurrent'), loop);
  assert.equal(await x.send(x.cls('NSRunLoop'), 'mainRunLoop'), main);
  const mode = await x.send(x.cls('NSString'), 'stringWithUTF8String:', x.heap.string('GameMode'));
  const other = await x.send(x.cls('NSString'), 'stringWithUTF8String:', x.heap.string('OtherMode'));
  const port = await x.send(x.cls('NSMachPort'), 'port');
  const past = await x.send(x.cls('NSDate'), 'distantPast');
  assert.equal(await x.send(loop, 'runMode:beforeDate:', mode, past), 0);
  await x.send(loop, 'addPort:forMode:', port, mode);
  await x.send(loop, 'addPort:forMode:', port, mode);
  assert.equal(await x.send(port, 'retainCount'), 2);
  assert.equal(await x.send(loop, 'runMode:beforeDate:', mode, past), 1);
  assert.equal(await x.send(loop, 'runMode:beforeDate:', other, past), 0);
  await x.send(port, 'invalidate');
  assert.equal(await x.send(port, 'isValid'), 0);
  assert.equal(await x.send(port, 'retainCount'), 1);
  assert.equal(await x.send(loop, 'runMode:beforeDate:', mode, past), 0);
  thread = 1;
  await x.f('_objc_autoreleasePoolPop', pool);
});

test('a port run loop yields until its deadline and exposes the current mode while waiting', async t => {
  vi.useFakeTimers({toFake:['Date']});
  t.onTestFinished(()=>vi.useRealTimers());
  vi.setSystemTime(1000);
  const x = await fixture(t);
  const loop = await x.send(x.cls('NSRunLoop'), 'currentRunLoop');
  const mode = await x.send(x.cls('NSString'), 'stringWithUTF8String:', x.heap.string('GameMode'));
  const port = await x.send(x.cls('NSMachPort'), 'port');
  await x.send(loop, 'addPort:forMode:', port, mode);
  const now = await x.send(x.cls('NSDate'), 'date');
  const date = await x.send(now, 'dateByAddingTimeInterval:', 0, 0x3ff00000);
  const blocked = await x.send(loop, 'runMode:beforeDate:', mode, date);
  assert.equal(blocked.wait(), undefined);
  assert.equal(readString(x.cpu, await x.send(await x.send(loop,'currentMode'),'UTF8String')), 'GameMode');
  vi.setSystemTime(2000);
  assert.equal(blocked.wait(), 1);
  assert.equal(await x.send(loop, 'currentMode'), 0);
});

test('UIButton preserves title state and forwards actions to the guest without retaining targets', async t => {
  const calls = [], x = await fixture(t, (pc,args)=>{calls.push([pc,args]);return 0;});
  const targetClass = x.instance('ButtonTarget', [['pressed:',0x5100]]);
  x.install({'__objc_classlist':[targetClass]});
  const target = await x.send(targetClass,'alloc');
  const button = await x.send(x.cls('UIButton'),'buttonWithType:',0);
  const normal = await x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string('Play'));
  const selected = await x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string('Selected'));
  await x.send(button,'setTitle:forState:',normal,0);
  await x.send(button,'setTitle:forState:',selected,4);
  await x.send(button,'setSelected:',1);
  assert.equal(await x.send(button,'currentTitle'),selected);
  const title = await x.send(button,'titleLabel');
  await x.send(button,'layoutSubviews');
  assert.equal(readString(x.cpu,await x.send(await x.send(title,'text'),'UTF8String')),'Selected');
  await x.send(button,'addTarget:action:forControlEvents:',target,x.sel('pressed:'),64);
  assert.equal(await x.send(target,'retainCount'),1);
  await x.send(button,'sendActionsForControlEvents:',64);
  assert.deepEqual(calls,[[0x5100,[target,x.sel('pressed:'),button]]]);
  await x.send(button,'release');
  assert.equal(x.heap.live.has(title),false);
  assert.equal(x.heap.live.has(target),true);
});

test('NSURL backup exclusion checks file existence and reports unsupported resources', async t => {
  const paths = [];
  const x = await fixture(t,undefined,undefined,(cpu,heap)=>{
    const errno=heap.zero(4);
    return {sys:{funcs:{___error:()=>errno,_stat:arg=>{
      const path=readString(cpu,arg(0));paths.push(path);
      if(path==='/Documents/a b.dat') {cpu.write(arg(1)+4,Uint8Array.of(0xa4,0x81));return 0;}
      write32(cpu,errno,2);return -1;
    }}}};
  });
  const string = value => x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string(value));
  const yes=await x.send(x.cls('NSNumber'),'numberWithBool:',1), no=await x.send(x.cls('NSNumber'),'numberWithBool:',0);
  const key=await string('NSURLIsExcludedFromBackupKey');
  const url=await x.send(x.cls('NSURL'),'fileURLWithPath:',await string('/Documents/a b.dat'));
  const error=x.heap.zero(4);x.write(error,0x1234);
  assert.equal(await x.send(url,'setResourceValue:forKey:error:',yes,key,error),1);
  assert.equal(x.read(error),0x1234);
  assert.deepEqual(paths,['/Documents/a b.dat']);
  assert.equal(await x.send(url,'setResourceValue:forKey:error:',no,key,error),0);
  assert.equal(await x.send(x.read(error),'code'),3328);
  assert.equal(await x.send(url,'setResourceValue:forKey:error:',yes,await string('UnknownKey'),error),0);
  assert.equal(await x.send(x.read(error),'code'),3328);
  const missing=await x.send(x.cls('NSURL'),'fileURLWithPath:',await string('/Documents/missing'));
  assert.equal(await x.send(missing,'setResourceValue:forKey:error:',yes,key,error),0);
  assert.equal(await x.send(x.read(error),'code'),4);
});

test('NSURL path queries match Foundation for escaped separators, directories and dotfiles', async t => {
  const x=await fixture(t);
  const pool=x.f('_objc_autoreleasePoolPush');
  const string=value=>x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string(value));
  for(const [value,last,extension] of [
    ['file:///Documents/a%20b.dat','a b.dat','dat'],
    ['file:///Documents/folder/','folder',''],
    ['file:///','/',''],
    ['https://example.com/a%2Fb.tar.gz?x=1','b.tar.gz','gz'],
    ['file:///Documents/.hidden','.hidden',''],
  ]) {
    const url=await x.send(x.cls('NSURL'),'URLWithString:',await string(value));
    for(const [selector,expected] of [['lastPathComponent',last],['pathExtension',extension]]) {
      const result=await x.send(url,selector);
      assert.equal(readString(x.cpu,await x.send(result,'UTF8String')),expected);
    }
  }
  await x.f('_objc_autoreleasePoolPop',pool);
});

test('UIButton sizing awaits state refresh, uses logical image size and preserves its frame', async t => {
  const x=await fixture(t);
  const float=value=>{const view=new DataView(new ArrayBuffer(4));view.setFloat32(0,value,true);return view.getUint32(0,true);};
  const pool=x.f('_objc_autoreleasePoolPush');
  x.objc.attachCoreGraphics({pixels:()=>({width:64,height:32}),retain:()=>{},release:()=>{}});
  const image=await x.send(x.cls('UIImage'),'imageWithCGImage:scale:orientation:',1,float(2),0);
  const button=await x.send(x.cls('UIButton'),'buttonWithType:',0);
  await x.send(button,'setFrame:',float(4),float(8),float(90),float(60));
  await x.send(button,'setBackgroundImage:forState:',image,0);
  const result=x.heap.zero(16),frame=x.heap.zero(16);
  await x.f('_objc_msgSend_stret',result,button,x.sel('sizeThatFits:'),float(0),float(0));
  assert.deepEqual([x.read(result),x.read(result+4)],[float(32),float(16)]);
  await x.f('_objc_msgSend_stret',frame,button,x.sel('frame'));
  assert.deepEqual([0,4,8,12].map(offset=>x.read(frame+offset)),[4,8,90,60].map(float));
  await x.send(button,'sizeToFit');
  await x.f('_objc_msgSend_stret',frame,button,x.sel('frame'));
  assert.deepEqual([0,4,8,12].map(offset=>x.read(frame+offset)),[4,8,32,16].map(float));
  await x.f('_objc_autoreleasePoolPop',pool);
});

test('UIColor grayscale construction and alpha replacement preserve independent channels', async t => {
  const x=await fixture(t);
  const float=value=>{const view=new DataView(new ArrayBuffer(4));view.setFloat32(0,value,true);return view.getUint32(0,true);};
  const pool=x.f('_objc_autoreleasePoolPush');
  const color=await x.send(x.cls('UIColor'),'colorWithWhite:alpha:',float(.75),float(.5));
  const replacement=await x.send(color,'colorWithAlphaComponent:',float(.25));
  assert.deepEqual([4,8,12,16].map(offset=>x.read(color+offset)),[.75,.75,.75,.5].map(float));
  assert.deepEqual([4,8,12,16].map(offset=>x.read(replacement+offset)),[.75,.75,.75,.25].map(float));
  assert.equal(await x.send(color,'CGColor'),color);
  await x.f('_objc_autoreleasePoolPop',pool);
  assert.equal(x.heap.live.has(color),false);
  assert.equal(x.heap.live.has(replacement),false);
});

test('NSValue boxes pointers without owning their targets and exposes stable type bytes', async t => {
  const x=await fixture(t);
  const pool=x.f('_objc_autoreleasePoolPush');
  const target=await x.send(x.cls('NSObject'),'alloc');
  const value=await x.send(x.cls('NSValue'),'valueWithPointer:',target);
  const same=await x.send(x.cls('NSValue'),'valueWithPointer:',target);
  const unretained=await x.send(x.cls('NSValue'),'valueWithNonretainedObject:',target);
  assert.equal(await x.send(value,'pointerValue'),target);
  assert.equal(await x.send(unretained,'nonretainedObjectValue'),target);
  assert.equal(await x.send(target,'retainCount'),1);
  assert.equal(await x.send(value,'isEqualToValue:',same),1);
  assert.equal(await x.send(value,'isEqualToValue:',unretained),0);
  const type=await x.send(value,'objCType');
  assert.equal(readString(x.cpu,type),'^v');
  const output=x.heap.zero(4);
  await x.send(value,'getValue:',output);
  assert.equal(x.read(output),target);
  const number=await x.send(x.cls('NSNumber'),'numberWithInt:',3);
  assert.equal(await x.send(number,'isKindOfClass:',x.cls('NSValue')),1);
  await x.f('_objc_autoreleasePoolPop',pool);
  assert.equal(x.heap.live.has(value),false);
  assert.equal(x.heap.live.has(target),true);
  assert.equal(readString(x.cpu,type),'^v');
  await x.send(target,'release');
});


test('NSUserDefaults registers volatile fallbacks without overwriting saved settings',async t=>{
  const stored=new Map();
  vi.stubGlobal('localStorage',{getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value)});
  t.onTestFinished(()=>vi.unstubAllGlobals());
  const x=await fixture(t), preferences=await x.send(x.cls('NSUserDefaults'),'standardUserDefaults');
  const key=await x.send(x.cls('NSString'),'stringWithUTF8String:',x.heap.string('sound'));
  const enabled=await x.send(x.cls('NSNumber'),'numberWithBool:',1);
  const defaults=await x.send(x.cls('NSDictionary'),'dictionaryWithObject:forKey:',enabled,key);
  await x.send(preferences,'registerDefaults:',defaults);
  assert.equal(await x.send(preferences,'boolForKey:',key),1);
  assert.equal(stored.size,0);
  await x.send(preferences,'setBool:forKey:',0,key);
  await x.send(preferences,'registerDefaults:',defaults);
  assert.equal(await x.send(preferences,'boolForKey:',key),0);
  assert.deepEqual(JSON.parse([...stored.values()][0]),{sound:false});
  await x.send(preferences,'removeObjectForKey:',key);
  assert.equal(await x.send(preferences,'boolForKey:',key),1);
  assert.deepEqual(JSON.parse([...stored.values()][0]),{});
  const next=await fixture(t), restored=await next.send(next.cls('NSUserDefaults'),'standardUserDefaults');
  const restoredKey=await next.send(next.cls('NSString'),'stringWithUTF8String:',next.heap.string('sound'));
  assert.equal(await next.send(restored,'objectForKey:',restoredKey),0);
});


test('legacy and specialized Objective-C property ABIs preserve ownership and getter lifetime', async t => {
  const x = await fixture(t);
  const owner = x.heap.zero(12), offset = 4;
  const first = await x.send(x.cls('NSObject'), 'new');
  const second = await x.send(x.cls('NSObject'), 'new');
  await x.f('_objc_setProperty', owner, 0, offset, first, 1, 0);
  assert.equal(x.read(owner + offset), first);
  assert.equal(await x.send(first, 'retainCount'), 2);
  await x.f('_objc_setProperty', owner, 0, offset, first, 0, 0);
  assert.equal(await x.send(first, 'retainCount'), 2);
  await x.f('_objc_setProperty_nonatomic', owner, 0, second, offset);
  assert.equal(await x.send(first, 'retainCount'), 1);
  const pool = x.f('_objc_autoreleasePoolPush');
  assert.equal(x.f('_objc_getProperty', owner, 0, offset, 1), second);
  await x.f('_objc_setProperty_atomic', owner, 0, 0, offset);
  assert.equal(await x.send(second, 'retainCount'), 2);
  await x.f('_objc_autoreleasePoolPop', pool);
  assert.equal(await x.send(second, 'retainCount'), 1);
});

test('property copies dispatch zone-aware guest methods before replacing the old value', async t => {
  const calls = [];
  let copied;
  const x = await fixture(t, (pc, args) => { calls.push([pc, args]); return copied; });
  const cls = x.instance('Copyable', [['copyWithZone:', 0x6100], ['mutableCopyWithZone:', 0x6200]]);
  x.install({'__objc_classlist':[cls]});
  const original = await x.send(cls, 'alloc');
  const owner = x.heap.zero(12), offset = 4;
  copied = await x.send(x.cls('NSObject'), 'new');
  await x.f('_objc_setProperty', owner, 0, offset, original, 1, 1);
  assert.equal(x.read(owner + offset), copied);
  assert.equal(await x.send(copied, 'retainCount'), 1);
  const oldCopy = copied;
  copied = await x.send(x.cls('NSObject'), 'new');
  await x.f('_objc_setProperty', owner, 0, offset, original, 0, 2);
  assert.equal(x.read(owner + offset), copied);
  assert.equal(x.heap.live.has(oldCopy), false);
  assert.deepEqual(calls.map(([pc, args]) => [pc, args[0], args[2]]), [[0x6100, original, 0], [0x6200, original, 0]]);
  assert.equal(await x.send(original, 'retainCount'), 1);
});


test('zero-offset property access changes only isa without retaining or autoreleasing classes', async t => {
  const x = await fixture(t);
  const owner = x.heap.zero(8), cls = x.cls('NSObject');
  await x.f('_objc_setProperty', owner, 0, 0, cls, 1, 1);
  assert.equal(x.read(owner), cls);
  const pool = x.f('_objc_autoreleasePoolPush');
  assert.equal(x.f('_objc_getProperty', owner, 0, 0, 1), cls);
  await x.f('_objc_autoreleasePoolPop', pool);
  assert.equal(x.f('_objc_getProperty', 0, 0, 0, 1), 0);
});


test('UIKit exports local-notification launch key as a stable NSString data symbol',async t=>{
 const x=await fixture(t),name='_UIApplicationLaunchOptionsLocalNotificationKey';
 const symbol=x.objc.resolveData(name);
 assert.ok(symbol);assert.equal(x.objc.resolveData(name),symbol);
 const value=x.read(symbol);
 assert.equal(readString(x.cpu,await x.send(value,'UTF8String')),'UIApplicationLaunchOptionsLocalNotificationKey');
});

test('legacy movie notification imports are stable NSString objects',async t=>{
 const x=await fixture(t);
 for(const name of ['MPMoviePlayerPlaybackDidFinishNotification','MPMoviePlayerScalingModeDidChangeNotification','MPMoviePlayerLoadStateDidChangeNotification','MPMoviePlayerContentPreloadDidFinishNotification']){
  const symbol=x.objc.resolveData('_'+name);assert.ok(symbol);assert.equal(x.objc.resolveData('_'+name),symbol);
  const object=x.read(symbol);assert.equal(readString(x.cpu,await x.send(object,'UTF8String')),name);
 }
});
