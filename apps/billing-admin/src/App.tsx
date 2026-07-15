import { AppShell, Badge, Button, Card, PageHeader, TileRow } from '@traverse/ui';

const navigation = [
  { current: true, href: '#clients', label: 'Sponsored clients' },
  { href: '#invoices', label: 'Invoices' },
  { href: '#settings', label: 'Organisation settings' },
];

/** Billing-admin-only shell. Decision A12 keeps this separate from coaching routes. */
export function App() {
  return (
    <AppShell navigation={navigation} productName="Billing Admin App" roleLabel="Billing admin">
      <PageHeader
        actions={<Button type="button">View invoices</Button>}
        eyebrow="Billing workspace"
        summary="Financial visibility for the clients your organisation sponsors."
        title="Sponsored clients"
      />
      <Card>
        <TileRow
          action={<Badge tone="accent">Ready</Badge>}
          description="Client mapping and invoice activity will appear here."
          title="Client sponsorships"
        />
        <TileRow
          action={<Button variant="quiet">Billing details</Button>}
          description="Your organisation's payer profile is managed separately."
          title="Organisation settings"
        />
      </Card>
    </AppShell>
  );
}
