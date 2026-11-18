import {installLayerColors} from "../src/runtime/ios/uikit/layer-colors.ts";
import {installLayerProperties} from "../src/runtime/ios/uikit/layer-properties.ts";
import {installAnimationGroups} from "../src/runtime/ios/uikit/animation/groups.ts";
import {installBasicAnimations} from "../src/runtime/ios/uikit/animation/basic.ts";
import {installTransitions} from "../src/runtime/ios/uikit/animation/transitions.ts";
import {installTransactions} from "../src/runtime/ios/uikit/animation/transactions.ts";
import {drawScrollIndicators} from "../src/runtime/ios/uikit/scroll/indicators.ts";
import {installScrollViews} from "../src/runtime/ios/uikit/scroll/bindings.ts";
import {ScrollTiming} from "../src/runtime/ios/uikit/scroll/state.ts";
import {viewClip} from "../src/runtime/ios/uikit/view/clipping.ts";
import {WebViews} from "../src/runtime/ios/uikit/web-view.ts";
import {installTextFields} from "../src/runtime/ios/uikit/text-field/bindings.ts";
import {installLayerFactory,installLayerTree} from "../src/runtime/ios/uikit/layer.ts";
import {installTouchViewProperties,touchConflict} from "../src/runtime/ios/uikit/touch/view-policy.ts";
import {installViewOrdering} from "../src/runtime/ios/uikit/view/hierarchy.ts";
import {installControllerNibs} from "../src/runtime/ios/uikit/nib/controllers.ts";
import {installNibViews} from "../src/runtime/ios/uikit/nib/views.ts";
import {DataField} from "../src/runtime/ios/foundation/data.ts";
import {installAlerts} from "../src/runtime/ios/uikit/alerts/bindings.ts";
import {installPickers} from "../src/runtime/ios/uikit/picker/bindings.ts";
import {PointerPhase, PointerQueue, TouchPhase} from '../src/runtime/ios/uikit/touch/pointer-queue.ts';
import {InputMetrics, DropReason} from '../src/runtime/diagnostics/input-metrics.ts';
import {installColors} from '../src/runtime/ios/uikit/colors.ts';
import {installControls} from '../src/runtime/ios/uikit/control-host.ts';
import {installButtons} from '../src/runtime/ios/uikit/button-host.ts';
import {installPageControls} from '../src/runtime/ios/uikit/page-control/bindings.ts';
import {installActivityIndicators} from '../src/runtime/ios/uikit/activity-indicator.ts';
import {installSegmentedControls} from '../src/runtime/ios/uikit/segmented-control/bindings.ts';
import {installSwitches} from '../src/runtime/ios/uikit/switch.ts';
import {installLabels} from '../src/runtime/ios/uikit/label-host.ts';
import {installToolbars} from '../src/runtime/ios/uikit/toolbar/bindings.ts';
import {installNavigation} from '../src/runtime/ios/uikit/navigation/controller.ts';
import {installTables} from '../src/runtime/ios/uikit/table/bindings.ts';
import {installIndexPaths} from '../src/runtime/ios/foundation/index-paths.ts';
import {phoneScreen} from '../src/runtime/ios/uikit/screen.ts';
import {uiImages} from './uikit-images.mjs';

const floatBits = new DataView(new ArrayBuffer(8));
const float = bits => { floatBits.setUint32(0, bits, true); return floatBits.getFloat32(0, true); };
const bits = n => { floatBits.setFloat32(0, n, true); return floatBits.getUint32(0, true); };
const double = n => { floatBits.setFloat64(0, n, true); return floatBits.getBigUint64(0, true); };
const phases = {[PointerPhase.Down]: [TouchPhase.Began, 'touchesBegan:withEvent:'], [PointerPhase.Move]: [TouchPhase.Moved, 'touchesMoved:withEvent:'],
  [PointerPhase.Up]: [TouchPhase.Ended, 'touchesEnded:withEvent:'], [PointerPhase.Cancel]: [TouchPhase.Cancelled, 'touchesCancelled:withEvent:']};

