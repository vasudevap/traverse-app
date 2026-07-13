import { tokens } from '@traverse/ui';

/** Admin Portal shell (A12: this app contains only Admin Portal routes). Real UI lands per stage. */
export function App() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: tokens.surface,
        color: tokens.text,
        fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontSize: 14,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: tokens.textSecondary,
          }}
        >
          Traverse
        </div>
        <h1 style={{ margin: '8px 0 4px' }}>Admin Portal</h1>
        <p style={{ color: tokens.textSecondary }}>Shell deployed. The journey starts here.</p>
      </div>
    </main>
  );
}
