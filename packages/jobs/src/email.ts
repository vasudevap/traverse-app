export interface EmailDeliveryJob {
  entityId: string;
  from: string;
  html: string;
  notificationId: string;
  recipientId: string;
  replyTo?: string;
  subject: string;
  text: string;
  to: string;
}

export interface ResendEmailSender {
  send(job: EmailDeliveryJob): Promise<{ id: string }>;
}

export class EmailJobValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailJobValidationError';
  }
}

export class ResendDeliveryError extends Error {
  constructor(readonly status: number) {
    super(`Resend rejected the email request with HTTP ${status}.`);
    this.name = 'ResendDeliveryError';
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new EmailJobValidationError(`Email job ${label} is required.`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new EmailJobValidationError(
      `Email job ${label} must be a non-empty string when present.`,
    );
  }
  return value;
}

/** Reject malformed queue data before a worker can make an external send. */
export function parseEmailDeliveryJob(value: unknown): EmailDeliveryJob {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EmailJobValidationError('Email job payload must be an object.');
  }

  const input = value as Record<string, unknown>;
  return {
    entityId: requiredString(input.entityId, 'entityId'),
    from: requiredString(input.from, 'from'),
    html: requiredString(input.html, 'html'),
    notificationId: requiredString(input.notificationId, 'notificationId'),
    recipientId: requiredString(input.recipientId, 'recipientId'),
    replyTo: optionalString(input.replyTo, 'replyTo'),
    subject: requiredString(input.subject, 'subject'),
    text: requiredString(input.text, 'text'),
    to: requiredString(input.to, 'to'),
  };
}

/**
 * The Terraform-injected secret is the scoped Resend key itself. It is parsed here
 * rather than logged or copied into application configuration.
 */
export function resendApiKey(rawSecret: string | undefined): string {
  if (rawSecret === undefined || !rawSecret.startsWith('re_')) {
    throw new Error('RESEND_SECRET must contain a scoped Resend API key.');
  }
  return rawSecret;
}

export function createResendEmailSender(
  apiKey: string,
  fetchImplementation: typeof fetch = fetch,
): ResendEmailSender {
  return {
    async send(job) {
      const response = await fetchImplementation('https://api.resend.com/emails', {
        body: JSON.stringify({
          from: job.from,
          html: job.html,
          reply_to: job.replyTo,
          subject: job.subject,
          text: job.text,
          to: [job.to],
        }),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });

      if (!response.ok) {
        throw new ResendDeliveryError(response.status);
      }

      const body: unknown = await response.json();
      if (
        typeof body !== 'object' ||
        body === null ||
        typeof (body as { id?: unknown }).id !== 'string'
      ) {
        throw new Error('Resend email response did not contain a message id.');
      }
      return { id: (body as { id: string }).id };
    },
  };
}
