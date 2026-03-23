export function StudioHero() {
  return (
    <section className="hero-card hero-card--modern" aria-labelledby="hero-title">
      <div className="hero-card-glow" aria-hidden />
      <div className="hero-card-inner">
        <div className="hero-kicker">
          <span className="hero-badge">Local-first</span>
          <span className="hero-badge hero-badge--muted">Tauri · Worker Python</span>
        </div>

        <h1 id="hero-title" className="hero-title">
          <span className="hero-title-brand">LingWhistX</span>
          <span className="hero-title-studio">Studio</span>
        </h1>

        <p className="hero-tagline">
          Transcription et analyse vocale sur ton poste — tout reste local.
        </p>

        <p className="hero-lead">
          WhisperX : alignement forcé, diarization, timeline et exports data-science — sans envoyer
          tes médias au cloud.
        </p>

        <div className="hero-feature-grid" role="list">
          <article className="hero-feature-card" role="listitem">
            <div className="hero-feature-icon hero-feature-icon--lock" aria-hidden />
            <h2 className="hero-feature-title">Données locales</h2>
            <p className="hero-feature-text">Fichiers et modèles sur ta machine.</p>
          </article>
          <article className="hero-feature-card" role="listitem">
            <div className="hero-feature-icon hero-feature-icon--wave" aria-hidden />
            <h2 className="hero-feature-title">Waveform & édition</h2>
            <p className="hero-feature-text">Segments, timings, transcript intégré.</p>
          </article>
          <article className="hero-feature-card" role="listitem">
            <div className="hero-feature-icon hero-feature-icon--export" aria-hidden />
            <h2 className="hero-feature-title">Exports riches</h2>
            <p className="hero-feature-text">JSON, CSV, SRT, VTT et plus.</p>
          </article>
        </div>
      </div>
    </section>
  );
}
