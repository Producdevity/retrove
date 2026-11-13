import {coreGraphics} from '../web/coregraphics.mjs';
import {uiImages} from '../web/uikit-images.mjs';

export async function renderQuartz() {
  const args=(...words)=>i=>words[i]??0;
  const bgra=Uint8Array.of(0,0,255,255,0,255,0,255);
  let next=1024,released=0,draws=0;
  const cg=coreGraphics({read:(p,n)=>bgra.slice(p,p+n)}, {zero:()=>++next,free(){}}, {
    retainObject(){},releaseObject(){released++;},funcs:{_CFDataGetLength:()=>8,_CFDataGetBytePtr:()=>0}});
  const f=cg.funcs,space=f._CGColorSpaceCreateDeviceRGB(),provider=f._CGDataProviderCreateWithCFData(args(5));
  const image=f._CGImageCreate(args(2,1,8,32,8,space,0x2002,provider,0,1,0));
  const host=document.createElement('div');document.body.append(host);
  const methods=new Map(),key=(c,s,n)=>[c,Number(s),n].join('~');
  const view=(w,h,children=[])=>({bounds:[0,0,w,h],frame:[0,0,w,h],alpha:1,children});
  const views=new Map([[1,view(8,8,[2,3])],[2,view(2,1)],[3,view(8,8)]]);
  const scratch=new DataView(new ArrayBuffer(4));
  const bits=n=>{scratch.setFloat32(0,n,true);return scratch.getUint32(0,true);};
  const api=uiImages({hostClass(){},method:(cls,meta,name,fn)=>methods.set(key(cls,meta,name),fn),
    names:new Map([['UIImage',5]]),alloc:()=>++next,destroy(){},retain:p=>p,autorelease:p=>p,releaseFromHost(){},
    bits,data:p=>views.get(p),getCoreGraphics:()=>cg,read:p=>p,mediaHost:host,
    lookup:(cls,name)=>cls===3&&name==='drawRect:'?1:null,
    send:async()=>{
      draws++;
      const ctx=f._UIGraphicsGetCurrentContext();
      cg.setColor([0,0,1,1],true,false);
      f._CGContextSetAllowsAntialiasing(args(ctx,0));
      f._CGContextAddArc(args(ctx,bits(4),bits(4),bits(2.5),bits(0),bits(2*Math.PI),0));
      f._CGContextDrawPath(args(ctx,0));
    }});
  const ui=methods.get(key('UIImage',true,'imageWithCGImage:'))(5,args(image));
  try {
    await f._CGImageRelease(args(image));await f._CGColorSpaceRelease(args(space));await f._CGDataProviderRelease(args(provider));
    await methods.get(key('UIImageView',false,'setImage:'))(2,args(ui));
    await api.render(1);await api.render(1);
    views.get(3).needsDisplay=true;await api.render(1);
    const [sprite,path]=host.children;
    const imageBytes=[...sprite.getContext('2d').getImageData(0,0,2,1).data];
    const shape=path.getContext('2d').getImageData(0,0,8,8).data;
    for(let y=0;y<8;y++)for(let x=0;x<8;x++) {
      const opacity=shape[(y*8+x)*4+3];
      const expected=(x+.5-4)**2+(y+.5-4)**2<2.5**2 ? 255 : 0;
      if(opacity!==expected)throw Error('Unexpected Quartz circle edge '+[x,y,opacity,expected].join(','));
    }
    if(imageBytes.join(',')!=='255,0,0,255,0,255,0,255'||draws!==2)throw Error('UIKit drawing mismatch');
    await methods.get(key('UIImage',false,'dealloc'))(ui);
    if(released!==1)throw Error('CGDataProvider lifetime mismatch');
    return imageBytes;
  } finally {api.close();host.remove();}
}
