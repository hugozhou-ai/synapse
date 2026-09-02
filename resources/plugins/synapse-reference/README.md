# Synapse Reference

This plugin exposes one read-only MCP tool for resolving explicit, immutable Synapse summary references.

It does not enumerate summaries, add a skill, or inject summary content at startup. Copy a reference from Synapse and paste it into a Codex prompt. Codex can then request the smallest useful view: metadata, abstract, outline, one Markdown section, or bounded full content.

The default database path is `~/Library/Application Support/Synapse/synapse.sqlite3`. Set `SYNAPSE_DATABASE_PATH` only for development or testing.
