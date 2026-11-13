import {parsePlist} from './plist.mjs';

function decode(bytes) {
  if (new TextDecoder().decode(bytes.subarray(0,8)) === 'bplist00') return parsePlist(bytes);
  const encoding = bytes[0]===255 && bytes[1]===254 ? 'utf-16le' :
    bytes[0]===254 && bytes[1]===255 ? 'utf-16be' : 'utf-8';
  const source=new TextDecoder(encoding).decode(bytes);
  if (source.trimStart().startsWith('<')) return parsePlist(new TextEncoder().encode(source));
  const table=Object.create(null);
  const tokens=source.match(/"(?:[^"\\]|\\[\s\S])*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*|[=;]|[^\s=;]+/g)??[];
  const values=tokens.filter(v=>!v.startsWith('/*')&&!v.startsWith('//'));
  const literal=v=>v.startsWith('"')?v.slice(1,-1).replace(/\\(?:U([0-9a-fA-F]{4})|([0-7]{1,3})|([\s\S]))/g,(_,unicode,oct,c)=>
    unicode?String.fromCharCode(parseInt(unicode,16)):oct?String.fromCharCode(parseInt(oct,8)):({n:'\n',r:'\r',t:'\t'}[c]??c)):v;
  for(let i=0;i<values.length;i+=4) {
    if(values[i+1]!=='='||values[i+3]!==';')throw Error('Malformed .strings table');
    table[literal(values[i])]=literal(values[i+2]);
  }
  return table;
}

export function bundleStrings(ipa) {
  const tables=new Map();
  async function load(name) {
    const preferred=globalThis.navigator?.languages??['en'];
    const locales=new Set(preferred.flatMap(language=>[language,language.split('-')[0]]));
    for(const language of [ipa.info.CFBundleDevelopmentRegion,'en','English','Base',''])if(language!=null)locales.add(language);
    for(const language of locales){
      const path=ipa.bundlePath+'/'+(language?language+'.lproj/':'')+name+'.strings';
      if(ipa.has(path))return decode(await ipa.read(path));
    }
    return Object.create(null);
  }
  return async (key,name='Localizable')=>{
    if(/[\\/]/.test(name)||name==='..')throw Error('Invalid bundle string table name');
    if(!tables.has(name))tables.set(name,load(name));
    const table=await tables.get(name);
    return Object.hasOwn(table,key)?table[key]:undefined;
  };
}
