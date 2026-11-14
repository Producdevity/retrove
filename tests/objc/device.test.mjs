import {test,vi} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {readString} from '../../web/memory.mjs';

test('virtual vendor identity persists across launches and provides the documented iOS 7 legacy form',async t=>{
  const stored=new Map();
  vi.stubGlobal('localStorage',{getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value)});
  t.onTestFinished(()=>vi.unstubAllGlobals());
  async function identity(x){
    const device=await x.send(x.cls('UIDevice'),'currentDevice');
    const vendor=await x.send(device,'identifierForVendor');
    const value=async p=>readString(x.cpu,await x.send(p,'UTF8String'));
    return {vendor:await value(await x.send(vendor,'UUIDString')),legacy:await value(await x.send(device,'uniqueIdentifier'))};
  }
  const first=await identity(await fixture(t)),second=await identity(await fixture(t));
  assert.deepEqual(second,first);
  assert.match(first.legacy,/^FFFFFFFF[0-9A-F]{32}$/);
  assert.equal(first.legacy,'FFFFFFFF'+first.vendor.replaceAll('-',''));
  assert.equal(stored.get('bioshock.preferences.com.test.fixture.vendor-id'),first.vendor);
});
