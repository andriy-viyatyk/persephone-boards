(() => {
  const $=(s)=>document.querySelector(s), t=window.audioPlayerT, bands=[31,62,125,250,500,1000,2000,4000,8000,16000];
  const presetNames=['flat','bass','treble','vocal'];
  function create(initial,onChange,{transitionsEnabled=true}={}) {
    const root=$('#effects-popover'); let state={equalizer:window.AudioEqualizer.normalize(initial.equalizer),crossfadeSeconds:0,gapless:true};
    state.crossfadeSeconds=Math.max(0,Math.min(12,Math.round(Number(initial.crossfadeSeconds||0)*2)/2));state.gapless=initial.gapless!==false;
    const header=document.createElement('header');header.className='effects-popover-header';const title=document.createElement('h2');title.id='effects-popover-title';title.textContent=t('effects.title');
    const close=document.createElement('button');close.type='button';close.className='effects-close';close.title=t('control.close');close.setAttribute('aria-label',t('control.close'));close.textContent='×';header.append(title,close);root.append(header);
    const layout=document.createElement('div');layout.className='effects-layout';
    const eq=document.createElement('section');eq.className='eq-panel';
    const heading=document.createElement('div');heading.className='effects-heading';const eqTitle=document.createElement('strong');eqTitle.textContent=t('effects.equalizer');
    const enabled=document.createElement('label');enabled.className='inline-setting';const enabledInput=document.createElement('input');enabledInput.type='checkbox';const enabledText=document.createElement('span');enabledText.textContent=t('effects.enable');enabled.append(enabledInput,enabledText);
    // Preset chips; none is active once a band is moved by hand (the custom preset). Flat doubles as reset.
    const presetRow=document.createElement('div');presetRow.className='eq-preset-row';presetRow.setAttribute('role','group');presetRow.setAttribute('aria-label',t('effects.preset'));
    const presetChips=presetNames.map((id)=>{const chip=document.createElement('button');chip.type='button';chip.className='eq-preset-chip';chip.dataset.preset=id;chip.textContent=t('effects.preset.'+id);presetRow.append(chip);return chip;});
    heading.append(eqTitle,enabled);eq.append(heading);
    const sliders=document.createElement('div');sliders.className='eq-sliders';
    const inputs=[];bands.forEach((frequency,index)=>{const label=document.createElement('label');label.className='eq-band';const name=document.createElement('span');name.textContent=frequency>=1000?(frequency/1000)+'k':String(frequency);const input=document.createElement('input');input.type='range';input.min='-12';input.max='12';input.step='1';input.orient='vertical';input.setAttribute('aria-label',t('effects.band',{frequency:name.textContent}));const value=document.createElement('output');label.append(name,input,value);sliders.append(label);inputs.push({input,value});});eq.append(presetRow,sliders);layout.append(eq);
    const playback=document.createElement('section');playback.className='playback-effects';playback.innerHTML='';
    const playbackTitle=document.createElement('strong');playbackTitle.textContent=t('effects.playback');playback.append(playbackTitle);
    const crossLabel=document.createElement('label');crossLabel.className='effect-row';const crossText=document.createElement('span');crossText.textContent=t('effects.crossfade');const cross=document.createElement('input');cross.type='range';cross.min='0';cross.max='12';cross.step='0.5';cross.disabled=!transitionsEnabled;const crossValue=document.createElement('output');crossLabel.append(crossText,cross,crossValue);playback.append(crossLabel);
    const gapLabel=document.createElement('label');gapLabel.className='inline-setting';const gap=document.createElement('input');gap.type='checkbox';gap.disabled=!transitionsEnabled;const gapText=document.createElement('span');gapText.textContent=t('effects.gapless');gapLabel.append(gap,gapText);playback.append(gapLabel);
    const hint=document.createElement('p');hint.className='effects-hint';hint.hidden=true;hint.textContent=t('effects.decoderHint');playback.append(hint);layout.append(playback);root.append(layout);
    function refresh(){enabledInput.checked=state.equalizer.enabled;eq.classList.toggle('eq-off',!state.equalizer.enabled);presetChips.forEach((chip)=>{const active=chip.dataset.preset===state.equalizer.preset;chip.classList.toggle('active',active);chip.setAttribute('aria-pressed',String(active));});inputs.forEach(({input,value},i)=>{input.value=state.equalizer.bandsDb[i];value.textContent=(state.equalizer.bandsDb[i]>0?'+':'')+state.equalizer.bandsDb[i]+' dB';});cross.value=state.crossfadeSeconds;crossValue.textContent=state.crossfadeSeconds===0?t('effects.off'):t('effects.seconds',{seconds:state.crossfadeSeconds});gap.checked=state.gapless;}
    function update(){refresh();onChange?.(structuredClone(state));}
    enabledInput.addEventListener('change',()=>{state.equalizer.enabled=enabledInput.checked;update();});
    presetChips.forEach((chip)=>chip.addEventListener('click',()=>{const id=chip.dataset.preset;state.equalizer.preset=id;state.equalizer.bandsDb=[...window.AudioEqualizer.PRESETS[id]];update();}));
    inputs.forEach(({input},i)=>input.addEventListener('input',()=>{state.equalizer.bandsDb[i]=window.AudioEqualizer.clamp(Number(input.value));state.equalizer.preset='custom';update();}));
    cross.addEventListener('input',()=>{state.crossfadeSeconds=Number(cross.value);update();});gap.addEventListener('change',()=>{state.gapless=gap.checked;update();});refresh();
    // A popover anchored to whichever effects button opened it; it closes on Escape or a click elsewhere.
    let anchor=null;
    function place(){if(!anchor||root.hidden)return;const r=anchor.getBoundingClientRect(),gap=6,margin=8;root.style.right=`${Math.max(margin,innerWidth-r.right)}px`;
      const below=innerHeight-r.bottom-gap-margin,above=r.top-gap-margin;
      if(below>=Math.min(root.scrollHeight,320)||below>=above){root.style.top=`${r.bottom+gap}px`;root.style.bottom='';root.style.maxHeight=`${below}px`;}
      else{root.style.bottom=`${innerHeight-r.top+gap}px`;root.style.top='';root.style.maxHeight=`${above}px`;}}
    function setExpanded(value){document.querySelectorAll('.effects-toggle').forEach((button)=>{const open=value&&button===anchor;button.setAttribute('aria-expanded',String(open));button.classList.toggle('active',open);});}
    function open(button){anchor=button;root.hidden=false;setExpanded(true);place();root.querySelector('input,select')?.focus({preventScroll:true});}
    function hide(restoreFocus=false){if(root.hidden)return;root.hidden=true;const previous=anchor;setExpanded(false);anchor=null;if(restoreFocus)previous?.focus();}
    function toggle(button){if(!root.hidden&&anchor===button)hide();else open(button);}
    close.addEventListener('click',()=>hide(true));
    document.addEventListener('pointerdown',(event)=>{if(root.hidden)return;const target=event.target;if(root.contains(target)||target.closest?.('.effects-toggle'))return;hide();},true);
    document.addEventListener('keydown',(event)=>{if(event.key==='Escape'&&!root.hidden){event.preventDefault();hide(true);}});
    window.addEventListener('resize',place);window.addEventListener('blur',()=>hide());
    return {get value(){return structuredClone(state);},refresh,open,close:hide,toggle,get isOpen(){return !root.hidden;}};
  }
  window.AudioPlayerSettings={create};
})();
