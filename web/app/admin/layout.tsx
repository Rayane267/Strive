import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Admin — Strive',
  robots: { index: false, follow: false },
};

// Page authentifiée : pas de génération statique.
export const dynamic = 'force-dynamic';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
