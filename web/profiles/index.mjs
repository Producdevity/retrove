import {prepareBioShockConfig} from '../bioshock-config.mjs';
import {bioShockPatches} from './bioshock.mjs';
export async function prepareApplication(ipa,original,diagnostic) {
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',original)),b=>b.toString(16).padStart(2,'0')).join('');
  if(hash!=='3ae21f0f246b72977e072be5a5311d54fd3820a974c31cdbd3fa2b0c0af7631e')return original;
  const view=new DataView(original.buffer,original.byteOffset,original.byteLength);
  for(const [offset,before] of bioShockPatches)if(view.getUint32(offset,true)!==before)throw Error('Unexpected BioShock instruction at '+offset.toString(16));
  const bytes=original.slice(),output=new DataView(bytes.buffer);
  for(const [offset,,after] of bioShockPatches)output.setUint32(offset,after,true);
  diagnostic('info','profile','Applied BioShock 1.3.5 compatibility profile',{sha256:hash,patchWords:bioShockPatches.length});
  await prepareBioShockConfig(ipa,diagnostic);
  return bytes;
}
