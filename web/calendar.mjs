import {read32,readString,write32} from '../src/runtime/memory/guest-memory.ts';

const weekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
const pad=(n,w=2)=>String(n).padStart(w,'0');
const text=new TextEncoder();
export function calendarImports(cpu,heap,errno,threadID) {
  const slots=new Map(),zones=new Map();
  const zoneName=new Intl.DateTimeFormat('en-US',{timeZoneName:'short'});
  const shared=()=>{
    if(!slots.has(threadID())) slots.set(threadID(),heap.zero(44));
    return slots.get(threadID());
  };
  function pack(seconds,ptr,local) {
    const date=new Date(seconds*1000);
    const field=name=>date[(local?'get':'getUTC')+name]();
    const y=field('FullYear'),m=field('Month'),d=field('Date');
    const offset=local?-60*date.getTimezoneOffset():0;
    const standard=local?Math.max(new Date(y,0,1).getTimezoneOffset(),new Date(y,6,1).getTimezoneOffset()):0;
    const zone=local?zoneName.formatToParts(date).find(p=>p.type==='timeZoneName')?.value||'UTC':'UTC';
    if(!zones.has(zone)) zones.set(zone,heap.string(zone));
    const fields=[field('Seconds'),field('Minutes'),field('Hours'),d,m,y-1900,field('Day'),
      (Date.UTC(y,m,d)-Date.UTC(y,0,1))/86400000,Number(local&&date.getTimezoneOffset()<standard),offset,zones.get(zone)];
    fields.forEach((value,i)=>write32(cpu,ptr+i*4,value));
    return ptr;
  }
  function convert(a,local,reentrant) {
    const out=reentrant?a(1):shared();
    if (!a(0)||!out) { write32(cpu,errno,14);return 0; }
    return pack(read32(cpu,a(0))|0,out,local);
  }
  const doubles=new DataView(new ArrayBuffer(8));
  // clock() is process CPU time, which a busy game spends almost entirely running: wall time
  // matches iOS. Guest CPU time alone ran games that time with clock() at half speed or worse.
  const started=performance.now(), CLOCKS_PER_MILLISECOND=1000;
  return {
    _clock:()=>Math.floor((performance.now()-started)*CLOCKS_PER_MILLISECOND)>>>0,
    _difftime:a=>{doubles.setFloat64(0,(a(0)|0)-(a(1)|0),true);return doubles.getBigUint64(0,true);},
    _gmtime:a=>convert(a,false,false), _localtime:a=>convert(a,true,false), _localtime_r:a=>convert(a,true,true),
    _mktime:a=>{
      const p=a(0),f=i=>read32(cpu,p+i*4)|0;
      const date=new Date(0);date.setFullYear(f(5)+1900,f(4),f(3));date.setHours(f(2),f(1),f(0),0);
      const sec=date.valueOf()/1000;
      if (!Number.isInteger(sec)||sec< -2147483648||sec>2147483647) { write32(cpu,errno,84);return -1; }
      pack(sec,p,true);return sec;
    },
    _strftime:a=>{
      const p=a(3),f=i=>read32(cpu,p+4*i)|0,y=1900+f(5),m=f(4),d=f(3),day=f(6),yd=f(7);
      const date=new Date(Date.UTC(y,m,d)),isoDay=day||7;
      const thurs=new Date(date);thurs.setUTCDate(d+4-isoDay);
      const isoYear=thurs.getUTCFullYear(),isoWeek=Math.ceil(((thurs-Date.UTC(isoYear,0,1))/86400000+1)/7);
      const sec=f(0),min=f(1),hour=f(2),offset=f(9),time=pad(hour)+':'+pad(min)+':'+pad(sec);
      const w=weekdays[day]||'',month=months[m]||'',am=hour<12?'AM':'PM';
      const names={a:w.slice(0,3),A:w,b:month.slice(0,3),B:month,h:month.slice(0,3),C:pad(Math.floor(y/100)),
        d:pad(d),e:String(d).padStart(2,' '),m:pad(m+1),y:pad(y%100),Y:y,F:y+'-'+pad(m+1)+'-'+pad(d),
        I:pad(hour%12||12),H:pad(hour),k:String(hour).padStart(2,' '),l:String(hour%12||12).padStart(2,' '),
        M:pad(min),S:pad(sec),T:time,X:time,R:pad(hour)+':'+pad(min),p:am,r:pad(hour%12||12)+':'+pad(min)+':'+pad(sec)+' '+am,
        j:pad(yd+1,3),u:isoDay,w:day,U:pad(Math.floor((yd+7-day)/7)),W:pad(Math.floor((yd+7-((day+6)%7))/7)),
        V:pad(isoWeek),G:isoYear,g:pad(isoYear%100),x:pad(m+1)+'/'+pad(d)+'/'+pad(y%100),
        D:pad(m+1)+'/'+pad(d)+'/'+pad(y%100),c:w.slice(0,3)+' '+month.slice(0,3)+' '+String(d).padStart(2,' ')+' '+time+' '+y,
        s:Math.floor((Date.UTC(y,m,d,hour,min,sec)/1000)-offset),Z:f(10)?readString(cpu,f(10)>>>0):'',
        z:(offset<0?'-':'+')+pad(Math.floor(Math.abs(offset)/3600))+pad(Math.floor(Math.abs(offset)/60)%60),
        t:'\t',n:'\n','%':'%'};
      const str=readString(cpu,a(2)).replace(/%[EO]?(.)/g,(token,ch)=>names[ch]??token);
      const bytes=text.encode(str+'\0');
      if(bytes.length>a(1)) return 0;
      cpu.write(a(0),bytes);return bytes.length-1;
    }
  };
}
