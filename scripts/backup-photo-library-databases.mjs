// Run while the two PM2 services are stopped, before migration 6.
// Only copies SQLite files and their WAL/SHM companions; never prints environment secrets.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {copyFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {basename,isAbsolute,join,resolve} from 'node:path';

const processes=JSON.parse(execFileSync('pm2',['jlist'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
const planned=[];
for(const [name,kind,envName] of [['osp-indexer','indexer','OSP_INDEXER_DB'],['osp-sponsor','sponsor','OSP_SPONSOR_DB']]){
 const app=processes.find(p=>p.name===name);
 assert(app,`PM2 process ${name} was not found. Use your actual service names and database paths before migrating.`);
 const env=app.pm2_env;
 assert(env.status==='stopped',`Stop ${name} before taking a consistent backup.`);
 const network=env.OSP_NETWORK || env.env?.OSP_NETWORK || 'harbinger';
 const setting=env[envName] || env.env?.[envName] || join('data',`${kind}-${network}.sqlite`);
 assert(setting!==':memory:',`${name} uses an in-memory database and cannot be backed up.`);
 const cwd=env.pm_cwd || app.cwd;
 assert(cwd,`${name}: PM2 did not provide its working directory`);
 const candidates=isAbsolute(setting)?[setting]:[resolve(cwd,setting),resolve(cwd,'apps',kind,setting),resolve('apps',kind,setting),resolve(setting)];
 const databases=[...new Set(candidates)].filter(existsSync);
 assert(databases.length,`No database found for ${name}; check ${envName} and back up its actual file before migrating.`);
 for(const database of databases)planned.push({name,source:database});
}
const target=join(homedir(),'osp-backups',`photo-library-${new Date().toISOString().replace(/[:.]/g,'-')}`);
mkdirSync(target,{recursive:true,mode:0o700});
for(let i=0;i<planned.length;i++){
 const item=planned[i],directory=join(target,`${item.name}-${i}`);
 mkdirSync(directory,{mode:0o700});
 for(const suffix of ['', '-wal','-shm'])if(existsSync(item.source+suffix))copyFileSync(item.source+suffix,join(directory,basename(item.source)+suffix));
 item.backup=join(directory,basename(item.source));
}
writeFileSync(join(target,'databases.json'),JSON.stringify(planned,null,2),{mode:0o600});
console.log(`Database backups saved: ${target}`);
