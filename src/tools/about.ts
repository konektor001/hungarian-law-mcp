/**
 * about — Server metadata, dataset statistics, and provenance.
 */

import type Database from '@ansvar/mcp-sqlite';

export interface AboutContext {
  version: string;
  fingerprint: string;
  dbBuilt: string;
}

function safeCount(db: InstanceType<typeof Database>, sql: string): number {
  try {
    const row = db.prepare(sql).get() as { count: number } | undefined;
    return row ? Number(row.count) : 0;
  } catch {
    return 0;
  }
}

export function getAbout(db: InstanceType<typeof Database>, context: AboutContext) {

  const euRefs = safeCount(db, 'SELECT COUNT(*) as count FROM eu_references');

  const stats: Record<string, number> = {
    documents: safeCount(db, 'SELECT COUNT(*) as count FROM legal_documents'),
    provisions: safeCount(db, 'SELECT COUNT(*) as count FROM legal_provisions'),
    definitions: safeCount(db, 'SELECT COUNT(*) as count FROM definitions'),
  };

  if (euRefs > 0) {
    stats.eu_documents = safeCount(db, 'SELECT COUNT(*) as count FROM eu_documents');
    stats.eu_references = euRefs;
  }

  let legislationStateDate = '2026-09-15';
  try {
    const row = db.prepare("SELECT value FROM db_metadata WHERE key = 'legislation_state_date'").get() as { value: string } | undefined;
    if (row?.value) legislationStateDate = row.value;
  } catch {}

  return {
    name: 'Hungarian Law MCP',
    version: context.version,
    jurisdiction: 'HU',
    description: 'Hungarian Law MCP — legislation via Model Context Protocol',
    stats,
    data_sources: [
      {
        name: 'Nemzeti Jogszabalytar (NJT)',
        url: 'https://njt.hu',
        authority: 'Ministry of Justice',
      },
    ],
    freshness: {
      legislation_state_date: legislationStateDate,
      database_built: context.dbBuilt,
      source_portal: 'Nemzeti Jogszabálytár (NJT - https://njt.hu)',
      note: `A Nemzeti Jogszabálytár folyamatosan frissülő hivatalos forrás, a legutóbbi hatályos jogszabályi állapot dátuma: ${legislationStateDate}.`,
    },
    disclaimer:
      'Ez egy kutatási és jogi segédeszköz. A hivatalos hiteles szöveg a Nemzeti Jogszabálytárban (njt.hu) érhető el.',
    network: {
      name: 'Ansvar MCP Network',
      open_law: 'https://ansvar.eu/open-law',
      directory: 'https://ansvar.ai/mcp',
    },
  };
}
