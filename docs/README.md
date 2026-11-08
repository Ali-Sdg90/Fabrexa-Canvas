# Fabrexa Canvas documentation

This directory contains the technical and operational documentation for
Fabrexa Canvas. The root [README](../README.md) introduces the project and its
engineering highlights; the guides here provide the implementation details
needed to configure, maintain, and extend it.

## Guides

| Guide | Use it when you need to |
| --- | --- |
| [Setup](./setup.md) | Install the project, export a workflow, and complete the first run |
| [Configuration](./configuration.md) | Understand environment variables, defaults, and validation rules |
| [Architecture](./architecture.md) | Follow component responsibilities and request lifecycles |
| [Development and releases](./development.md) | Change code, run checks, and understand CI/CD |
| [Operations](./operations.md) | Start, inspect, back up, and troubleshoot the local bot |
| [Security and privacy](./security.md) | Review the trust model and sensitive-data boundaries |
| [Changelog](../CHANGELOG.md) | Review changes included in each generated release |

## Suggested reading paths

### First-time setup

1. [Setup](./setup.md)
2. [Configuration](./configuration.md)
3. [Operations](./operations.md#startup-checklist)

### Code review or portfolio evaluation

1. [Architecture](./architecture.md)
2. [Development and releases](./development.md)
3. [Security and privacy](./security.md)

### Runtime diagnosis

1. [Operations](./operations.md#health-checks)
2. [Operations](./operations.md#troubleshooting)
3. [Configuration](./configuration.md#timeouts-and-polling)

Documentation should change with the behavior it describes. Configuration
changes should update `.env.example`, validation, tests, and the relevant guide
in the same change.
