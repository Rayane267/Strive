import Header from './components/Header';
import Footer from './components/Footer';
import Reveal from './components/Reveal';
import ScanShowcase from './components/ScanShowcase';
import Pricing from './components/Pricing';
import Faq from './components/Faq';

const features = [
  { k: '01', title: 'Scan en 2 secondes', desc: 'Capture l\'offre, Strive la lit par OCR et rend son verdict — sans quitter ton app VTC.' },
  { k: '02', title: 'Trafic en temps réel', desc: 'Ton €/h calculé sur le vrai temps de trajet — embouteillages et temps d\'approche inclus. Pas une estimation à vol d\'oiseau.' },
  { k: '03', title: 'Refuse les pièges', desc: 'Les courses qui te font perdre du temps sont marquées rouge avant que tu acceptes.' },
  { k: '04', title: 'Tes seuils, tes règles', desc: 'Fixe ton €/h et €/km minimum. Strive trie automatiquement selon TES critères.' },
  { k: '05', title: 'Coût carburant par modèle', desc: 'Net après essence calculé selon la conso réelle de ton véhicule.' },
  { k: '06', title: 'Historique & stats', desc: 'Gains par jour, taux d\'acceptation, plateformes les plus rentables. Tout est suivi.' },
];

const steps = [
  { n: '01', t: 'Une offre tombe', d: 'Une course s\'affiche sur Uber, Bolt ou Heetch.' },
  { n: '02', t: 'Tu déclenches', d: 'Sur iPhone, tape le bouton AssistiveTouch ; sur Android, tape la bulle Strive. Strive lit l\'écran.' },
  { n: '03', t: 'Le verdict tombe', d: 'Vert = prends. Rouge = laisse. Avec ton €/h, €/km et le total, instantané.' },
];

const marquee = ['Uber', '€/h en direct', 'Bolt', 'Trafic temps réel', 'Scan 2s', 'Heetch', 'Sans engagement', 'Aucune pub'];

