# Third-party notices

Project code is licensed under MIT. Third-party dependencies keep their own
copyrights and licenses. Source archives do not bundle node_modules or a Python
environment; installation obtains the pinned dependency versions separately.

Direct dependencies:

- Model Context Protocol SDK (`@modelcontextprotocol/sdk`), MIT:
  <https://github.com/modelcontextprotocol/typescript-sdk>
- MCP Apps (`@modelcontextprotocol/ext-apps`), MIT:
  <https://github.com/modelcontextprotocol/ext-apps>
- Zod, MIT: <https://github.com/colinhacks/zod>
- psutil, BSD-3-Clause: <https://github.com/giampaolo/psutil>
- jsdom (development tests), MIT: <https://github.com/jsdom/jsdom>

The MCP transport and UI-resource wiring was adapted from OpenAI's Apps SDK
examples, MIT: <https://github.com/openai/openai-apps-sdk-examples>.
Copyright (c) 2025 OpenAI. The project README retains the source and quickstart links.

For the OpenAI example-derived portions, the MIT permission and disclaimer in
[LICENSE](LICENSE) apply with the preceding copyright notice retained.

`package-lock.json` records the Node dependency tree and available license
identifiers. Consult the installed distributions for complete transitive notices.
