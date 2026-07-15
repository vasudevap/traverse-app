import { AppShell, Badge, Button, Card, PageHeader, TileRow } from '@traverse/ui';

const navigation = [
  { current: true, href: '#overview', label: 'Overview' },
  { href: '#practices', label: 'Practices' },
  { href: '#operations', label: 'Operations' },
  { href: '#support', label: 'Support' },
];

/** Platform-owner-only shell. It does not expose coaching or client routes. */
export function App() {
  return (
    <AppShell navigation={navigation} productName="Admin Portal" roleLabel="Admin">
      <PageHeader
        actions={<Button variant="line">View operational guide</Button>}
        eyebrow="Platform operations"
        summary="A calm operational surface for the people running Traverse."
        title="System overview"
      />
      <Card tone="trust">
        <div className="trv-eyebrow">Foundation status</div>
        <h2>NonProd services are healthy.</h2>
        <p>Production remains a separately authorized operation.</p>
        <Badge tone="mark">Operations boundary active</Badge>
      </Card>
      <Card>
        <TileRow
          action={<Button variant="quiet">Review</Button>}
          description="No current incidents"
          title="Operational health"
        />
        <TileRow
          action={<Button variant="quiet">Open</Button>}
          description="Approvals and audit events land here"
          title="Platform controls"
        />
      </Card>
    </AppShell>
  );
}
