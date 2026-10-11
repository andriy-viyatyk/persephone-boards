(() => {
  function create(context, onComplete) {
    let generation=0, timer=0;
    function cancel(gains) { generation++; clearTimeout(timer); timer=0; for(const gain of gains||[]) { try { gain.gain.cancelScheduledValues(context.currentTime); } catch {} } }
    function schedule(outGain,inGain,seconds) {
      cancel([outGain,inGain]); if (!(seconds>0)) return false;
      const id=generation, now=context.currentTime, end=now+seconds;
      outGain.gain.cancelScheduledValues(now); inGain.gain.cancelScheduledValues(now);
      outGain.gain.setValueAtTime(outGain.gain.value,now); inGain.gain.setValueAtTime(inGain.gain.value,now);
      outGain.gain.linearRampToValueAtTime(0,end); inGain.gain.linearRampToValueAtTime(1,end);
      timer=setTimeout(()=>{ if(id===generation) onComplete?.(); },seconds*1000);
      return true;
    }
    return {schedule,cancel};
  }
  window.AudioCrossfade = {create};
})();
