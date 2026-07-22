# Hungarian Law MCP Server

<!-- ANSVAR-CTA-BEGIN -->
> **The Hungarian law corpus is now served through the Ansvar Gateway.** Connect your AI assistant (Claude, Copilot, Cursor, custom MCP client) to `https://gateway.ansvar.eu/mcp` — one OAuth connection, free tier available, covering this corpus plus EU regulations, national law across dozens of audited jurisdictions (Europe + the US), and CVE/security intelligence, every result with a verbatim source citation. Start at https://ansvar.eu/docs/quickstart

### Connect

**Claude Code** (one line):

```bash
claude mcp add ansvar --transport http https://gateway.ansvar.eu/mcp
```

**Claude Desktop / Cursor** — add to `claude_desktop_config.json` (or `mcp.json`):

```json
{
  "mcpServers": {
    "ansvar": {
      "type": "url",
      "url": "https://gateway.ansvar.eu/mcp"
    }
  }
}
```

**Claude.ai** — Settings → Connectors → Add custom connector → paste `https://gateway.ansvar.eu/mcp`

First request opens an OAuth signup flow (setup details: [ansvar.eu/docs/quickstart](https://ansvar.eu/docs/quickstart)). After signup, your client is bound to your account; tier (free / premium / team / company) determines fan-out, quota, and which downstream MCPs are reachable.

---

## Self-host this MCP

You can also clone this repo and build the corpus yourself. The schema,
fetcher, and tool implementations all live here. What is not in the repo is
the pre-built database — TDM and standards-licensing constraints on the
upstream sources mean we host the corpus on Ansvar infrastructure rather
than redistribute it as a public artifact.

Build your own: run this repo's ingestion script (entry-point varies per
repo — typically `scripts/ingest.sh`, `npm run ingest`, or `make ingest`;
check the repo root).
<!-- ANSVAR-CTA-END -->


**The Magyar Közlöny alternative for the AI age.**

[![MCP Registry](https://img.shields.io/badge/MCP-Registry-blue)](https://registry.modelcontextprotocol.io)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![GitHub stars](https://img.shields.io/github/stars/Ansvar-Systems/Hungarian-law-mcp?style=social)](https://github.com/Ansvar-Systems/Hungarian-law-mcp)
[![CI](https://github.com/Ansvar-Systems/Hungarian-law-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Ansvar-Systems/Hungarian-law-mcp/actions/workflows/ci.yml)
[![Daily Data Check](https://github.com/Ansvar-Systems/Hungarian-law-mcp/actions/workflows/check-updates.yml/badge.svg)](https://github.com/Ansvar-Systems/Hungarian-law-mcp/actions/workflows/check-updates.yml)
[![Database](https://img.shields.io/badge/database-pre--built-green)](docs/EU_INTEGRATION_GUIDE.md)
[![Provisions](https://img.shields.io/badge/provisions-130%2C124-blue)](docs/EU_INTEGRATION_GUIDE.md)

Query **4,314 Hungarian statutes** -- from the GDPR végrehajtási törvény and Büntető Törvénykönyv to the Polgári Törvénykönyv, Munka Törvénykönyve, and more -- directly from Claude, Cursor, or any MCP-compatible client.

If you're building legal tech, compliance tools, or doing Hungarian legal research, this is your verified reference database.

Built by [Ansvar Systems](https://ansvar.eu) -- Stockholm, Sweden

---

## Why This Exists

Hungarian legal research is scattered across njt.hu (Nemzeti Jogszabálytár), Magyar Közlöny publications, and EUR-Lex. Whether you're:
- A **lawyer** validating citations in a brief or contract
- A **compliance officer** checking if a statute is still in force
- A **legal tech developer** building tools on Hungarian law
- A **researcher** tracing legislative provisions across 4,314 statutes

...you shouldn't need dozens of browser tabs and manual cross-referencing. Ask Claude. Get the exact provision. With context.

This MCP server makes Hungarian law **searchable, cross-referenceable, and AI-readable**.

---

## Example Queries

Once connected, just ask naturally:

- *"Keresés 'adatvédelem' -- milyen kötelezettségeket állapít meg a GDPR végrehajtási törvény?"*
- *"Hatályban van-e a Büntető Törvénykönyv 370. §-a?"*
- *"Találj rendelkezéseket a munkavállalók védelméről a Munka Törvénykönyvében"*
- *"Melyik uniós irányelvet ültette át a Polgári Törvénykönyv fogyasztóvédelmi fejezete?"*
- *"Melyik magyar törvények ültetik át a GDPR-t?"*
- *"Ellenőrizd a hivatkozást: Btk. 370. § (1) bek."*
- *"Állíts össze jogi álláspontot az adatvédelmi incidensek bejelentési kötelezettségéről"*
- *"Megfelel-e a magyar kibervédelmi törvény a NIS2 irányelv követelményeinek?"*

---

## What's Included

| Category | Count | Details |
|----------|-------|---------|
| **Statutes** | 4,314 statutes | Comprehensive Hungarian legislation from njt.hu |
| **Provisions** | 130,124 sections | Full-text searchable with FTS5 |
| **Case Law** | 11,519 decisions | Court decisions (premium tier) |
| **EU Cross-References** | Included | Directives and regulations linked to Hungarian transpositions |
| **Database Size** | 282 MB | Optimized SQLite, portable |
| **Daily Updates** | Automated | Freshness checks against njt.hu |

**Verified data only** -- every citation is validated against official sources (njt.hu, Magyar Közlöny). Zero LLM-generated content.

---

## See It In Action

### Why This Works

**Verbatim Source Text (No LLM Processing):**
- All statute text is ingested from njt.hu (Nemzeti Jogszabálytár) official sources
- Provisions are returned **unchanged** from SQLite FTS5 database rows
- Zero LLM summarization or paraphrasing -- the database contains statute text, not AI interpretations

**Smart Context Management:**
- Search returns ranked provisions with BM25 scoring (safe for context)
- Provision retrieval gives exact text by statute identifier + section
- Cross-references help navigate without loading everything at once

**Technical Architecture:**
```
njt.hu API → Parse → SQLite → FTS5 snippet() → MCP response
               ↑                     ↑
        Provision parser      Verbatim database query
```

### Traditional Research vs. This MCP

| Traditional Approach | This MCP Server |
|---------------------|-----------------|
| Search njt.hu by statute title | Search by plain Hungarian: *"személyes adat hozzájárulás"* |
| Navigate multi-section statutes manually | Get the exact provision with context |
| Manual cross-referencing between laws | `build_legal_stance` aggregates across sources |
| "Is this statute still in force?" → check manually | `check_currency` tool → answer in seconds |
| Find EU basis → dig through EUR-Lex | `get_eu_basis` → linked EU directives instantly |
| Check multiple sites for updates | Daily automated freshness checks |
| No API, no integration | MCP protocol → AI-native |

**Traditional:** Search njt.hu → Download PDF → Ctrl+F → Cross-reference → Check EUR-Lex for EU basis → Repeat

**This MCP:** *"Melyik GDPR-cikk ültette át a különleges adatkezelési kategóriákra vonatkozó 9. §-t?"* → Done.

---

## Available Tools (13)

### Core Legal Research Tools (8)

| Tool | Description |
|------|-------------|
| `search_legislation` | FTS5 full-text search across 130,124 provisions with BM25 ranking |
| `get_provision` | Retrieve specific provision by statute identifier + section/paragraph |
| `validate_citation` | Validate citation against database -- zero-hallucination check |
| `build_legal_stance` | Aggregate citations from multiple statutes for a legal topic |
| `format_citation` | Format citations per Hungarian conventions (full/short/pinpoint) |
| `check_currency` | Check if statute is in force, amended, or repealed |
| `list_sources` | List all available statutes with metadata and data provenance |
| `about` | Server info, capabilities, dataset statistics, and coverage summary |

### EU Law Integration Tools (5)

| Tool | Description |
|------|-------------|
| `get_eu_basis` | Get EU directives/regulations that underpin a Hungarian statute |
| `get_hungarian_implementations` | Find Hungarian laws implementing a specific EU act |
| `search_eu_implementations` | Search EU documents with Hungarian implementation counts |
| `get_provision_eu_basis` | Get EU law references for a specific provision |
| `validate_eu_compliance` | Check implementation status of Hungarian statutes against EU directives |

---

## EU Law Integration

Hungary is an EU member state. Hungarian legislation directly transposes EU directives and implements EU regulations, creating a traceable mapping between Hungarian and EU law.

Key areas of EU-Hungarian law alignment:

- **GDPR (2016/679)** -- implemented via the 2018. évi XXXVIII. törvény (információs önrendelkezési jogról és az információszabadságról szóló törvény módosítása)
- **NIS2 Directive (2022/2555)** -- transposed into Hungarian cybersecurity legislation (kibervédelmi törvény)
- **eIDAS Regulation (910/2014)** -- applicable directly; supplemented by Hungarian electronic identification rules
- **DORA (2022/2554)** -- digital operational resilience obligations for the financial sector
- **AI Act (2024/1689)** -- EU regulation applicable directly across all member states
- **Consumer Protection Directives** -- implemented via the Fogyasztóvédelmi törvény

The EU bridge tools provide bi-directional lookup: find which Hungarian statutes implement a given EU act, or find which EU acts underpin a given Hungarian provision.

| Metric | Value |
|--------|-------|
| **EU Member State** | Since 2004 |
| **Legal System** | Civil law (continental European tradition) |
| **Official Gazette** | Magyar Közlöny (magyarkozlony.hu) |
| **Legislation Repository** | Nemzeti Jogszabálytár (njt.hu) |
| **EUR-Lex Integration** | Automated metadata fetching |

See [EU_INTEGRATION_GUIDE.md](docs/EU_INTEGRATION_GUIDE.md) for detailed documentation.

---

## Data Sources & Freshness

All content is sourced from authoritative Hungarian legal databases:

- **[njt.hu](https://njt.hu/)** -- Nemzeti Jogszabálytár (National Legislation Repository), the official consolidated Hungarian legal database
- **[Magyar Közlöny](https://magyarkozlony.hu/)** -- Official Gazette (primary legislative publication)
- **[EUR-Lex](https://eur-lex.europa.eu/)** -- Official EU law database (metadata only)

### Automated Freshness Checks (Daily)

A [daily GitHub Actions workflow](.github/workflows/check-updates.yml) monitors all data sources:

| Source | Check | Method |
|--------|-------|--------|
| **Statute amendments** | njt.hu API date comparison | All 4,314 statutes checked |
| **New statutes** | Magyar Közlöny publications (90-day window) | Diffed against database |
| **EU reference staleness** | Git commit timestamps | Flagged if >90 days old |

---

## Security

This project uses multiple layers of automated security scanning:

| Scanner | What It Does | Schedule |
|---------|-------------|----------|
| **CodeQL** | Static analysis for security vulnerabilities | Weekly + PRs |
| **Semgrep** | SAST scanning (OWASP top 10, secrets, TypeScript) | Every push |
| **Gitleaks** | Secret detection across git history | Every push |
| **Trivy** | CVE scanning on filesystem and npm dependencies | Daily |
| **Docker Security** | Container image scanning + SBOM generation | Daily |
| **Socket.dev** | Supply chain attack detection | PRs |
| **OSSF Scorecard** | OpenSSF best practices scoring | Weekly |
| **Dependabot** | Automated dependency updates | Weekly |

See [SECURITY.md](SECURITY.md) for the full policy and vulnerability reporting.

---

## Important Disclaimers

### Legal Advice

> **THIS TOOL IS NOT LEGAL ADVICE**
>
> Statute text is sourced from official njt.hu/Magyar Közlöny publications. However:
> - This is a **research tool**, not a substitute for professional legal counsel
> - **Verify critical citations** against primary sources for court filings
> - **EU cross-references** are extracted from Hungarian statute text, not EUR-Lex full text
> - **Always confirm** current in-force status via njt.hu before relying on a provision professionally

**Before using professionally, read:** [DISCLAIMER.md](DISCLAIMER.md) | [PRIVACY.md](PRIVACY.md)

### Client Confidentiality

Queries go through the Claude API. For privileged or confidential matters, use on-premise deployment. See [PRIVACY.md](PRIVACY.md) for Magyar Ügyvédi Kamara (Hungarian Bar Association) compliance guidance.

---

## Documentation

- **[EU Integration Guide](docs/EU_INTEGRATION_GUIDE.md)** -- Detailed EU cross-reference documentation
- **[EU Usage Examples](docs/EU_USAGE_EXAMPLES.md)** -- Practical EU lookup examples
- **[Security Policy](SECURITY.md)** -- Vulnerability reporting and scanning details
- **[Disclaimer](DISCLAIMER.md)** -- Legal disclaimers and professional use notices
- **[Privacy](PRIVACY.md)** -- Client confidentiality and data handling

---

## Development

### Setup

```bash
git clone https://github.com/Ansvar-Systems/Hungarian-law-mcp
cd Hungarian-law-mcp
npm install
npm run build
npm test
```

### Running Locally

```bash
npm run dev                                       # Start MCP server
npx @anthropic/mcp-inspector node dist/index.js   # Test with MCP Inspector
```

### Data Management

```bash
npm run ingest              # Ingest statutes from njt.hu
npm run build:db            # Rebuild SQLite database
npm run check-updates       # Check for amendments and new statutes
```

### Performance

- **Search Speed:** <100ms for most FTS5 queries
- **Database Size:** 282 MB (comprehensive corpus)
- **Reliability:** 100% ingestion success rate

---

## More Ansvar MCPs

Full fleet coverage at [ansvar.eu/coverage](https://ansvar.eu/coverage).
## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Priority areas:
- Court case law expansion (Kúria, Constitutional Court)
- EU Regulations MCP integration (full EU law text, CJEU case law)
- Historical statute versions and amendment tracking
- Government decrees (kormányrendeletek) expansion

---

## Roadmap

- [x] Core statute database with FTS5 search
- [x] Full corpus ingestion (4,314 statutes, 130,124 provisions)
- [x] Case law database (11,519 decisions, premium tier)
- [x] EU law integration tools
- [x] Vercel Streamable HTTP deployment

- [x] Daily freshness checks
- [ ] Case law expansion (Kúria full archive)
- [ ] Historical statute versions (amendment tracking)
- [ ] Government decree expansion

---

## Citation

If you use this MCP server in academic research:

```bibtex
@software{hungarian_law_mcp_2026,
  author = {Ansvar Systems AB},
  title = {Hungarian Law MCP Server: Production-Grade Legal Research Tool},
  year = {2026},
  url = {https://github.com/Ansvar-Systems/Hungarian-law-mcp},
  note = {Comprehensive Hungarian legal database with 4,314 statutes and 130,124 provisions}
}
```

---

## License

Apache License 2.0. See [LICENSE](./LICENSE) for details.

### Data Licenses

Ansvar attribution code: **`Hungarian-Szjt-Section-1-4`**. Basis: Szjt.
(Act LXXVI of 1999 on Copyright) §1(4) — broad statutory-PD carve-out
for legislative and administrative materials.

- **Statutes & Legislation:** Nemzeti Jogszabálytár (NJT) — canonical
  portal at [`njt.jog.gov.hu`](https://njt.jog.gov.hu) (migrated from
  `njt.hu`). Reused under Szjt. §1(4).
- **EU Metadata:** EUR-Lex (EU public-domain notice).

### Coverage scope

Hungarian Szjt. §1(4) is a broad statutory-PD carve-out covering
legislative acts, administrative acts, official decisions, and other
official documents.

See `docs/audits/2026-05-17-eu-copyright-statutory-works-batch-2-HU-LU-PT-RO-GR.md`
in the Ansvar architecture-documentation repo for the verbatim §1(4)
text and the coverage analysis.

---

## About Ansvar Systems

We build AI-accelerated compliance and legal research tools for the European market. This MCP server started as our internal reference tool for Hungarian law -- turns out everyone building for the Hungarian and Central European markets has the same research frustrations.

So we're open-sourcing it. Navigating 4,314 statutes shouldn't require a law degree.

**[ansvar.eu](https://ansvar.eu)** -- Stockholm, Sweden

---

<p align="center">
  <sub>Built with care in Stockholm, Sweden</sub>
</p>
