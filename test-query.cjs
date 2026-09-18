const Database = require('better-sqlite3');
const db = new Database('data/database.db', { readonly: true });

// Find EU directives associated with Ptk. (2013. évi V. törvény)
const res = db.prepare(`
  SELECT * FROM eu_references 
  WHERE hungarian_statute_id LIKE '%2013. évi V%' 
  OR hungarian_statute_id LIKE '%Ptk%'
`).all();

console.log("EU References for PTK:");
console.dir(res, {depth: null});

// Also search in texts for keywords
const textRes = db.prepare(`
  SELECT statute_id, provision_ref, title, content 
  FROM provisions 
  WHERE content LIKE '%irányelv%' AND content LIKE '%fogyaszt%'
  LIMIT 5
`).all();

console.log("\nProvisions mentioning irányelv and fogyasztó:");
console.dir(textRes, {depth: null});

const ptkRes = db.prepare(`
  SELECT statute_id, title 
  FROM statutes 
  WHERE title LIKE '%Polgári Törvénykönyv%'
`).all();

console.log("\nPTK record:");
console.dir(ptkRes, {depth: null});
