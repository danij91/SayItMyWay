(function(root){
 const groups={ControlLeft:'ctrl',ControlRight:'ctrl',AltLeft:'alt',AltRight:'alt',ShiftLeft:'shift',ShiftRight:'shift',MetaLeft:'meta',MetaRight:'meta'};
 const flags=['ctrl','alt','shift','meta'];
 const keys=[...Object.keys(groups),...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(c=>'Key'+c),...Array.from({length:10},(_,n)=>'Digit'+n),...Array.from({length:24},(_,n)=>'F'+(n+1)),'ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','Enter','Tab','Backspace','Delete','Insert','Home','End','PageUp','PageDown','Minus','Equal','BracketLeft','BracketRight','Backslash','Semicolon','Quote','Backquote','Comma','Period','Slash','IntlBackslash','IntlRo','IntlYen','NumpadEnter','NumpadAdd','NumpadSubtract','NumpadMultiply','NumpadDivide','NumpadDecimal',...Array.from({length:10},(_,n)=>'Numpad'+n)];
 const invalid=()=>Error(root.TextPatchI18n?.t('interaction_invalid') || 'Invalid shortcut settings');
 function binding(value){
  if(value===null || value==='')return null;
  if(typeof value==='string'){
   if(!groups[value])throw invalid();
   value={code:value,ctrl:false,alt:false,shift:false,meta:false};
  }
  if(!value || !keys.includes(value.code) || flags.some(f=>typeof value[f]!=='boolean'))throw invalid();
  const result={code:value.code,...Object.fromEntries(flags.map(f=>[f,f===groups[value.code]?false:value[f]]))};
  // AltGraph is often delivered as Ctrl+Alt, including a primary modifier.
  if((result.ctrl || groups[result.code]==='ctrl') && (result.alt || groups[result.code]==='alt'))throw invalid();
  return result;
 }
 const defaults={peekEnabled:true,editEnabled:true,peekMode:'hold',editMode:'hold',peekKey:binding('ShiftLeft'),editKey:binding('AltLeft')};
 const equal=(a,b)=>!!a && !!b && a.code===b.code && flags.every(f=>a[f]===b[f]);
 function validate(value=defaults){
  if(!value || !['hold','toggle'].includes(value.peekMode))throw invalid();
  const editMode=value.editMode===undefined?'hold':value.editMode;
  if(!['hold','toggle'].includes(editMode))throw invalid();
  const peekKey=binding(value.peekKey),editKey=binding(value.editKey);
  const enabled=(feature,key)=>{
   const flag=value[feature+'Enabled'];
   if(flag!==undefined && typeof flag!=='boolean')throw invalid();
   const active=flag===undefined?!!key:flag;
   if(active && !key)throw invalid();
   return active;
  };
  const peekEnabled=enabled('peek',peekKey),editEnabled=enabled('edit',editKey);
  if(peekEnabled && editEnabled && equal(peekKey,editKey))throw invalid();
  return {peekMode:value.peekMode,editMode,peekKey,editKey,peekEnabled,editEnabled};
 }
 function fromEvent(event){
  if(event.isComposing || event.keyCode===229 || event.getModifierState?.('AltGraph'))throw invalid();
  return binding({code:event.code,...Object.fromEntries(flags.map(f=>[f,!!event[f+'Key']]))});
 }
 function matches(event,value){
  try{return equal(fromEvent(event),binding(value));}catch{return false;}
 }
 function releases(event,value){
  try{const b=binding(value);return !!b && (event.code===b.code || !!b[groups[event.code]]);}catch{return false;}
 }
 function label(value){
  const b=binding(value),t=(key,params)=>root.TextPatchI18n?.t(key,params) || key;
  if(!b)return t('interaction_disabled');
  const ordinary={Space:'Space',ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→',Minus:'−',Equal:'=',BracketLeft:'[',BracketRight:']',Backslash:'\\',Semicolon:';',Quote:"'",Backquote:'`',Comma:',',Period:'.',Slash:'/'};
  const group=groups[b.code],name=group?({ctrl:'Ctrl',alt:'Alt',shift:'Shift',meta:'Meta'})[group]:ordinary[b.code] || b.code.replace(/^Key|^Digit/,'').replace(/^Numpad/,'Num ');
  const primary=group?t(b.code.endsWith('Left')?'interaction_left':'interaction_right',{key:name}):name;
  return [...flags.filter(f=>b[f]).map(f=>({ctrl:'Ctrl',alt:'Alt',shift:'Shift',meta:'Meta'})[f]),primary].join(' + ');
 }
 root.TextPatchInteraction={defaults,keys,validate,fromEvent,matches,releases,label,isModifier:code=>!!groups[code]};
})(globalThis);
