import {ZStream,inflateInit2,inflate,inflateEnd} from './vendor/pako-zlib.mjs';
import {crc32} from '../src/runtime/formats/crc32.ts';

const IHDR=0x49484452, IDAT=0x49444154, IEND=0x49454e44, CGBI=0x43674249;
const adam7=[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]];

function paeth(a,b,c) {
  const p=a+b-c, x=Math.abs(p-a), y=Math.abs(p-b), z=Math.abs(p-c);
  return x<=y&&x<=z ? a : y<=z ? b : c;
}

export function decodeCgBI(bytes) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length<20 || view.getUint32(0)!==0x89504e47 || view.getUint32(4)!==0x0d0a1a0a || view.getUint32(12)!==CGBI)return null;
  let width=0,height=0,channels=0,interlaced=false,end=false;
  const parts=[];
  for(let i=8;i<bytes.length;) {
    if(i+12>bytes.length)throw Error('Truncated CgBI chunk header');
    const n=view.getUint32(i),type=view.getUint32(i+4),pos=i+8;
    if(n>bytes.length-pos-4)throw Error('Truncated CgBI image chunk');
    if(crc32(0,bytes.subarray(i+4,pos+n))!==view.getUint32(pos+n))throw Error('CgBI image CRC mismatch');
    if(type===IHDR) {
      if(n!==13)throw Error('Invalid CgBI image header');
      width=view.getUint32(pos);height=view.getUint32(pos+4);
      channels=bytes[pos+9]===2 ? 3 : bytes[pos+9]===6 ? 4 : 0;
      if(!width||!height||width*height>0x2000000||!channels||bytes[pos+8]!==8||bytes[pos+10]||bytes[pos+11]||bytes[pos+12]>1)
        throw Error('Unsupported CgBI bitmap layout');
      interlaced=!!bytes[pos+12];
    } else if(type===IDAT)parts.push(bytes.subarray(pos,pos+n));
    else if(type===IEND){end=true;break;}
    i=pos+n+4;
  }
  if(!end||!channels||!parts.length)throw Error('Incomplete CgBI image');
  const passes=(interlaced?adam7:[[0,0,1,1]]).map(([x,y,dx,dy])=>({x,y,dx,dy,
    w:Math.max(0,Math.ceil((width-x)/dx)),h:Math.max(0,Math.ceil((height-y)/dy))})).filter(p=>p.w&&p.h);
  const size=passes.reduce((n,p)=>n+p.h*(1+p.w*channels),0);
  const scanlines=new Uint8Array(size), stream=new ZStream();
  if(inflateInit2(stream,-15)!==0)throw Error('Could not initialize CgBI decompression');
  stream.output=scanlines;stream.avail_out=size;
  let status;
  try {
    for(const input of parts) {
      stream.input=input;stream.next_in=0;stream.avail_in=input.length;
      status=inflate(stream,0);
      if(status===1)break;
      if(status!==0)throw Error('Invalid compressed CgBI image');
    }
    if(status!==1||stream.total_out!==size)throw Error('CgBI scanline length mismatch');
  } finally {inflateEnd(stream);}
  const rgba=new Uint8ClampedArray(4*width*height);
  let cursor=0;
  for(const pass of passes) {
    const rowBytes=pass.w*channels;
    let prev=null;
    for(let y=0;y<pass.h;y++) {
      const filter=scanlines[cursor++],row=scanlines.subarray(cursor,cursor+rowBytes);
      if(filter>4)throw Error('Invalid CgBI row filter');
      cursor+=rowBytes;
      for(let i=0;i<row.length;i++) {
        const left=i<channels?0:row[i-channels], up=prev?.[i]??0, corner= i<channels?0:(prev?.[i-channels]??0);
        row[i]+=filter===1?left:filter===2?up:filter===3?(left+up)>>>1:filter===4?paeth(left,up,corner):0;
      }
      for(let x=0;x<pass.w;x++) {
        const i=x*channels,p=4*((pass.y+y*pass.dy)*width+pass.x+x*pass.dx);
        const alpha=channels===4?row[i+3]:255,scale=alpha?255/alpha:0;
        rgba[p]=row[i+2]*scale;rgba[p+1]=row[i+1]*scale;rgba[p+2]=row[i]*scale;rgba[p+3]=alpha;
      }
      prev=row;
    }
  }
  return {width,height,rgba};
}
