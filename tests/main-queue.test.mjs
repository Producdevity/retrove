import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {openIPA} from '../src/runtime/ios/package/ipa.ts';
import {runGuest} from '../src/runtime/ios/runtime/runtime.ts';

test('main-queue blocks wait for UIKit even when a constructor or a delegate dispatch_once yields', async()=>{
  const file=await readFile(new URL('./fixtures/main-queue.ipa',import.meta.url));
  const ipa=await openIPA(new Blob([file]));
  const phases=[];
  const result=await runGuest(ipa,{signal:AbortSignal.timeout(4000),diagnostic:(level,area,message)=>{
    if(area==='guest'&&message.startsWith('UIKit'))phases.push(message);
  }});
  assert.deepEqual(phases,['UIKit application launch','UIKit delegate launch callbacks','UIKit event loop']);
  assert.equal(result.exitStatus,0);
});
