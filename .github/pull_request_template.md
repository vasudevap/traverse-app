## Summary

Describe the user-visible or operational outcome and why it is needed.

## Delivery scope

- Application surfaces changed:
- API deployment required: Yes / No
- Static-app deployment required: Yes / No
- Database or infrastructure change: Yes / No
- Private documentation follow-up required: Yes / No

## Validation

List the focused checks and the complete local verification results.

## NonProd verification

- [ ] The change is implemented in `traverse-app`, not only in a mockup or specification.
- [ ] Automated regression coverage protects the changed behavior.
- [ ] The required API and/or static deployment completed successfully.
- [ ] The deployed revision matches this merged commit.
- [ ] The affected behavior was retested on the public staging hostname.
- [ ] The PR number, commit SHA, deployment run IDs, verification date, and result are
      ready for the private documentation update.

Until every applicable item is complete, use the precise delivery status from
`AGENTS.md` instead of calling the change fixed or closed.
