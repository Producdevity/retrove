import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {openIPA} from '../web/ipa.mjs';
import {runGuest} from '../web/runtime.mjs';

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
