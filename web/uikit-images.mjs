import {ImageViewAnimations} from "../src/runtime/ios/uikit/image/animation.ts";
import {drawLayerBackground,drawLayerBorder} from "../src/runtime/ios/uikit/layer-colors.ts";
import {imageFile} from "../src/runtime/ios/uikit/image/files.ts";
import {installImageInitializers} from "../src/runtime/ios/uikit/image/initializers.ts";
import {capSlices,stretchableCaps} from "../src/runtime/ios/uikit/image/caps.ts";
import {decodeCgBI} from './cgbi.mjs';

const transforms = [
  [1,0,0,1,0,0], [-1,0,0,-1,1,1], [0,-1,1,0,0,1], [0,1,-1,0,1,0],
  [-1,0,0,1,1,0], [1,0,0,-1,0,1], [0,1,1,0,0,0], [0,-1,-1,0,1,1],
];

export function uiImages({hostClass,method,names,alloc,destroy,autorelease,retain,releaseFromHost,
  text,write,ipa,readFile,mediaHost,data,setFrame,bits,float,lookup,read,send,getCoreGraphics,diagnostic,convertPoint,displayPoint,displayBounds,hasHostDrawing,drawHost,clip,uiColor,uiPattern,glLayer,movieVideo,elements}) {
  hostClass('UIImage','NSObject');
  // Compiled nibs archive image references as this UIImage subclass; its UIImage initWithCoder: resolves them.
  hostClass('UIImageNibPlaceholder','UIImage');
  hostClass('UIImageView','UIView');
  const imageAnimations=new ImageViewAnimations({method,retain,release:releaseFromHost,elements,now:()=>performance.now(),changed:p=>{data(p).needsDisplay=true;}});
  imageAnimations.install();
  const images=new Map(), nodes=new Map();
  const document=mediaHost?.ownerDocument;
  const cg=()=>getCoreGraphics?.();
  function pixelCanvas(width,height) {
    if(!document) throw Error('UIKit image drawing requires a browser canvas');
    const canvas=document.createElement('canvas');
    canvas.width=width; canvas.height=height;
    return canvas;
  }
  function makeImage(klass, fields, w, h, scale, orientation=0) {
    if(!(scale>0) || orientation>=transforms.length) return 0;
    const sideways=orientation===2||orientation===3||orientation>=6;
    const p=alloc(klass);
    images.set(p,{...fields,width:(sideways?h:w)/scale,height:(sideways?w:h)/scale,scale,orientation});
    return autorelease(p);
  }
  async function load(path, named) {
    const file=await imageFile({ipa,contents:readFile},path,named);
    if(!file)return 0;
    const {bytes,scale,path:entry}=file;
    let optimized;
    try {optimized=decodeCgBI(bytes);}
    catch(error){diagnostic?.('warn','graphics','Failed to decode optimized UIKit image',{path:entry,error:String(error)});return 0;}
    if(optimized) {
      const {width,height,rgba}=optimized;
      const canvas=pixelCanvas(width,height),ctx=canvas.getContext('2d'),buffer=ctx.createImageData(width,height);
      buffer.data.set(rgba);ctx.putImageData(buffer,0,0);
      return makeImage(names.get('UIImage'),{source:canvas},width,height,scale);
    }
    const img=document?.createElement('img');
    if(!img)throw Error('UIImage decoding requires a browser image decoder');
    const resource=URL.createObjectURL(new Blob([bytes]));
    try {
      img.src=resource;
      await img.decode();
      return makeImage(names.get('UIImage'),{source:img},img.naturalWidth,img.naturalHeight,scale);
    } catch(error){diagnostic?.('warn','graphics','Failed to decode UIKit image',{path:entry,error:String(error)});return 0;}
    finally {URL.revokeObjectURL(resource);}
  }
  function fromCG(cls, pointer, scale, orientation) {
    const content=cg()?.pixels(pointer);
    if(!content)return 0;
    const obj=makeImage(cls,{pointer},content.width,content.height,scale,orientation);
    if(obj)cg().retain(pointer);
    return obj;
  }
  function source(image) {
    if(!image.source) {
      const {width,height,rgba}=cg().pixels(image.pointer);
      const canvas=pixelCanvas(width,height), ctx=canvas.getContext('2d');
      const buffer=ctx.createImageData(width,height);
      buffer.data.set(rgba);ctx.putImageData(buffer,0,0);
      image.source=canvas;
    }
    return image.source;
  }
  function tile(image,ctx,[x,y,width,height]) {
    const pixels=source(image),fill=image.width&&image.height?ctx.createPattern(pixels,'repeat'):null;
    if(!fill)return;
    fill.setTransform(new DOMMatrix().scale(image.width/pixels.width,image.height/pixels.height));
    ctx.save();ctx.fillStyle=fill;
    try {ctx.fillRect(x,y,width,height);}
    finally {ctx.restore();}
  }
  function draw(image,ctx,x,y,width,height) {
    if(!image||!ctx||!width||!height)return;
    if(image.caps&&!image.orientation) {
      const pixels=source(image),kx=(pixels.naturalWidth??pixels.width)/image.width,ky=(pixels.naturalHeight??pixels.height)/image.height;
      for(const [sx,sy,sw,sh,dx,dy,dw,dh] of capSlices(image.width,image.height,image.caps,[x,y,width,height]))
        ctx.drawImage(pixels,sx*kx,sy*ky,sw*kx,sh*ky,dx,dy,dw,dh);
      return;
    }
    ctx.save(); ctx.translate(x,y); ctx.scale(width,height);
    ctx.transform(...transforms[image.orientation]);
    try {ctx.drawImage(source(image),0,0,1,1);}
    finally {ctx.restore();}
  }
  installImageInitializers({method,retain,release:releaseFromHost,imageClass:()=>names.get('UIImage'),send});
  method('UIImage',true,'imageNamed:',(_,a)=>a(0)?load(text(a(0)),true):0);
  method('UIImage',true,'imageWithContentsOfFile:',(_,a)=>a(0)?load(text(a(0)),false):0);
  method('UIImage',true,'imageWithCGImage:',(cls,a)=>fromCG(cls,a(0),1,0));
  method('UIImage',true,'imageWithCGImage:scale:orientation:',(cls,a)=>fromCG(cls,a(0),float(a(1)),a(2)));
  method('UIImage',false,'CGImage',s=>{
    const image=images.get(s);
    if(!image||!cg())return 0;
    if(!image.pointer) {
      const img=source(image), width=img.naturalWidth??img.width, height=img.naturalHeight??img.height;
      const ctx=pixelCanvas(width,height).getContext('2d');
      ctx.drawImage(img,0,0);image.pointer=cg().createImage(width,height,ctx.getImageData(0,0,width,height).data);
    }
    return image.pointer;
  });
  method('UIImage',false,'dealloc',async s=>{
    await cg()?.release(images.get(s)?.pointer);images.delete(s);
    const base=lookup(names.get('NSObject'),'dealloc');
    if(typeof base==='function')await base(s);else destroy(s);
  });
  method('UIImage',false,'scale',s=>bits(images.get(s)?.scale??1));
  method('UIImage',false,'imageOrientation',s=>images.get(s)?.orientation??0);
  method('UIImage',false,'drawInRect:',(s,a)=>{cg()?.drawCurrent(c=>draw(images.get(s),c,...[0,1,2,3].map(i=>float(a(i)))));});
  method('UIImage',false,'drawAsPatternInRect:',(s,a)=>{const img=images.get(s);if(img)cg()?.drawCurrent(c=>tile(img,c,[0,1,2,3].map(i=>float(a(i)))));});
  method('UIImage',false,'drawAtPoint:',(s,a)=>{
    const img=images.get(s);
    if(img)cg()?.drawCurrent(c=>draw(img,c,float(a(0)),float(a(1)),img.width,img.height));
  });
  const size=(s,_,dest)=>{write(dest,bits(images.get(s)?.width??0));write(dest+4,bits(images.get(s)?.height??0));};
  size.stret=true;method('UIImage',false,'size',size);
  method('UIImage',false,'stretchableImageWithLeftCapWidth:topCapHeight:',(s,a)=>{
    const image=images.get(s);
    if(!image)return 0;
    const p=alloc(read(s));
    images.set(p,{...image,caps:stretchableCaps(image.width,image.height,a(0)|0,a(1)|0)});
    if(image.pointer)cg()?.retain(image.pointer);
    return autorelease(p);
  });
  method('UIImage',false,'leftCapWidth',s=>images.get(s)?.caps?.left??0);
  method('UIImage',false,'topCapHeight',s=>images.get(s)?.caps?.top??0);
  async function setImage(s,p,key='image') {
    const view=data(s),old=view[key];view[key]=retain(p);view.needsDisplay=true;
    if(old)await releaseFromHost(old);
  }
  method('UIImageView',false,'image',s=>data(s).image??0);
  method('UIImageView',false,'setImage:',(s,a)=>setImage(s,a(0)));
  method('UIImageView',false,'highlightedImage',s=>data(s).highlightedImage??0);
  method('UIImageView',false,'setHighlightedImage:',(s,a)=>setImage(s,a(0),'highlightedImage'));
  method('UIImageView',false,'isHighlighted',s=>Number(!!data(s).highlighted));
  method('UIImageView',false,'setHighlighted:',(s,a)=>{const v=data(s);v.highlighted=!!a(0);v.needsDisplay=true;});
  for(const n of ['initWithImage:','initWithImage:highlightedImage:'])method('UIImageView',false,n,async(s,a)=>{
    const img=a(0),d=images.get(img);setFrame(s,[0,0,d?.width??0,d?.height??0]);await setImage(s,img);
    if(n==='initWithImage:highlightedImage:')await setImage(s,a(1),'highlightedImage');
    return s;
  });
  method('UIView',false,'drawRect:',()=>{});
  function imageRect(image,mode,[x,y,w,h]) {
    if(!mode||mode===3)return [x,y,w,h];
    let iw=image.width,ih=image.height;
    if(mode===1||mode===2) {
      const scale=(mode===1?Math.min:Math.max)(w/iw,h/ih);
      iw*=scale;ih*=scale;
    }
    const left=[7,9,11].includes(mode)?0:[8,10,12].includes(mode)?1:0.5;
    const top=[5,9,10].includes(mode)?0:[6,11,12].includes(mode)?1:0.5;
    return [x+(w-iw)*left,y+(h-ih)*top,iw,ih];
  }
  async function render(window) {
    if(!document)return;
    const shown=new Set(), root=window&&data(window);
    const screen=window&&(displayBounds?.(window)??root?.bounds), w=screen?.[2], h=screen?.[3];
    const toDisplay=displayPoint??convertPoint;
    const hostBounds={width:mediaHost.offsetWidth,height:mediaHost.offsetHeight};
    const aspect=hostBounds.width&&hostBounds.height && w&&h ? (hostBounds.height/h)/(hostBounds.width/w) : 1;
    const now=performance.now();
    let order=1,glOrder=0;
    const active=t=>t&&now<t.start+(t.duration+t.delay)*1000?t:null;
    function transitions(names,t) {return t?names.map(n=>n+' '+t.duration+'s '+t.curve+' '+t.delay+'s'):[];}
    async function visit(view,x,y,alpha,opacityTiming,layoutTiming) {
      const state=data(view);
      alpha*=state.alpha;
      opacityTiming=active(state.opacityAnimation)??opacityTiming;
      layoutTiming=active(state.layoutAnimation)??layoutTiming;
      if(state.hidden||(alpha<=0&&!opacityTiming))return;
      const image=images.get(imageAnimations.frame(view)||(state.highlighted&&state.highlightedImage)||state.image), layerContent=state.contents&&cg()?.pixels(state.contents), custom=typeof lookup(read(view),'drawRect:')==='number';
      const hostDrawing=hasHostDrawing?.(view),background=state.backgroundColor?uiColor?.(state.backgroundColor):undefined;
      const pattern=state.backgroundColor?images.get(uiPattern?.(state.backgroundColor)):undefined;
      const colored=background||pattern||state.layerBackgroundColor||state.borderColor;
      const [bx,by,vw,vh]=state.bounds;
      if(vw>0&&vh>0&&(image||custom||hostDrawing||layerContent||colored)) {
        let node=nodes.get(view);
        if(!node) {
          node=pixelCanvas(1,1);
          node.style.cssText='position:absolute;pointer-events:none;background:transparent;transform-origin:0 0';
          mediaHost.append(node);nodes.set(view,node);state.needsDisplay=true;
        }
        shown.add(view);
        const z=order++;
        const scale=state.contentScaleFactor?float(state.contentScaleFactor):1;
        const px=Math.max(1,Math.ceil(vw*scale)),py=Math.max(1,Math.ceil(vh*scale));
        if(node.width!==px||node.height!==py){node.width=px;node.height=py;state.needsDisplay=true;}
        let matrix='';
        if(toDisplay) {
          const p=toDisplay([bx,by],view,window),qx=toDisplay([bx+1,by],view,window),qy=toDisplay([bx,by+1],view,window);
          x=p[0]-screen[0];y=p[1]-screen[1];
          matrix='matrix('+[qx[0]-p[0],(qx[1]-p[1])*aspect,(qy[0]-p[0])/aspect,qy[1]-p[1],0,0].join(',')+')';
        }
        const transition=[...transitions(['opacity'],opacityTiming),...transitions(['transform','width','height','left','top'],layoutTiming)].join(',');
        Object.assign(node.style,{clipPath:clip?.(view)??'none',transition,left:100*x/w+'%',top:100*y/h+'%',width:100*vw/w+'%',height:100*vh/h+'%',transform:matrix,opacity:String(alpha*(state.imageAdjustment?.opacity??1)),filter:state.imageAdjustment?'brightness('+state.imageAdjustment.brightness+')':'',zIndex:String(z)});
        if(state.needsDisplay) {
          state.needsDisplay=false;
          const ctx=node.getContext('2d');
          ctx.setTransform(px/vw,0,0,py/vh,-bx*px/vw,-by*py/vh);
          if(state.clearsContextBeforeDrawing!==0)ctx.clearRect(bx,by,vw,vh);
          if(colored)drawLayerBackground(ctx,state,p=>cg()?.colors.rgba(p),background);
          if(pattern&&!state.layerBackgroundColor)tile(pattern,ctx,state.bounds);
          if(image)draw(image,ctx,...imageRect(image,state.contentMode,state.bounds));
          if(layerContent) {
            const buffer=ctx.createImageData(layerContent.width,layerContent.height);buffer.data.set(layerContent.rgba);
            const layerCanvas=pixelCanvas(layerContent.width,layerContent.height);layerCanvas.getContext('2d').putImageData(buffer,0,0);
            const scale=state.contentsScale?float(state.contentsScale):1;
            ctx.drawImage(layerCanvas,...imageRect({width:layerContent.width/scale,height:layerContent.height/scale},state.contentMode,state.bounds));
          }
          if(hostDrawing)await drawHost(view,ctx);
          if(custom&&cg())await cg().withContext(ctx,()=>send(view,'drawRect:',state.bounds.map(bits)));
          if(state.borderColor)drawLayerBorder(ctx,state,p=>cg()?.colors.rgba(p));
        }
      }
      // A movie player's video draws as its view's content, above the view and below its subviews.
      const video=movieVideo?.(view);
      if(video&&vw>0&&vh>0){
        let vx=x,vy=y,matrix='';
        if(toDisplay){
          const p=toDisplay([bx,by],view,window),qx=toDisplay([bx+1,by],view,window),qy=toDisplay([bx,by+1],view,window);
          vx=p[0]-screen[0];vy=p[1]-screen[1];
          matrix='matrix('+[qx[0]-p[0],(qx[1]-p[1])*aspect,(qy[0]-p[0])/aspect,qy[1]-p[1],0,0].join(',')+')';
        }
        Object.assign(video.style,{position:'absolute',transformOrigin:'0 0',clipPath:clip?.(view)??'none',left:100*vx/w+'%',top:100*vy/h+'%',width:100*vw/w+'%',height:100*vh/h+'%',transform:matrix,opacity:String(alpha),zIndex:String(order++)});
      }
      // GL content sits in the view order at its EAGL layer, so views behind it stay behind the game.
      if(state.layer&&glLayer?.(state.layer))glOrder=order++;
      if(state.layer)await visit(state.layer,x,y,alpha,opacityTiming,layoutTiming);
      for(const child of [...state.children].sort((a,b)=>(data(a).zPosition??0)-(data(b).zPosition??0))) {
        const f=data(child).frame;
        await visit(child,x+f[0]-bx,y+f[1]-by,alpha,opacityTiming,layoutTiming);
      }
    }
    if(w&&h)await visit(window,0,0,1);
    const graphics=mediaHost.querySelector('canvas[data-graphics]');
    if(graphics)graphics.style.zIndex=glOrder?String(glOrder):'';
    for(const [view,node] of nodes)if(!shown.has(view)){node.remove();nodes.delete(view);}
  }
  function close() {for(const n of nodes.values())n.remove();nodes.clear();images.clear();}
  function removeView(view) {nodes.get(view)?.remove();nodes.delete(view);}
  return {render,close,removeView,size:p=>[images.get(p)?.width??0,images.get(p)?.height??0],drawImage:(p,ctx,x,y,width,height)=>draw(images.get(p),ctx,x,y,width,height)};
}
