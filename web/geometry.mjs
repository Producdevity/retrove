import {affineImports} from "../src/runtime/graphics/core-graphics/affine.ts";
// ARMv7 public CoreGraphics functions use the base AAPCS float register layout.
export function geometry(cpu, heap) {
  const scratch=new DataView(new ArrayBuffer(4));
  const decode=n=>{scratch.setUint32(0,n,true);return scratch.getFloat32(0,true);};
  const encode=n=>{scratch.setFloat32(0,n,true);return scratch.getUint32(0,true);};
  const args=(a,n,off=0)=>Array.from({length:n},(_,i)=>decode(a(i+off)));
  const store=(dest,values)=>{
    const d=new DataView(new ArrayBuffer(values.length*4));
    values.forEach((n,i)=>d.setFloat32(i*4,n,true));cpu.write(dest,new Uint8Array(d.buffer));return dest;
  };
  const constants=new Map();
  for(const [name,values] of [['_CGRectZero',[0,0,0,0]],['_CGSizeZero',[0,0]],['_CGRectNull',[Infinity,Infinity,0,0]],
    ['_CGAffineTransformIdentity',[1,0,0,1,0,0]],['_UIWindowLevelAlert',[2000]]])
    constants.set(name,store(heap.zero(values.length*4),values));
  const edges=([x,y,w,h])=>[Math.min(x,x+w),Math.min(y,y+h),Math.max(x,x+w),Math.max(y,y+h)];
  const funcs={
    ...affineImports(),
    _CGRectIsNull:a=>Number(decode(a(0))===Infinity || decode(a(1))===Infinity),
    _CGRectIsEmpty:a=>Number(decode(a(2))===0 || decode(a(3))===0 || decode(a(0))===Infinity),
    _CGRectIntersectsRect:a=>{
      const l=edges(args(a,4)),r=edges(args(a,4,4));
      return Number(Math.max(l[0],r[0])<Math.min(l[2],r[2]) && Math.max(l[1],r[1])<Math.min(l[3],r[3]));
    },
    _CGRectIntegral:a=>{
      const [x,y,r,b]=edges(args(a,4,1));
      if(x===Infinity||y===Infinity)return store(a(0),[Infinity,Infinity,0,0]);
      return store(a(0),[Math.floor(x),Math.floor(y),Math.ceil(r)-Math.floor(x),Math.ceil(b)-Math.floor(y)]);
    },
    _CGRectOffset:a=>{
      const [x,y,w,h,dx,dy]=args(a,6,1);return store(a(0),[x+dx,y+dy,w,h]);
    },
    _CGAffineTransformMakeRotation:a=>{const rad=decode(a(1)),s=Math.sin(rad),c=Math.cos(rad);return store(a(0),[c,s,-s,c,0,0]);},
    _CGAffineTransformMakeScale:a=>store(a(0),[decode(a(1)),0,0,decode(a(2)),0,0]),
    _CGAffineTransformTranslate:a=>{
      const [xx,xy,yx,yy,tx,ty,x,y]=args(a,8,1);
      return store(a(0),[xx,xy,yx,yy,tx+xx*x+yx*y,ty+xy*x+yy*y]);
    },
  };
  for(const [key,f] of Object.entries({Width:r=>r[2]-r[0],Height:r=>r[3]-r[1],MinY:r=>r[1],
    MaxX:r=>r[2],MidX:r=>(r[0]+r[2])/2,MidY:r=>(r[1]+r[3])/2}))
    funcs['_CGRectGet'+key]=a=>encode(f(edges(args(a,4))));
  return {constants,funcs};
}
