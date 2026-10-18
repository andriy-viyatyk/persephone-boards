(() => {
  function create(first, onChange, visualizer) {
    const second=document.querySelector('#audio-next'), decks=[first,second], gains=[0,1].map((i)=>visualizer.graph.nodes[i].gain), gapless=window.AudioGapless.create();
    const crossfade=window.AudioCrossfade.create(visualizer.graph.context,()=>{ const old=1-active; decks[old].pause(); decks[old].removeAttribute('src'); decks[old].load(); fading=false; transitioning=false; void preload(); });
    let active=0,current=null,destroyed=false,activationSequence=0,provider=()=>null,settings={crossfadeSeconds:0,gapless:true},preloadPromise=false,preloadSequence=0,fadeTarget=null,muted=false,volume=0.8,fading=false,transitioning=false,transitionSequence=0;
    const eventTypes=['loadstart','loadedmetadata','timeupdate','durationchange','playing','pause','ended','volumechange','error','canplay'];
    const handlers=new Map();
    decks.forEach((audio,index)=>{ const map=new Map(eventTypes.map((type)=>[type,()=>handleEvent(type,index)])); handlers.set(audio,map); map.forEach((fn,type)=>audio.addEventListener(type,fn)); });
    async function resolve(item) { return (await window.persephone.content.open(item.href,{timeoutMs:30000})).url; }
    function cleanupDeck(index) { const a=decks[index]; a.pause(); a.removeAttribute('src'); a.load(); visualizer.setDeckGain(index,0); }
    function cancelTransition() { preloadSequence++; transitionSequence++; fading=false; transitioning=false; crossfade.cancel(gains); gapless.cancel(decks[1-active]); preloadPromise=null; fadeTarget=null; visualizer.setDeckGain(active,1); visualizer.setDeckGain(1-active,0); }
    function activate(index,item) { const old=active; active=index; current=item; visualizer.setDeckGain(active,1); if(old!==active) visualizer.setDeckGain(old,0); onChange('track',{...item,activationId:++activationSequence,audio:decks[active]}); }
    async function preload() {
      if(destroyed || fading || transitioning || preloadPromise || gapless.pending || (!settings.gapless && !settings.crossfadeSeconds)) return;
      const next=provider(); if(!next?.item || next.index===undefined) return;
      const spare=1-active, token=++preloadSequence; preloadPromise=true;
      try {
        const loaded=await gapless.preload(decks[spare],next.item,resolve);
        if(destroyed||token!==preloadSequence||!loaded)return;
        fadeTarget={...next,deck:spare}; visualizer.setDeckGain(spare,0);
      } catch(error) { onChange('preloadFailure',{item:next.item,error}); }
      finally { if(token===preloadSequence)preloadPromise=false; }
    }
    async function transition({fade=false}={}) {
      const ready=gapless.pending; if(!ready || !fadeTarget || ready.item.href!==fadeTarget.item.href) return false;
      const next=fadeTarget, old=active, outgoing=decks[old], incoming=decks[next.deck], token=++transitionSequence;
      gapless.consume(); fadeTarget=null;
      try {
        if(settings.crossfadeSeconds>0 && fade) {
          transitioning=true; fading=true; visualizer.setDeckGain(next.deck,0); await incoming.play(); if(token!==transitionSequence||destroyed){cleanupDeck(next.deck);return false;} active=next.deck; current=next.item; onChange('track',{...next.item,queueIndex:next.index,activationId:++activationSequence,audio:incoming}); crossfade.schedule(gains[old],gains[next.deck],settings.crossfadeSeconds);
        } else {
          transitioning=true; await incoming.play(); if(token!==transitionSequence||destroyed){cleanupDeck(next.deck);return false;} activate(next.deck,next.item); outgoing.pause(); cleanupDeck(old); transitioning=false; void preload();
        }
        return true;
      } catch(error) { if(token!==transitionSequence||destroyed)return false; transitioning=false; fading=false; cleanupDeck(next.deck); visualizer.setDeckGain(old,1); onChange('failure',{item:next.item,error}); return false; }
    }
    function handleEvent(type,index) {
      const audio=decks[index]; if(index!==active) return;
      if(type==='timeupdate') {
        void preload();
        onChange(type,{audio,currentTime:audio.currentTime,duration:audio.duration});
        if(settings.crossfadeSeconds>0 && fadeTarget && Number.isFinite(audio.duration) && audio.duration-audio.currentTime<=settings.crossfadeSeconds) void transition({fade:true});
        return;
      }
      if(type==='ended') {
        if(gapless.pending && fadeTarget && settings.gapless) { void transition({fade:false}).then((ok)=>{if(!ok)onChange('ended',{audio});}); }
        else onChange('ended',{audio}); return;
      }
      if(type==='error') { onChange(type,{audio,error:audio.error}); return; }
      onChange(type,{audio});
      if(type==='loadedmetadata'||type==='canplay') void preload();
    }
    async function play(item, initialStream=false) {
      if(!item?.href||destroyed)return;
      cancelTransition(); const deck=active, audio=decks[deck]; current=item; audio.pause(); audio.removeAttribute('src'); audio.load(); visualizer.setDeckGain(deck,1);
      try { const url=initialStream?await window.persephone.host.streamUrl():await resolve(item); if(destroyed||current!==item)return; audio.src=url; await audio.play(); activate(deck,item); void preload(); }
      catch(error){onChange('failure',{item,error});}
    }
    return {
      play,get current(){return current;},get audio(){return decks[active];},get currentTime(){return decks[active].currentTime;},get duration(){return decks[active].duration;},get paused(){return decks[active].paused;},get decks(){return decks;},get context(){return visualizer.graph.context;},
      setNextProvider(fn){provider=fn;cancelTransition();void preload();}, setTransitionSettings(value){settings={crossfadeSeconds:Math.max(0,Math.min(12,Math.round(Number(value.crossfadeSeconds||0)*2)/2)),gapless:value.gapless!==false};cancelTransition();void preload();},
      cancelTransition, refreshNext(){if(transitioning||fading)return;const next=provider();const href=next?.item?.href;if((gapless.pending?.item?.href===href)||(fadeTarget?.item?.href===href))return;cancelTransition();void preload();}, updateCurrent(patch){if(!current||(patch?.href&&patch.href!==current.href))return false;current={...current,...patch};onChange('metadata',current);return true;},
      setVolume(value){volume=Math.max(0,Math.min(1,Number(value)||0));visualizer.setMaster(volume,muted);},setMuted(value){muted=!!value;visualizer.setMaster(volume,muted);},get muted(){return muted;},
      seek(value){cancelTransition();visualizer.setDeckGain(active,1);visualizer.setDeckGain(1-active,0);const audio=decks[active];if(Number.isFinite(audio.duration))audio.currentTime=Math.max(0,Math.min(audio.duration,value));},resume(){return decks[active].play();},pause(){cancelTransition();decks.forEach((audio,index)=>{if(index!==active)audio.pause();});visualizer.setDeckGain(active,1);decks[active].pause();},toggle(){if(decks[active].paused)decks[active].play().catch((error)=>onChange('failure',{item:current,error}));else decks[active].pause();},
      destroy(){destroyed=true;cancelTransition();for(const audio of decks){for(const[type,fn]of handlers.get(audio))audio.removeEventListener(type,fn);audio.pause();audio.removeAttribute('src');audio.load();}current=null;}
    };
  }
  window.AudioPlayer={create};
})();
