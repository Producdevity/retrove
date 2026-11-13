import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {commonCrypto} from '../web/commoncrypto.mjs';

test('Darwin SHA-1 and all HMAC variants match native digests, including copied incremental contexts', () => {
  const bytes=new Uint8Array(90000);
  const cpu={read:(p,n)=>bytes.slice(p,p+n),write:(p,data)=>bytes.set(data,p)};
  const api=commonCrypto(cpu,{alloc:()=>1300});
  const call=(name,...args)=>api[name](i=>args[i]??0);
  const msg=Buffer.from(Array.from({length:65539},(_,i)=>i*31)), key=Buffer.from(Array.from({length:144},(_,i)=>i));
  bytes.set(key,2048);bytes.set(msg,4096);
  assert.equal(call('_CC_SHA1',4096,msg.length,0),1300);
  assert.deepEqual(Buffer.from(bytes.slice(1300,1320)),createHash('sha1').update(msg).digest());
  for (const [alg,name] of ['sha1','md5','sha256','sha384','sha512','sha224'].entries()) {
    const expected=createHmac(name,key).update(msg).digest();
    call('_CCHmac',alg,2048,key.length,4096,msg.length,1200);
    assert.deepEqual(Buffer.from(bytes.slice(1200,1200+expected.length)),expected);
    call('_CCHmacInit',0,alg,2048,key.length);
    call('_CCHmacUpdate',0,4096,11);
    bytes.copyWithin(400,0,384);
    call('_CCHmacUpdate',400,4107,msg.length-11); call('_CCHmacFinal',400,1200);
    assert.deepEqual(Buffer.from(bytes.slice(1200,1200+expected.length)),expected);
    call('_CCHmacFinal',0,1200);
    assert.deepEqual(Buffer.from(bytes.slice(1200,1200+expected.length)),createHmac(name,key).update(msg.subarray(0,11)).digest());
  }
});
