import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {crc32} from '../web/crc32.mjs';
import {decodeCgBI} from '../web/cgbi.mjs';

function chunk(type,data) {
  const body=Buffer.concat([Buffer.from(type),Buffer.from(data)]),b=Buffer.alloc(body.length+8);
  b.writeUInt32BE(data.length);b.set(body,4);b.writeUInt32BE(crc32(0,body),4+body.length);return b;
}
function image(raw,w,h,interlace=0) {
  const header=Buffer.alloc(13);header.writeUInt32BE(w);header.writeUInt32BE(h,4);
  header.set([8,6,0,0,interlace],8);
  const dat=deflateRawSync(Buffer.from(raw));
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('CgBI',[80,0,32,6]),chunk('IHDR',header),
    chunk('IDAT',dat.subarray(0,4)),chunk('IDAT',dat.subarray(4)),chunk('IEND',[])]);
}

test('CgBI PNG supports split raw-DEFLATE chunks, row filters and premultiplied BGRA',()=>{
  const png=image([1,0,0,128,128, 0,255,128,127, 2,255,0,128,127, 0,1,0,1],2,2);
  const {width,height,rgba}=decodeCgBI(png);
  assert.equal(width,2);assert.equal(height,2);
  assert.deepEqual([...rgba],[255,0,0,128,0,255,0,255,0,0,255,255,0,0,0,0]);
  png[20]^=1;assert.throws(()=>decodeCgBI(png),/CRC/);
});
test('CgBI reconstructs Adam7 passes and leaves normal PNG input to the browser',()=>{
  const png=image([0,0,0,255,255, 0,0,255,0,255, 0,255,0,0,255,255,255,255,255],2,2,1);
  assert.deepEqual([...decodeCgBI(png).rgba],[255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]);
  assert.equal(decodeCgBI(new Uint8Array(20)),null);
});
