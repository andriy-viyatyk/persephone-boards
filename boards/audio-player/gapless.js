(() => {
  function create() {
    let token=0, pending=null;
    return {
      async preload(deck,item,open) { const id=++token; pending=null; deck.pause(); deck.removeAttribute('src'); deck.load();
        try { const url=await open(item); if(id!==token) return null; deck.src=url; deck.load(); await new Promise((resolve,reject)=>{ if(deck.readyState>=HTMLMediaElement.HAVE_FUTURE_DATA) return resolve(); const ok=()=>{clean();resolve();}, bad=()=>{clean();reject(deck.error||new Error('decode'));}, aborted=()=>{clean();resolve();}, clean=()=>{deck.removeEventListener('canplay',ok);deck.removeEventListener('error',bad);deck.removeEventListener('abort',aborted);}; deck.addEventListener('canplay',ok,{once:true}); deck.addEventListener('error',bad,{once:true}); deck.addEventListener('abort',aborted,{once:true}); }); if(id!==token) return null; pending={item,id,deck}; return pending; }
        catch(error){ if(id===token) pending=null; throw error; }
      }, get pending(){return pending;}, cancel(deck){token++;pending=null;if(deck){deck.pause();deck.removeAttribute('src');deck.load();}}, consume(){const value=pending;pending=null;return value;}
    };
  }
  window.AudioGapless = {create};
})();
