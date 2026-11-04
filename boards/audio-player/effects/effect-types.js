(() => {
  window.AudioPlayerEffects = {
    create(type) {
      if (type === "bars") return new window.AudioBarsEffect();
      if (type === "circular") return new window.AudioCircularEffect();
      if (type === "instruments") return new window.AudioInstrumentsEffect();
      return null;
    },
  };
})();