export function touchUIKit({hostClass, method, names, alloc, destroy, autorelease, retain, releaseFromHost, send, lookup,
  selector, selectorName, className, read, write, readBytes, graphics, signal, text, string, ipa, mediaHost, getCoreGraphics, getOrientation, diagnostic, loadNib, readFile, currentThread, movieVideo}) {
  for (const [name, parent] of [['UIScreen','NSObject'], ['UIView','UIResponder'], ['UIWindow','UIView'],
    ['UIViewController','UIResponder'], ['UITouch','NSObject'], ['UIEvent','NSObject'], ['NSSet','NSObject'], ['NSArray','NSObject']]) hostClass(name,parent);
  hostClass('NSMutableArray','NSArray'); hostClass('NSMutableSet','NSSet');
  const views = new Map(), controllerViews = new Map(), touches = new Map(), collections = new Map(), eventTouches = new Map();
  const active = new Map(), queue = new PointerQueue();
  const inputMetrics = new InputMetrics();
  let window = 0, screen = 0, canvas, events, previousTap, animation;
  async function withAnimation(seconds,delay,options,changes) {
    const previous=animation;
    const start=performance.now();
    animation={duration:Math.max(0,seconds),delay:Math.max(0,delay),curve:['ease-in-out','ease-in','ease-out','linear'][(options>>>16)&3],start};
    try {return await changes();} finally {animation=previous;}
  }
  function data(ptr) {
    if (!views.has(ptr)) views.set(ptr, {frame:[0,0,0,0],bounds:[0,0,0,0],children:[],parent:0,hidden:false,
      interactive:true,multi:false,exclusive:false,alpha:1,layer:0,controller:0,transform:[1,0,0,1,0,0]});
    return views.get(ptr);
  }
  const readRect = a => [0,1,2,3].map(i => float(a(i)));
  function rectMethod(cls, name, get) {
    const fn = (self, _, dest) => get(self).forEach((value,i) => write(dest + i*4, bits(value)));
    fn.stret = true; method(cls, false, name, fn);
  }
  function bounds() {
    const {width:w, height:h} = phoneScreen;
    return getOrientation() > 2 ? [0,0,h,w] : [0,0,w,h];
  }
  const setFrame = (self, r) => {
    const v = data(self);
    v.layoutAnimation=animation??animationGroups.context();
    if (v.bounds[2] !== r[2] || v.bounds[3] !== r[3]) {
      v.needsLayout=true;
      v.needsDisplay=true;
    }
    v.frame=r; v.bounds[2]=r[2]; v.bounds[3]=r[3]; return self;
  };
  let textViews,pickerViews,pageControls,segmentedControls,switches,toolbars,scrollers,tables,uiColors;
  const clip=self=>viewClip({view:data,convert:convertPoint},self,window);
  const imageViews=uiImages({hostClass,method,names,alloc,destroy,autorelease,retain,releaseFromHost,text,write,ipa,readFile,mediaHost,data,setFrame,bits,float,lookup,read,send,getCoreGraphics,diagnostic,convertPoint,displayPoint,displayBounds,clip,movieVideo,uiColor:p=>uiColors?.rgba(p),uiPattern:p=>uiColors?.patterns.get(p),glLayer:p=>!!lookup(read(p),'setDrawableProperties:'),elements:p=>items(p),hasHostDrawing:p=>tables?.has(p)||textViews?.has(p)||pickerViews?.has(p)||pageControls?.has(p)||segmentedControls?.has(p)||switches?.has(p)||toolbars?.has(p)||scrollers?.views.states.has(p),drawHost:(p,ctx)=>tables?.has(p)&&(tables.draw(p,ctx),!scrollers?.views.states.has(p))?undefined:textViews?.has(p)?textViews.draw(p,ctx):scrollers?.views.states.has(p)?drawScrollIndicators(scrollers.views,p,ctx):pickerViews?.has(p)?pickerViews.draw(p,ctx):pageControls?.has(p)?pageControls.draw(p,ctx):segmentedControls?.has(p)?segmentedControls.draw(p,ctx):switches?.has(p)?switches.draw(p,ctx):toolbars?.has(p)?toolbars.draw(p,ctx):textViews?.draw(p,ctx)});
  function detach(self) {
    const v = data(self);
    if (v.parent) { const next = data(v.parent).children,index=next.indexOf(self);if(index>=0)next.splice(index,1); }
    v.parent = 0;
  }
  const deallocObject=lookup(names.get('NSObject'),'dealloc');
  const deallocateView=async self=>{
    const v=views.get(self);
    if(v) {
      if(window===self)window=0;
      if(v.parent)detach(self);
      for(const child of v.children)data(child).parent=0;
      for(const owned of [...v.children,v.image,v.highlightedImage,v.backgroundColor,v.layer,v.rootController]) {
        if(owned)await releaseFromHost(owned);
      }
      views.delete(self);
    }
    imageViews.removeView(self);
    webViews.remove(self);
    await deallocObject(self);
  };
  method('UIView',false,'dealloc',deallocateView);
  const uiHost={hostClass,method,structure:method,alloc,destroy,autorelease,retain,release:releaseFromHost,send,text,string,write,read,ipa,document:mediaHost?.ownerDocument,view:data,setFrame,deallocateView};
  const animationGroups=installAnimationGroups({...uiHost,thread:()=>currentThread?.()??1,now:()=>performance.now(),selectorName});
  const alerts=installAlerts({...uiHost,responds:(p,name)=>!!p&&!!lookup(read(p),name)});
  textViews=installLabels(uiHost,draw=>getCoreGraphics?.()?.drawCurrent(draw)??false);
  pickerViews=installPickers({...uiHost,screenWidth:()=>phoneScreen.width,responds:(p,name)=>!!p&&!!lookup(read(p),name),
    touchPoint:(set,view)=>{const touch=touches.get(items(set)[0]);return touch?convertPoint(touch.point,touch.window,view):undefined;}});
  const controlHost={...uiHost,classNamed:name=>{const p=names.get(name);if(!p)throw Error('Unknown UIKit class '+name);return p;},selectorName,
    touchInside:(set,view)=>{const touch=touches.get(items(set)[0]);if(!touch)return false;const [x,y]=convertPoint(touch.point,touch.window,view),[bx,by,w,h]=data(view).bounds;return x>=bx&&y>=by&&x<bx+w&&y<by+h;}};
  const fieldLayout=self=>{
    if(!window)return;
    let alpha=1;for(let p=self;p;p=data(p).parent){const value=data(p);if(value.hidden)return;alpha*=value.alpha;if(p===window)break;if(!value.parent)return;}
    const value=data(self),[bx,by,w,h]=value.bounds,screen=displayBounds(window),bounds=mediaHost?{width:mediaHost.offsetWidth,height:mediaHost.offsetHeight}:undefined;
    if(!bounds||!w||!h||!screen[2]||!screen[3])return;
    const p=displayPoint([bx,by],self,window),qx=displayPoint([bx+1,by],self,window),qy=displayPoint([bx,by+1],self,window),sx=bounds.width/screen[2],sy=bounds.height/screen[3];
    return {clipPath:clip(self),left:(p[0]-screen[0])*sx+'px',top:(p[1]-screen[1])*sy+'px',width:w+'px',height:h+'px',opacity:String(alpha),transform:'matrix('+[(qx[0]-p[0])*sx,(qx[1]-p[1])*sy,(qy[0]-p[0])*sx,(qy[1]-p[1])*sy,0,0].join(',')+')'};
  };
  const controls=installControls(controlHost);installButtons({...controlHost,adjustImage:(pointer,brightness,opacity)=>{data(pointer).imageAdjustment={brightness,opacity};},imageSize:imageViews.size,labelSize:textViews.size},controls);
  toolbars=installToolbars({...controlHost,elements:p=>items(p),rgba:p=>uiColors?.rgba(p),imageSize:imageViews.size,drawImage:imageViews.drawImage,
    touchPoint:(set,view)=>{const touch=touches.get(items(set)[0]);return touch?convertPoint(touch.point,touch.window,view):undefined;}});
  installNavigation({...controlHost,selector,elements:p=>items(p),bars:toolbars,keyWindow:()=>window,
    array:values=>autorelease(collection('NSArray',values)),
    deallocController:self=>lookup(names.get('UIViewController'),'dealloc')(self)});
  pageControls=installPageControls({...controlHost,touchPoint:(set,view)=>{const touch=touches.get(items(set)[0]);return touch?convertPoint(touch.point,touch.window,view):undefined;}},controls);
  installActivityIndicators(uiHost);
  segmentedControls=installSegmentedControls({...controlHost,elements:p=>items(p),isString:p=>!!lookup(read(p),'UTF8String'),rgba:p=>uiColors?.rgba(p),imageSize:imageViews.size,drawImage:imageViews.drawImage,
    touchPoint:(set,view)=>{const touch=touches.get(items(set)[0]);return touch?convertPoint(touch.point,touch.window,view):undefined;}},controls);
  switches=installSwitches({...controlHost,rgba:p=>uiColors?.rgba(p)},controls);
  const webViews=new WebViews({hostClass,method,document:mediaHost?.ownerDocument,mount:mediaHost,layout:fieldLayout});
  const textFields=installTextFields({...controlHost,selector,mount:mediaHost,font:p=>textViews.font(p),layout:fieldLayout,enabled:p=>controls.get(p).enabled,dispatch:(p,events)=>controls.dispatch(p,events)});
  scrollers=installScrollViews({...uiHost,parent:p=>data(p).parent,now:()=>performance.now(),isControl:p=>!!lookup(read(p),'sendActionsForControlEvents:'),local:(self,point)=>{const value=convertPoint(point,window,self),bounds=data(self).bounds;return [value[0]-bounds[0],value[1]-bounds[1]];},boundsChanged:self=>{const v=data(self);if(v.layer){setFrame(v.layer,[...v.bounds]);data(v.layer).bounds=[...v.bounds];}}});
  textViews.installTextViews(lookup(names.get('UIScrollView'),'dealloc'));
  const indexPaths=installIndexPaths({hostClass,method,alloc,destroy,retain,release:releaseFromHost,autorelease,text,string,write});
  tables=installTables({...controlHost,responds:(p,name)=>!!p&&!!lookup(read(p),name),parent:p=>data(p).parent,children:p=>data(p).children,hasBackground:p=>!!data(p).backgroundColor,
    touchPoint:(set,view)=>{const touch=touches.get(items(set)[0]);return touch?convertPoint(touch.point,touch.window,view):undefined;},rgba:p=>uiColors?.rgba(p),imageSize:imageViews.size,viewImage:p=>data(p).image??0,
    array:values=>autorelease(collection('NSArray',values)),screenSize:()=>[phoneScreen.width,phoneScreen.height],decodeView:(self,coder)=>lookup(names.get('UIView'),'initWithCoder:')(self,i=>i===0?coder:0)},indexPaths,scrollers.views);
  const transactions=installTransactions({...uiHost,thread:()=>currentThread?.()??1,now:()=>performance.now()});
  const layerGeometry=self=>data(data(self).backingView||self);
  installLayerProperties({...uiHost,geometry:layerGeometry,changed:(self,opacity)=>{layerGeometry(self)[opacity?"opacityAnimation":"layoutAnimation"]=transactions.context();},pixels:p=>getCoreGraphics?.()?.pixels(p),retainImage:p=>getCoreGraphics().retain(p),releaseImage:async p=>{await getCoreGraphics().release(p);}});
  const basicAnimations=installBasicAnimations({...uiHost,responds:(p,name)=>!!p&&!!lookup(read(p),name),layer:layerGeometry,now:()=>performance.now()});
  installTransitions(uiHost);
  installLayerColors({...uiHost,rgba:p=>getCoreGraphics?.()?.colors.rgba(p),retainColor:p=>getCoreGraphics().retain(p),releaseColor:async p=>{await getCoreGraphics().release(p);}});
  installLayerFactory({...uiHost,view:layerGeometry,setFrame:(self,rect)=>{setFrame(data(self).backingView||self,rect);layerGeometry(self).layoutAnimation=transactions.context();return self;}});
  installLayerTree({...uiHost,children:p=>data(p).children,parent:p=>data(p).parent,attach,detach,array:values=>autorelease(collection('NSArray',values))});
  method('CALayer',false,'dealloc',async self=>{
    const v=views.get(self);
    if(v) {
      if(v.parent)detach(self);
      for(const child of v.children){data(child).parent=0;await releaseFromHost(child);}
      if(v.contents)await getCoreGraphics?.()?.release(v.contents);
      if(v.borderColor)await getCoreGraphics().release(v.borderColor);
      if(v.layerBackgroundColor)await getCoreGraphics().release(v.layerBackgroundColor);
      if(v.drawableProperties)await releaseFromHost(v.drawableProperties);
      views.delete(self);
    }
    await deallocObject(self);
  });
  function attach(parent, child) {
    if (!child) return;
    for (let p=parent; p; p=data(p).parent) if (p === child) throw Error('UIView hierarchy cycle');
    if(!data(child).parent)retain(child);
    detach(child);
    data(child).parent = parent; data(parent).children.push(child); data(parent).needsLayout=true; data(child).needsLayout=true;
  }
  function key(self) {
    window = self; data(self).hidden = false;
    if (!data(self).bounds[2]) setFrame(self, bounds());
  }
  method('UIScreen',true,'mainScreen',() => screen ||= alloc(names.get('UIScreen')));
  method('UIScreen',true,'screens',() => autorelease(collection('NSArray',[screen ||= alloc(names.get('UIScreen'))])));
  const portraitBounds=()=>[0,0,phoneScreen.width,phoneScreen.height];
  rectMethod('UIScreen','bounds',portraitBounds); rectMethod('UIScreen','applicationFrame',portraitBounds);
  method('UIScreen',false,'scale',() => bits(phoneScreen.scale));
  method('UIView',false,'initWithFrame:',(self,a) => setFrame(self,readRect(a)));
  method('UIView',false,'setFrame:',(self,a) => { setFrame(self,readRect(a)); });
  method('UIView',false,'setBounds:',(self,a) => {
    const v=data(self), bounds=readRect(a), [x,y,w,h]=v.frame;
    v.layoutAnimation=animation??animationGroups.context(); v.bounds=bounds; v.needsDisplay=true; v.needsLayout=true;
    v.frame=[x+(w-bounds[2])/2,y+(h-bounds[3])/2,bounds[2],bounds[3]];
  });
  async function layout(view) {
    const v=data(view);
    if(v.needsLayout) {
      v.needsLayout=false;
      if(v.controller)await send(v.controller,'viewWillLayoutSubviews',[],true);
      await send(view,'layoutSubviews');
      if(v.controller)await send(v.controller,'viewDidLayoutSubviews',[],true);
    }
    for(const child of [...v.children])if(data(child).parent===view)await layout(child);
  }
  method('UIView',false,'layoutSubviews',()=>{});
  method('UIView',false,'setNeedsLayout',s=>{data(s).needsLayout=true;});
  method('UIView',false,'layoutIfNeeded',layout);
  for(const sel of ['setNeedsDisplay','setNeedsDisplayInRect:'])method('UIView',false,sel,self=>{data(self).needsDisplay=true;});
  function frame(s) {
    const v=data(s),[x,y,w,h]=v.bounds;
    const corners=[[x,y],[x+w,y],[x,y+h],[x+w,y+h]].map(p=>toParent(v,p));
    const xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1]),left=Math.min(...xs),top=Math.min(...ys);
    return [left,top,Math.max(...xs)-left,Math.max(...ys)-top];
  }
  rectMethod('UIView','frame',frame); rectMethod('UIView','bounds',s=>data(s).bounds);
  method('UIView',false,'addSubview:',(self,a)=>attach(self,a(0)));
  method('UIView',false,'removeFromSuperview',s=>{if(data(s).parent){detach(s);return releaseFromHost(s);}});
  method('UIView',false,'superview',self=>data(self).parent);
  method('UIView',false,'window',self => { let v=self; while(data(v).parent) v=data(v).parent; return v===window ? v : 0; });
  method('UIView',false,'setHidden:',(s,a)=>{ data(s).hidden=!!a(0); });
  method('UIView',false,'isHidden',s=>Number(data(s).hidden));
  method('UIView',false,'setAlpha:',(s,a)=>{ data(s).alpha=float(a(0));data(s).opacityAnimation=animation??animationGroups.context(); });
  method('UIView',false,'alpha',s=>bits(data(s).alpha));
  installTouchViewProperties({method,state:data});
  method('UIView',true,'layerClass',()=>names.get('CALayer'));
  method('UIView',false,'layer',async self => {
    const v=data(self);
    if (!v.layer){v.layer=await send(await send(await send(read(self),'layerClass'),'alloc'),'init');setFrame(v.layer,[...v.bounds]);data(v.layer).parent=self;data(v.layer).backingView=self;}
    return v.layer;
  });
  method('UIWindow',false,'setScreen:',(s,a)=>{data(s).screen=a(0);});
  method('UIWindow',false,'screen',s=>data(s).screen??(screen ||= alloc(names.get('UIScreen'))));
  for(const [cls,getter,setter,fallback] of [
    ['UIWindow','windowLevel','setWindowLevel:',0],['UIView','isOpaque','setOpaque:',1],
    ['UIView','contentScaleFactor','setContentScaleFactor:',bits(1)],['UIView','tag','setTag:',0],
    ['UIView','contentMode','setContentMode:',0],['UIView','autoresizingMask','setAutoresizingMask:',0],
    ['UIView','clearsContextBeforeDrawing','setClearsContextBeforeDrawing:',1],['UIView','clipsToBounds','setClipsToBounds:',0],['UIView','autoresizesSubviews','setAutoresizesSubviews:',1],
    ['CALayer','contentsScale','setContentsScale:',bits(1)],['CALayer','isOpaque','setOpaque:',0],
    ['CALayer','borderWidth','setBorderWidth:',0],['CALayer','cornerRadius','setCornerRadius:',0],
    ['CALayer','masksToBounds','setMasksToBounds:',0],['UIViewController','wantsFullScreenLayout','setWantsFullScreenLayout:',0]]) {
    method(cls,false,getter,s=>data(s)[getter]??fallback);
    method(cls,false,setter,(s,a)=>{data(s)[getter]=a(0);data(s).needsDisplay=true;});
  }
  for(const [cls,getter,setter] of [['UIView','backgroundColor','setBackgroundColor:'],
    ['CAEAGLLayer','drawableProperties','setDrawableProperties:']]) {
    method(cls,false,getter,s=>data(s)[getter]??0);
    method(cls,false,setter,async(s,a)=>{const d=data(s),old=d[getter];d[getter]=retain(a(0));d.needsDisplay=true;if(old)await releaseFromHost(old);});
  }
  const center=(s,_,dest)=>{const v=data(s),[x,y,w,h]=v.frame,[ax,ay]=v.anchorPoint??[.5,.5];write(dest,bits(x+w*ax));write(dest+4,bits(y+h*ay));};
  center.stret=true;method('UIView',false,'center',center);
  method('UIView',false,'setCenter:',(s,a)=>{const view=data(s),f=view.frame;view.layoutAnimation=animation??animationGroups.context();const [ax,ay]=view.anchorPoint??[.5,.5];f[0]=float(a(0))-f[2]*ax;f[1]=float(a(1))-f[3]*ay;});
  method('UIView',false,'subviews',s=>autorelease(collection('NSArray',data(s).children)));
  installViewOrdering({method,children:pointer=>data(pointer).children});
  method('UIView',false,'viewWithTag:',(s,a)=>{const target=a(0),walk=p=>data(p).tag===target?p:data(p).children.map(walk).find(Boolean)??0;return walk(s);});
  uiColors=installColors({...uiHost,deallocateObject:async p=>{await deallocObject(p);},setColor:(channels,fill,stroke)=>getCoreGraphics?.()?.setColor(channels,fill,stroke),createCG:(channels,gray)=>{const cg=getCoreGraphics?.();if(!cg)throw Error('Quartz color registry unavailable');return cg.colors.generic(gray?[channels[0],channels[3]]:channels);},colorInfo:p=>{const cg=getCoreGraphics?.(),channels=cg?.colors.rgba(p);return channels?{channels,gray:cg.colors.get(p).components.length===2}:undefined;},releaseCG:async p=>{await getCoreGraphics().release(p);}});
  installNibViews({...uiHost,items,classNamed:name=>names.get(name),isString:pointer=>!!lookup(read(pointer),'UTF8String'),bytes:pointer=>readBytes(read(pointer+DataField.Bytes),read(pointer+DataField.Length))});
  method('UIWindow',false,'makeKeyAndVisible',key); method('UIWindow',false,'makeKeyWindow',key);
  let ignoring=0;const ignoredPointers=new Set();
  method('UIApplication',false,'beginIgnoringInteractionEvents',()=>{ignoring++;});
  method('UIApplication',false,'endIgnoringInteractionEvents',()=>{ignoring=Math.max(0,ignoring-1);});
  method('UIApplication',false,'isIgnoringInteractionEvents',()=>Number(ignoring>0));
  method('UIApplication',false,'keyWindow',()=>window);
  method('UIApplication',false,'windows',()=>autorelease(collection('NSArray',window?[window]:[])));
  method('UIViewController',false,'setView:',async(self,a)=>{
    const view=a(0), old=controllerViews.get(self);
    if(old===view)return;
    controllerViews.set(self,retain(view));
    if(view)data(view).controller=self;
    if(old){data(old).controller=0;await releaseFromHost(old);}
  });
  const controllerNibs=installControllerNibs({method,text,string,retain,send,release:releaseFromHost,load:(name,owner,bundle)=>loadNib(name,owner,bundle)});
  method('UIViewController',false,'loadView',async self=>{if(!await controllerNibs.load(self))await send(self,'setView:',[autorelease(setFrame(alloc(names.get('UIView')),bounds()))]);});
  method('UIViewController',false,'viewDidLoad',()=>{});
  method('UIViewController',false,'dealloc',async self=>{const view=controllerViews.get(self);controllerViews.delete(self);if(view){data(view).controller=0;await releaseFromHost(view);}await controllerNibs.dispose(self);return deallocObject(self);});
  method('UIViewController',false,'view',async self=>{
    if (!controllerViews.get(self)) {
      await send(self,'loadView');
      await send(self,'viewDidLoad',[],true);
    }
    return controllerViews.get(self) ?? 0;
  });
  method('UIWindow',false,'setRootViewController:',async (self,a)=>{
    const v=data(self), controller=a(0);
    const previous=v.rootController;
    if(previous===controller)return;
    if(previous) {
      const old=controllerViews.get(previous);
      if(old&&data(old).parent===self) {detach(old);await releaseFromHost(old);}
      await releaseFromHost(previous);
    }
    v.rootController=retain(controller);
    if(!controller) return;
    const root=await send(controller,'view');
    if (!root) throw Error('UIWindow root controller returned nil view');
    if (!data(root).bounds[2]) setFrame(root,v.bounds[2]?v.bounds:bounds());
    attach(self,root);
  });
  method('UIWindow',false,'rootViewController',s=>data(s).rootController ?? 0);
  const nextResponder = self => data(self).controller || data(self).parent;
  method('UIView',false,'nextResponder',nextResponder);
  method('UIViewController',false,'nextResponder',self=>controllerViews.has(self)?data(controllerViews.get(self)).parent:0);
  for (const [,name] of Object.values(phases)) {
    method('UIResponder',false,name,async (self,a)=>{
      const next=await send(self,'nextResponder',[],true);
      if(next) await send(next,name,[a(0),a(1)],true);
    });
  }
  // UIKit transforms operate about the view's center. Keep model frame and
  // bounds in logical points even when the browser scales the backing canvas.
  function rotation(view) {
    const parent=view.parent&&data(view.parent);
    if(!parent || !view.controller || parent.rootController!==view.controller || parent.bounds[2]>=parent.bounds[3])return 0;
    return getOrientation()>2?getOrientation():0;
  }
  // Before iOS 8 the window remains portrait in landscape. UIKit centers its
  // root controller's view and applies the interface-orientation transform.
  function rootToWindow(view, point, inverse) {
    const orient=rotation(view);
    if(!orient)return point;
    const wb=data(view.parent).bounds;
    let [x,y]=point;
    if(inverse){
      x-=wb[0];y-=wb[1];
      return orient===3?[y,wb[2]-x]:[wb[3]-y,x];
    }
    return orient===3?[wb[0]+wb[2]-y,wb[1]+x]:[wb[0]+y,wb[1]+wb[3]-x];
  }
  function fromParent(view, point) {
    point=rootToWindow(view,point,true);
    const [x,y,w,h]=view.frame, [bx,by,bw,bh]=view.bounds;
    const [a,b,c,d,tx,ty]=view.transform, det=a*d-b*c;
    if (!det) return [Infinity, Infinity];
    const [ax,ay]=view.anchorPoint??[.5,.5];
    const px=point[0]-(x+w*ax+tx), py=point[1]-(y+h*ay+ty);
    return [bx+bw*ax+(px*d-py*c)/det, by+bh*ay+(py*a-px*b)/det];
  }
  function toParent(view, point) {
    const [x,y,w,h]=view.frame, [bx,by,bw,bh]=view.bounds;
    const [a,b,c,d,tx,ty]=view.transform;
    const [ax,ay]=view.anchorPoint??[.5,.5];
    const px=point[0]-bx-bw*ax, py=point[1]-by-bh*ay;
    return rootToWindow(view,[x+w*ax+tx+a*px+c*py, y+h*ay+ty+b*px+d*py],false);
  }
  function convertPoint(point, from, to) {
    for(let p=from;p&&p!==window;p=data(p).parent) point=toParent(data(p),point);
    const chain=[];
    for(let p=to;p&&p!==window;p=data(p).parent) chain.push(p);
    for(const p of chain.reverse()) point=fromParent(data(p),point);
    return point;
  }
  function displayBounds(win) {
    const [,,w,h]=data(win).bounds;
    return w<h&&getOrientation()>2?[0,0,h,w]:[0,0,w,h];
  }
  function displayPoint(point, from, win) {
    const [bx,by,w,h]=data(win).bounds;
    const p=convertPoint(point,from,win),x=p[0]-bx,y=p[1]-by;
    if(w<h && getOrientation()===3)return [y,w-x];
    if(w<h && getOrientation()===4)return [h-y,x];
    return [x,y];
  }
  // Renderbuffer size comes from the layer alone; its display placement needs the window.
  function drawableGeometry(layer) {
    const owner=data(layer).backingView??layer, state=data(owner), [bx,by,width,height]=state.bounds;
    const scale=state.contentScaleFactor??data(layer).contentsScale, size={width,height,scale:scale===undefined?1:float(scale),screenScale:phoneScreen.scale};
    if(!window)return size;
    const [,,dw,dh]=displayBounds(window);
    return {...size,display:{width:dw,height:dh},toDisplay:([x,y])=>displayPoint([bx+x,by+y],owner,window)};
  }
  const transform=(s,_,dest)=>data(s).transform.forEach((v,i)=>write(dest+i*4,bits(v)));
  transform.stret=true; method('UIView',false,'transform',transform);
  method('UIView',false,'setTransform:',(s,a)=>{data(s).transform=Array.from({length:6},(_,i)=>float(a(i)));data(s).layoutAnimation=animation??animationGroups.context();});
  for(const [name,fromSelf] of [['convertPoint:toView:',true],['convertPoint:fromView:',false]]) {
    const convert=(s,a,dest)=>convertPoint([float(a(0)),float(a(1))],fromSelf?s:a(2),fromSelf?a(2):s)
      .forEach((v,i)=>write(dest+i*4,bits(v)));
    convert.stret=true;method('UIView',false,name,convert);
  }
  for(const [name,fromSelf] of [['convertRect:toView:',true],['convertRect:fromView:',false]]) {
    const convert=(s,a,dest)=>{
      const [x,y,w,h]=readRect(a),from=fromSelf?s:a(4),to=fromSelf?a(4):s;
      const corners=[[x,y],[x+w,y],[x,y+h],[x+w,y+h]].map(p=>convertPoint(p,from,to));
      const xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1]),l=Math.min(...xs),t=Math.min(...ys);
      [l,t,Math.max(...xs)-l,Math.max(...ys)-t].forEach((v,i)=>write(dest+i*4,bits(v)));
    };
    convert.stret=true;method('UIView',false,name,convert);
  }
  method('UIViewController',false,'interfaceOrientation',()=>getOrientation());
  function pointInView(self, ref, previous) {
    const t=touches.get(self);
    return convertPoint(previous?t.previous:t.point,window,ref);
  }
  for(const [name,previous] of [['locationInView:',false],['previousLocationInView:',true]]) {
    const fn=(self,a,dest)=>pointInView(self,a(0),previous).forEach((n,i)=>write(dest+i*4,bits(n)));
    fn.stret=true; method('UITouch',false,name,fn);
  }
  method('UITouch',false,'view',s=>touches.get(s).target);
  method('UITouch',false,'window',s=>touches.get(s).window);
  method('UITouch',false,'phase',s=>touches.get(s).phase);
  method('UITouch',false,'timestamp',s=>double(touches.get(s).time));
  method('UITouch',false,'tapCount',s=>touches.get(s).taps);
  method('UITouch',false,'dealloc',s=>{touches.delete(s); destroy(s);});
  method('UIEvent',false,'allTouches',s=>eventTouches.get(s));
  method('UIEvent',false,'dealloc',s=>{eventTouches.delete(s); destroy(s);});
  function collection(cls, items) {
    const obj=alloc(names.get(cls)); collections.set(obj,items.map(retain)); return obj;
  }
  function items(s) {
    if(!collections.has(s)) collections.set(s,[]);
    return collections.get(s);
  }
  for(const [cls, mutable, factory] of [['NSArray','NSMutableArray','array'],['NSSet','NSMutableSet','set']]){
    method(cls,true,factory,c=>autorelease(alloc(c)));
    method(cls,true,factory+'WithObject:',(c,a)=>{const ptr=alloc(c);items(ptr).push(retain(a(0)));return autorelease(ptr);});
    method(mutable,true,factory+'WithCapacity:',c=>autorelease(alloc(c)));
    method(cls,false,'containsObject:',async(s,a)=>{
      const target=a(0);for(const item of items(s)) if(item===target||await send(item,'isEqual:',[target]))return 1;
      return 0;
    });
    method(mutable,false,'addObject:',async(s,a)=>{
      const value=a(0);if(!value)throw Error('Adding nil to '+mutable);
      if(cls==='NSSet'&&await send(s,'containsObject:',[value]))return;
      items(s).push(retain(value));
    });
    method(mutable,false,'removeAllObjects',async s=>{for(const v of items(s).splice(0))await releaseFromHost(v);});
    method(mutable,false,'removeObject:',async(s,a)=>{
      const target=a(0),list=items(s);
      for(let i=list.length-1;i>=0;i--) if(list[i]===target||await send(list[i],'isEqual:',[target])){
        const [v]=list.splice(i,1);await releaseFromHost(v);
      }
    });
    method(cls,false,'copy',s=>collection(cls,items(s)));
    method(cls,false,'mutableCopy',s=>collection(mutable,items(s)));
  }
  method('NSArray',true,'arrayWithObjects:',(cls,a)=>{
    const ptr=alloc(cls);for(let i=0;a(i);i++)items(ptr).push(retain(a(i)));return autorelease(ptr);
  });
  method('NSArray',true,'arrayWithObjects:count:',(cls,a)=>{
    const ptr=alloc(cls);for(let i=0;i<a(1);i++)items(ptr).push(retain(read(a(0)+i*4)));return autorelease(ptr);
  });
  method('NSArray',false,'initWithArray:',(s,a)=>{collections.set(s,items(a(0)).map(retain));return s;});
  method('NSArray',false,'lastObject',s=>items(s).at(-1)??0);
  method('NSArray',false,'firstObject',s=>items(s)[0]??0);
  method('NSMutableArray',false,'removeObjectAtIndex:',(s,a)=>{
    const list=items(s),at=a(0);if(at>=list.length)throw Error('NSArray index outside bounds');
    return releaseFromHost(list.splice(at,1)[0]);
  });
  method('NSMutableArray',false,'removeObjectsInArray:',async(s,a)=>{
    const other=a(0);if(!other)return;
    let targets=collections.get(other)?.slice();
    if(!targets){targets=[];const count=Number(await send(other,'count'));for(let i=0;i<count;i++)targets.push(Number(await send(other,'objectAtIndex:',[i])));}
    for(const target of targets){retain(target);try{await send(s,"removeObject:",[target]);}finally{await releaseFromHost(target);}}
  });
  method('NSMutableArray',false,'insertObject:atIndex:',(s,a)=>{
    const p=a(0),i=a(1),list=items(s);if(!p||i>list.length)throw Error('Invalid NSMutableArray insertion');
    list.splice(i,0,retain(p));
  });
  for (const cls of ['NSSet','NSArray']) {
    method(cls,false,'count',s=>items(s).length);
    method(cls,false,'dealloc',async s=>{
      const items = collections.get(s) || [];
      collections.delete(s);
      for (const ptr of items) await releaseFromHost(ptr);
      destroy(s);
    });
    method(cls,false,'countByEnumeratingWithState:objects:count:',(s,a)=>{
      const state=a(0), buffer=a(1), start=read(state), items=collections.get(s)??[];
      const n=Math.min(a(2),Math.max(0,items.length-start));
      if(n) {
        for(let i=0;i<n;i++)write(buffer+i*4,items[start+i]);
        write(state,start+n); write(state+4,buffer); write(state+8,s);
      }
      return n;
    });
  }
  method('NSArray',false,'objectAtIndex:',(s,a)=>{
    if(a(0)>=items(s).length) throw Error('NSArray index outside bounds');
    return items(s)[a(0)];
  });
  method('NSSet',false,'anyObject',s=>collections.get(s)[0] ?? 0);
  method('NSSet',false,'allObjects',s=>autorelease(collection('NSArray',[...collections.get(s)])));
  function hit(self, x,y) {
    const v=data(self),[bx,by,w,h]=v.bounds;
    if(v.hidden || !v.interactive || v.alpha<=0.01 || x<bx || y<by || x>=bx+w || y>=by+h) return 0;
    for (let i=v.children.length-1;i>=0;i--) {
      const p=v.children[i],child=data(p);
      const found=hit(p,...fromParent(child,[x,y]));
      if(found)return found;
    }
    return self;
  }
  function connect() {
    if(!window || canvas)return;
    canvas=graphics().canvas; events=new AbortController();
    const enqueue = e=>{
      if(e.pointerType==='mouse' && e.type==='pointerdown' && e.button!==0)return;
      const rect=canvas.getBoundingClientRect(), b=data(window).bounds;
      if(!rect.width || !rect.height)return;
      let x=(e.clientX-rect.left)/rect.width, y=(e.clientY-rect.top)/rect.height;
      // The player can turn the whole stage a quarter turn; undo it to get display coordinates.
      const turn=canvas.ownerDocument?.body?.dataset?.turn;
      if(turn==='90')[x,y]=[y,1-x];
      else if(turn==='-90')[x,y]=[1-y,x];
      const orientation=getOrientation();
      if (b[2]<b[3] && orientation>2) {
        if(orientation===3) [x,y]=[1-y,x];
        if(orientation===4) [x,y]=[y,1-x];
      }
      const point=[b[0]+x*b[2],b[1]+y*b[3]];
      if(e.type==='pointerdown' && canvas.hasPointerCapture && !canvas.hasPointerCapture(e.pointerId)) {
        try {canvas.setPointerCapture(e.pointerId);} catch { /* Synthetic events have no active pointer. */ }
      }
      if(e.type==='pointermove' && !e.buttons && e.pointerType==='mouse') return;
      if(ignoring&&e.type==='pointerdown')ignoredPointers.add(e.pointerId);
      if(ignoredPointers.has(e.pointerId)){if(e.type!=='pointermove')ignoredPointers.delete(e.pointerId);e.preventDefault();return;}
      inputMetrics.receive();
      queue.push({id:e.pointerId,type:e.type,point,time:e.timeStamp/1000});
      e.preventDefault();
    };
    canvas.style.touchAction='none';
    for(const type of Object.keys(phases))canvas.addEventListener(type,enqueue,{passive:false,signal:events.signal});
    signal?.addEventListener('abort',disconnect,{once:true});
  }
  function disconnect(){events?.abort(); signal?.removeEventListener('abort',disconnect);canvas=null;}
  async function deliverTouch(t,e,phase,name,target=t.target) {
    for(const touch of active.values()){touch.phase=TouchPhase.Stationary;touch.previous=touch.point;}
    t.phase=phase;t.previous=t.point;t.point=e.point;t.time=e.time;
    const changed=collection('NSSet',[t.ptr]),all=collection('NSSet',[...active.values()].map(t=>t.ptr));
    const event=alloc(names.get('UIEvent'));eventTouches.set(event,all);
    try{inputMetrics.dispatch(className(target),e.type,e.point,convertPoint(e.point,window,target));await send(target,name,[changed,event]);}
    finally{await releaseFromHost(changed);await releaseFromHost(all);await releaseFromHost(event);}
  }
  async function sampleTouch(t,e,phase,name) {
    let pan={view:0,cancel:false};
    if(e.type===PointerPhase.Move)pan=await scrollers.interaction.move(e.id,e.point,e.time);
    if(phase>=TouchPhase.Ended)pan.view=await scrollers.interaction.end(e.id,phase===TouchPhase.Cancelled,e.time);
    if(pan.cancel){
      if(!t.deferred){inputMetrics.receive();await deliverTouch(t,{...e,type:PointerPhase.Cancel},TouchPhase.Cancelled,'touchesCancelled:withEvent:');}
      else inputMetrics.dispatch(className(pan.view),t.down.type,t.down.point,convertPoint(t.down.point,window,pan.view));
      t.deferred=false;t.pan=true;
    }
    if(t.pan||pan.view){
      inputMetrics.dispatch(className(pan.view||t.panView),e.type,e.point,convertPoint(e.point,window,pan.view||t.panView));t.panView=pan.view||t.panView;t.point=e.point;t.phase=phase;t.time=e.time;return;
    }
    if(t.deferred&&phase===TouchPhase.Cancelled)return;
    if(t.deferred&&(phase===TouchPhase.Ended||(e.time-t.down.time)*1000>=ScrollTiming.Delay)){t.deferred=false;await deliverTouch(t,t.down,TouchPhase.Began,'touchesBegan:withEvent:');}
    if(!t.deferred)await deliverTouch(t,e,phase,name);
  }
  async function pump() {
    await animationGroups.pump();
    await basicAnimations.pump();
    await scrollers.pump();
    if(window)await layout(window);
    await imageViews.render(window);await textFields.pump();webViews.render();
    for(const e of queue.takeTurn()) {
      let t=active.get(e.id);
      if(e.type===PointerPhase.Down){
        if(t){inputMetrics.drop(DropReason.Duplicate);continue;}
        const target=hit(window,...e.point);if(!target){inputMetrics.drop(DropReason.NoTarget);continue;}
        const conflict=touchConflict(data,target,[...active.values()].map(touch=>touch.target));if(conflict){inputMetrics.drop(conflict);continue;}
        const taps=previousTap&&previousTap.target===target&&e.time-previousTap.time<0.35&&Math.hypot(e.point[0]-previousTap.point[0],e.point[1]-previousTap.point[1])<10?previousTap.taps+1:1;
        t={ptr:alloc(names.get('UITouch')),window,target:retain(target),taps,point:e.point,down:e,deferred:await scrollers.interaction.begin(e.id,target,e.point,e.time)};
        active.set(e.id,t);touches.set(t.ptr,t);
      }
      if(!t){inputMetrics.drop(DropReason.Missing);continue;}
      const[phase,name]=phases[e.type];
      try{await sampleTouch(t,e,phase,name);}
      finally{if(phase>=TouchPhase.Ended){if(phase===TouchPhase.Ended&&!t.pan)previousTap={target:t.target,taps:t.taps,time:t.time,point:t.point};active.delete(e.id);await releaseFromHost(t.ptr);await releaseFromHost(t.target);}}
    }
    transactions.flush();
    for(const t of active.values())if(t.deferred&&(performance.now()/1000-t.down.time)*1000>=ScrollTiming.Delay){t.deferred=false;await deliverTouch(t,t.down,TouchPhase.Began,'touchesBegan:withEvent:');}
  }
  async function cancelTouches() {
    const discarded=queue.clear();
    for(let index=0;index<discarded;index++)inputMetrics.drop(DropReason.Inactive);
    for(const [id,touch] of active) {
      inputMetrics.receive();
      queue.push({id,type:PointerPhase.Cancel,point:touch.point,time:performance.now()/1000});
    }
    if(queue.length)await pump();
  }
  function scene(className) {
    const nodes=[],pending=window?[window]:[];
    while(pending.length&&nodes.length<12) {
      const p=pending.shift(),v=data(p);
      nodes.push({class:className(p),controller:v.controller?className(v.controller):undefined,rootController:v.rootController?className(v.rootController):undefined, frame:v.frame.slice(),bounds:v.bounds.slice(), transform:v.transform.slice(),hidden:v.hidden});
      pending.push(...v.children.slice(0,12));
    }
    return nodes;
  }
  return {webViews,drawableGeometry,snapshot:()=>({...inputMetrics.snapshot(),queued:queue.length,coalesced:queue.coalesced,scene:scene(className)}),scene,connect,disconnect,withAnimation,close:()=>{disconnect();imageViews.close();textViews.close();pickerViews.close();scrollers.close();textFields.close();webViews.close();alerts.close();},pumpAlerts:()=>alerts.pump(),hasAlerts:()=>alerts.pending(),pump,cancelTouches,hasWindow:()=>!!window,items,array:(items,mutable)=>collection(mutable?'NSMutableArray':'NSArray',items)};
}
