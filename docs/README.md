# RouteLanka documentation

| Document | What it covers |
|---|---|
| [Architecture](architecture.md) | The main components and how they talk; the night end to end (sequence diagram); who can do what; deployment; how a decision travels; reliability rules; demo days |
| [Data model](data-model.md) | Entity relationship diagrams (an overview, then each area with its columns and keys) and every table, grouped as reference data, people and access, day data, and messaging |
| [WhatsApp integration](whatsapp.md) | Messages, reply buttons and webhooks through the WhatsApp Business Platform; stores connecting their own number; going live on Meta |
| [AI tool disclosure](ai-disclosure.md) | Which work was AI-assisted, which was not, and how the tools were used |

## Diagrams as images

The diagrams are written in Mermaid, which GitHub renders in place. The same diagrams are exported to
[`diagrams/`](diagrams/) as SVG and PNG for any other viewer:

| Diagram | Image |
|---|---|
| System components | [`architecture--components`](diagrams/architecture--components.svg) |
| The night, end to end (sequence) | [`architecture--the-night-end-to-end`](diagrams/architecture--the-night-end-to-end.svg) |
| Deployment (Docker Compose) | [`architecture--deployment`](diagrams/architecture--deployment.svg) |
| ER overview | [`data-model--entity-relationship-overview`](diagrams/data-model--entity-relationship-overview.svg) |
| ER: reference data and people | [`data-model--reference-data-and-people`](diagrams/data-model--reference-data-and-people.svg) |
| ER: one delivery night | [`data-model--one-delivery-night-day-data`](diagrams/data-model--one-delivery-night-day-data.svg) |
| ER: messaging, WhatsApp and audit | [`data-model--messaging-whatsapp-and-audit`](diagrams/data-model--messaging-whatsapp-and-audit.svg) |
| WhatsApp message flow | [`whatsapp--how-it-works`](diagrams/whatsapp--how-it-works.svg) |

After changing a diagram, regenerate the images with `python docs/diagrams/render.py` (needs Playwright).