export default function Home() {
  return (
    <main id="top" className="relative">
      <div className="aurora-mesh" />
      <Header />

      {/* ───────────────── HERO ───────────────── */}
      <section className="hero-bg relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-5 pb-24 pt-32 text-center">
        <div className="grid-lines pointer-events-none absolute inset-0 opacity-20" />

        <div className="relative z-10 flex flex-col items-center">
          <div className="load-up" style={{ animationDelay: '40ms' }}>
            <span className="glass inline-flex items-center gap-2.5 rounded-full px-4 py-1.5 text-[12px] tracking-wide text-muted">
              <span className="live-dot" />
              <span className="text-fg">Sache</span> · Décide · Gagne
            </span>
          </div>

          <h1
            className="load-up mx-auto mt-7 max-w-4xl font-display text-[3rem] font-extrabold leading-[0.9] tracking-[-0.025em] sm:text-[5.6rem]"
            style={{ animationDelay: '140ms' }}
          >
            La bonne course,<br />
            au bon{' '}
            <span className="font-serif font-normal italic text-signal text-signal-glow">prix.</span>
          </h1>

          <p
            className="load-up mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg"
            style={{ animationDelay: '240ms' }}
          >
            Strive scanne chaque offre Uber, Bolt et Heetch en
            <span className="text-fg"> 2 secondes</span> et te donne ton
            <span className="text-fg"> €/h réel</span>, <span className="text-fg">trafic en temps réel inclus</span>, avant que tu acceptes.
          </p>

          <div
            id="download"
            className="load-up mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
            style={{ animationDelay: '340ms' }}
          >
            <StoreBadge store="apple" />
            <StoreBadge store="google" />
          </div>

          <div
            className="load-up mt-7 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.16em] text-faint"
            style={{ animationDelay: '440ms' }}
          >
            <span>iOS &amp; Android</span>
            <span className="text-line">·</span>
            <span>7 jours gratuits</span>
            <span className="text-line">·</span>
            <span>sans engagement</span>
          </div>
        </div>

        {/* Indice de scroll */}
        <div className="load-up absolute bottom-7 left-1/2 -translate-x-1/2" style={{ animationDelay: '640ms' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-float text-faint"><path d="M12 5v14M6 13l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
      </section>

      {/* ───────────────── DÉMO (révélée au scroll) ───────────────── */}
      <section className="showcase-stage relative overflow-hidden px-5 py-24 sm:py-28">
        <div className="grid-lines pointer-events-none absolute inset-0 opacity-20" />
        <Reveal className="relative mx-auto max-w-2xl text-center">
          <span className="eyebrow">01 — Le verdict</span>
          <h2 className="mx-auto mt-5 max-w-md font-display text-4xl font-bold leading-[1.05] tracking-[-0.02em] sm:text-5xl">
            Un coup d&apos;œil suffit.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-muted">
            Une course arrive, tu scannes, le verdict tombe. Essaie la démo.
          </p>
        </Reveal>
        <div className="relative mt-14 flex justify-center">
          <div className="absolute left-1/2 top-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-signal/12 blur-[90px]" />
          <div className="relative">
            <ScanShowcase />
          </div>
        </div>
      </section>

      {/* Marquee glass */}
      <div className="glass-soft relative overflow-hidden py-4">
        <div className="marquee-track">
          {[...marquee, ...marquee].map((m, i) => (
            <span key={i} className="flex items-center">
              <span className="px-7 font-mono text-xs uppercase tracking-[0.2em] text-muted">{m}</span>
              <span className="text-signal/40">◇</span>
            </span>
          ))}
        </div>
      </div>

      {/* ───────────────── FEATURES (bento glass) ───────────────── */}
      <section id="features" className="relative z-10 mx-auto max-w-7xl scroll-mt-28 px-5 py-32 sm:px-8">
        <Reveal className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <span className="eyebrow">02 — Fonctions</span>
            <h2 className="mt-5 max-w-xl font-display text-4xl font-bold leading-[1.05] tracking-[-0.02em] sm:text-[3.4rem]">
              Un cockpit pour rouler rentable.
            </h2>
          </div>
          <p className="max-w-xs text-sm leading-relaxed text-muted">
            Chaque fonction sert un seul but : que tu ne prennes plus jamais une course qui te coûte.
          </p>
        </Reveal>
        <div className="rule-fade mt-10" />

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => (
            <Reveal key={f.k} delay={(i % 3) * 80} className={i === 0 ? 'sm:col-span-2 lg:col-span-1' : ''}>
              <div className="glass card-rise group flex h-full flex-col rounded-3xl p-8">
                <div className="flex items-center justify-between">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-signal/10 font-mono text-xs tracking-widest text-signal ring-1 ring-signal/20">
                    {f.k}
                  </span>
                  <span className="h-px w-8 bg-line transition-all duration-500 group-hover:w-14 group-hover:bg-signal/60" />
                </div>
                <h3 className="mt-7 font-display text-xl font-bold">{f.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted">{f.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ───────────────── HOW IT WORKS ───────────────── */}
      <section id="how" className="relative z-10 scroll-mt-28 overflow-hidden py-32">
        <div className="grid-lines pointer-events-none absolute inset-0 opacity-25" />
        <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
          <Reveal className="text-center">
            <span className="eyebrow">03 — Méthode</span>
            <h2 className="mx-auto mt-5 max-w-2xl font-display text-4xl font-bold leading-[1.05] tracking-[-0.02em] sm:text-[3.4rem]">
              Trois temps. Zéro friction.
            </h2>
          </Reveal>

          <div className="relative mt-16 grid gap-4 md:grid-cols-3">
            {/* Filet connecteur */}
            <div className="absolute left-0 right-0 top-[4.5rem] hidden h-px bg-gradient-to-r from-transparent via-signal/30 to-transparent md:block" />
            {steps.map((s, i) => (
              <Reveal key={s.n} delay={i * 120}>
                <div className="glass card-rise relative h-full rounded-3xl p-9">
                  <span className="relative z-10 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-canvas font-mono text-sm font-bold text-signal ring-1 ring-signal/25">
                    {s.n}
                  </span>
                  <h3 className="mt-6 font-display text-2xl font-bold">{s.t}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted">{s.d}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────────── STATS ───────────────── */}
      <section className="relative z-10 mx-auto max-w-7xl px-5 py-12 sm:px-8">
        <div className="glass grid divide-y divide-white/[0.06] overflow-hidden rounded-3xl sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {[
            { v: '2,0s', l: 'pour analyser une offre' },
            { v: '15', l: 'scans par jour avec Plus' },
            { v: '3', l: 'plateformes prises en charge' },
          ].map((s, i) => (
            <Reveal key={s.l} delay={i * 100}>
              <div className="px-8 py-14 text-center">
                <div className="font-display text-6xl font-extrabold tracking-tight text-signal text-signal-glow">{s.v}</div>
                <p className="mt-3 text-sm text-muted">{s.l}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <Pricing />
      <Faq />

      {/* ───────────────── FINAL CTA ───────────────── */}
      <section className="relative z-10 mx-auto max-w-7xl px-5 pb-32 sm:px-8">
        <Reveal>
          <div className="glass ring-signal relative overflow-hidden rounded-[2.5rem] p-10 text-center sm:p-20">
            <div className="aurora pointer-events-none absolute inset-0" />
            <div className="grid-lines pointer-events-none absolute inset-0 opacity-30" />
            <div className="relative">
              <span className="eyebrow">Prêt à rouler</span>
              <h2 className="mx-auto mt-6 max-w-2xl font-display text-4xl font-extrabold leading-[1.02] tracking-[-0.02em] sm:text-6xl">
                Arrête de deviner.<br />
                <span className="font-serif font-normal italic text-signal text-signal-glow">Commence à gagner.</span>
              </h2>
              <p className="mx-auto mt-6 max-w-md text-muted">
                Rejoins les chauffeurs qui ne prennent plus une course non rentable. Essai gratuit
                7 jours, sans engagement.
              </p>
              <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <StoreBadge store="apple" />
                <StoreBadge store="google" />
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      <Footer />
    </main>
  );
}

function StoreBadge({ store }: { store: 'apple' | 'google' }) {
  const isApple = store === 'apple';
  return (
    <a
      href="#"
      className="store-badge glass group flex items-center gap-3 rounded-2xl px-5 py-3"
    >
      {isApple ? (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" className="text-fg">
          <path d="M17.05 12.04c-.03-2.6 2.12-3.84 2.21-3.9-1.2-1.76-3.08-2-3.75-2.03-1.6-.16-3.12.94-3.93.94-.81 0-2.06-.92-3.39-.89-1.74.03-3.35 1.01-4.25 2.57-1.81 3.14-.46 7.78 1.3 10.33.86 1.25 1.89 2.65 3.23 2.6 1.3-.05 1.79-.84 3.36-.84 1.57 0 2.01.84 3.39.81 1.4-.02 2.29-1.27 3.15-2.53 1-1.45 1.41-2.86 1.43-2.93-.03-.01-2.74-1.05-2.77-4.17zM14.62 4.47c.72-.87 1.2-2.08 1.07-3.29-1.03.04-2.28.69-3.02 1.56-.66.77-1.24 2-1.08 3.18 1.15.09 2.32-.58 3.03-1.45z" />
        </svg>
      ) : (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" className="text-signal">
          <path d="M3.6 2.3c-.2.2-.3.5-.3.9v17.6c0 .4.1.7.3.9l.1.1 9.9-9.9v-.2L3.6 2.3zM17.1 15.3l-3.3-3.3 3.3-3.3 4 2.3c1.1.6 1.1 1.7 0 2.3l-4 2zM13.4 12l-9.3 9.3c.4.4 1 .4 1.7 0l11-6.3-3.4-3zM5.8 2.4l7.6 7.6 3.4-3L6.5 2.4c-.7-.4-1.3-.4-1.7 0z" />
        </svg>
      )}
      <span className="text-left leading-tight">
        <span className="block font-mono text-[9px] uppercase tracking-widest text-muted">
          {isApple ? 'Sur l\'' : 'Sur '}
        </span>
        <span className="block font-display text-sm font-bold">{isApple ? 'App Store' : 'Google Play'}</span>
      </span>
    </a>
  );
}
