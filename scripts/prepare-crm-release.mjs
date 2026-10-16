// Reviewable incremental package; never connects to or alters a database.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const root=new URL('../',import.meta.url);
const source=await readFile(new URL('supabase/migrations/004_commercial_crm.sql',root),'utf8');
const checks=await readFile(new URL('supabase/checks/stage_3_security.sql',root),'utf8');
if(!source.includes('BEGIN;')||!source.trimEnd().endsWith('COMMIT;'))throw new Error('Unexpected transaction boundaries');
const guard=`SELECT pg_advisory_xact_lock(70013);
DO $$ BEGIN IF to_regclass('public.user_functions') IS NULL OR to_regclass('public.crm_leads') IS NOT NULL THEN RAISE EXCEPTION 'CRM requires exact schema 003'; END IF; END $$;`;
const sql=source.replace('BEGIN;','BEGIN;\nSET LOCAL statement_timeout=\'120s\';\n'+guard).replace(/COMMIT;\s*$/,checks+'\nCOMMIT;\n');
const output=resolve(process.argv.find(v=>v.startsWith('--output='))?.slice(9)??'/tmp/ion-os-crm-release');
await mkdir(output,{recursive:true,mode:0o700});
await writeFile(resolve(output,'crm-release.sql'),sql,{mode:0o600});
await writeFile(resolve(output,'manifest.json'),JSON.stringify({from:'003',migration:'004_commercial_crm.sql',sha256:createHash('sha256').update(sql).digest('hex'),remote_execution:false},null,2)+'\n',{mode:0o600});
console.log('CRM SQL package prepared at '+output+'. No remote execution. Requires verified recovery.');
