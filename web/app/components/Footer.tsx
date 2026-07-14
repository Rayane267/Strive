import Logo from './Logo';

export default function Footer() {
  return (
    <footer className="glass-soft relative z-10 mt-8 border-t border-line">
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8">
        <div className="flex flex-col gap-12 md:flex-row md:justify-between">
          <div className="max-w-xs">
            <Logo />
            <p className="mt-5 text-sm leading-relaxed text-muted">
              L&apos;instrument du chauffeur VTC. Sache avant d&apos;accepter, décide vite, gagne plus.
            </p>
            <p className="mt-6 font-mono text-[11px] uppercase tracking-widest text-faint">
              Sache · Décide · Gagne
            </p>
          </div>

          <div className="grid grid-cols-2 gap-12 sm:grid-cols-3">
            <FooterCol title="Produit" links={[
              { label: 'Fonctions', href: '#features' },
              { label: 'Méthode', href: '#how' },
              { label: 'Tarifs', href: '#pricing' },
              { label: 'FAQ', href: '#faq' },
            ]} />
            <FooterCol title="Société" links={[
              { label: 'Support', href: 'mailto:contact@striveapp.fr' },
              { label: 'Contact', href: 'mailto:contact@striveapp.fr' },
            ]} />
            <FooterCol title="Légal" links={[
              { label: 'Confidentialité', href: '/privacy' },
              { label: 'CGU', href: '/terms' },
            ]} />
          </div>
        </div>

        <div className="mt-14 flex flex-col items-center justify-between gap-3 border-t border-line pt-6 font-mono text-[11px] uppercase tracking-widest text-faint sm:flex-row">
          <p>© {new Date().getFullYear()} Strive</p>
          <p>Conçu pour les chauffeurs VTC</p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <h4 className="font-mono text-[11px] uppercase tracking-widest text-faint">{title}</h4>
      <ul className="mt-5 space-y-3">
        {links.map((l) => (
          <li key={l.label}>
            <a href={l.href} className="text-sm text-muted transition-colors hover:text-signal">
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
