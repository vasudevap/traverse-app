export type MissingIntakeWaitingCopy = {
  badge: string;
  body: string;
  support: string;
  title: string;
};

export function missingIntakeWaitingCopy(coachName: string): MissingIntakeWaitingCopy {
  const coach = coachName.trim() || 'Your coach';
  return {
    badge: 'Next step pending',
    body: `Thank you for accepting your coaching agreement. ${coach} will be in touch when your next step is ready.`,
    support: 'Have a question in the meantime? Please contact your coach.',
    title: "You're all set for now.",
  };
}
