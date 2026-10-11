(() => {
  function create(store) {
    let lastActivationId = 0;
    return {
      record(activationId, track) {
        if (!Number.isFinite(activationId) || activationId <= lastActivationId || !track?.id) return false;
        lastActivationId = activationId;
        void store.incrementPlay(track.id, new Date().toISOString()).catch((error) => console.warn("Could not record play", error));
        return true;
      },
      reset() { lastActivationId = 0; },
    };
  }
  window.AudioPlayCounts = { create };
})();
