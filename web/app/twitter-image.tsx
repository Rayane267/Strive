import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Strive — Sache. Décide. Gagne.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function TwitterImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px',
          background:
            'radial-gradient(900px 500px at 75% -10%, rgba(0,230,118,0.22), transparent 60%), #0A120E',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div
            style={{
              width: '72px',
              height: '72px',
              borderRadius: '20px',
              background: '#00E676',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 40px rgba(0,230,118,0.5)',
            }}
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
              <path d="M13 2L4.5 13.5H11l-1 8.5L19.5 10H13l0-8z" fill="#05140c" />
            </svg>
          </div>
          <div style={{ fontSize: '44px', fontWeight: 800, color: '#fff' }}>Strive</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              fontSize: '108px',
              fontWeight: 900,
              lineHeight: 1.02,
              color: '#fff',
              letterSpacing: '-3px',
              display: 'flex',
              flexWrap: 'wrap',
            }}
          >
            Sache. Décide.&nbsp;<span style={{ color: '#00E676' }}>Gagne.</span>
          </div>
          <div style={{ marginTop: '28px', fontSize: '34px', color: '#8F9B96', maxWidth: '900px' }}>
            Scanne chaque offre VTC en 2 secondes et vois ton €/h réel avant d&apos;accepter.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {['Uber', 'Bolt', 'Heetch'].map((a) => (
            <div
              key={a}
              style={{
                padding: '12px 24px',
                borderRadius: '999px',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#8F9B96',
                fontSize: '26px',
                fontWeight: 600,
                display: 'flex',
              }}
            >
              {a}
            </div>
          ))}
          <div style={{ flex: 1 }} />
          <div style={{ color: '#00E676', fontSize: '26px', fontWeight: 700, display: 'flex' }}>
            3 jours gratuits
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
