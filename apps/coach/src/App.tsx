import { AppShell, Badge, Button, Card, PageHeader, TileRow } from '@traverse/ui';

const navigation = [
  { current: true, href: '#dashboard', label: 'Dashboard' },
  { href: '#clients', label: 'Clients' },
  { href: '#calendar', label: 'Calendar' },
  { href: '#library', label: 'Library' },
];

/** Coach-only shell. Shared UI primitives replace the earlier deployment placeholder. */
export function App() {
  return (
    <AppShell navigation={navigation} productName="Coach App" roleLabel="Coach">
      <PageHeader
        actions={<Button type="button">Invite a client</Button>}
        eyebrow="Coach workspace"
        summary="Start with the next meaningful move for each client."
        title="Good morning, Maya"
      />
      <div className="coach-dashboard">
        <Card>
          <div className="trv-eyebrow">Up next</div>
          <TileRow
            action={<Button variant="quiet">Prepare</Button>}
            description="Reflection shared yesterday"
            title="Jordan Lee"
          />
          <TileRow
            action={<Button variant="quiet">Review</Button>}
            description="Session notes ready for you"
            title="Amelia Chen"
          />
          <TileRow
            action={<Button variant="quiet">Continue</Button>}
            description="Draft welcome message"
            title="New client onboarding"
          />
        </Card>
        <Card tone="trust">
          <div className="trv-eyebrow">Practice rhythm</div>
          <h2>Quiet structure, clear care.</h2>
          <p>Your client space is ready for the next coaching moment.</p>
          <Badge tone="mark">3 reflections this week</Badge>
        </Card>
      </div>
    </AppShell>
  );
}
