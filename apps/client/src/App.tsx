import { AppShell, Badge, Button, Card, EmptyState, PageHeader, TileRow } from '@traverse/ui';

const navigation = [
  { current: true, href: '#today', label: 'Today' },
  { href: '#reflections', label: 'Reflections' },
  { href: '#sessions', label: 'Sessions' },
];

/** Mobile-first client shell. Coach theming can replace only the accent token later. */
export function App() {
  return (
    <AppShell navigation={navigation} productName="Your coaching space" roleLabel="Client">
      <div className="client-dashboard">
        <PageHeader
          eyebrow="Your coaching space"
          summary="A small place to pause, reflect, and keep moving."
          title="Today"
        />
        <Card tone="editorial">
          <Badge tone="accent">From your coach</Badge>
          <h2>What is one thing you want to carry into this week?</h2>
          <p>Take a moment when it suits you. Your reflection stays between you and your coach.</p>
          <Button type="button">Record a reflection</Button>
        </Card>
        <Card>
          <TileRow
            action={<Button variant="quiet">Watch</Button>}
            description="A short welcome from your coach"
            title="Your welcome video"
          />
        </Card>
        <EmptyState
          action={<Button variant="line">See past sessions</Button>}
          title="Your next session is not booked yet"
        >
          When you are ready, choose a time with your coach.
        </EmptyState>
      </div>
    </AppShell>
  );
}
