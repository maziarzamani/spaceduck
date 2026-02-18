# Security Policy

## Reporting a vulnerability

Please do not open a public GitHub issue for security vulnerabilities.

Report privately via **[GitHub Security Advisories](https://github.com/maziarzamani/spaceduck/security/advisories/new)**. This keeps the report confidential until a fix is ready.

Include in your report:

1. A clear title and severity assessment (critical / high / medium / low)
2. The affected component (gateway, memory, a specific channel, a tool)
3. Steps to reproduce with a working example
4. Demonstrated impact — what can an attacker actually do?
5. Your suggested remediation if you have one

Reports without reproduction steps and demonstrated impact will be deprioritized.

## Out of scope

The following are explicitly out of scope:

- **Prompt injection attacks.** Spaceduck processes untrusted text from messaging channels. The LLM may be influenced by adversarial input. This is a known characteristic of all LLM-based systems. Mitigating it entirely is not currently a goal.
- **Self-hosting exposure.** Running Spaceduck on a publicly exposed server without authentication is a misconfiguration, not a vulnerability. The intended deployment is local or behind a trusted network.
- **Model behavior.** Unexpected, offensive, or incorrect model outputs are not a security issue in this project.
- **Social engineering.** Attacks that require tricking the legitimate user of their own instance.

## Operational guidance

If you are running Spaceduck in a shared or semi-public environment:

- Run the gateway on loopback (`localhost`) and do not expose it directly to the internet
- Keep your `.env` file out of version control (it is gitignored by default)
- The `data/whatsapp-auth/` directory contains WhatsApp session credentials — keep it private and backed up
- Regularly rotate API keys if you use cloud providers (Gemini, OpenRouter, Bedrock)

## Supported versions

Only the latest release on `main` receives security fixes. There are no backport guarantees for older versions.
