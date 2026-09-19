const fs=require('fs');
for(const l of fs.readFileSync('.env','utf8').split(/\r?\n/)){const m=/^([A-Z_]+)=(.+)$/.exec(l.trim());if(m&&!process.env[m[1]])process.env[m[1]]=m[2].trim();}
const {createClient}=require('@libsql/client');
(async()=>{
  const db=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN});
  const rows=(await db.execute('SELECT id,generated_at,sections FROM daily_reports ORDER BY id DESC LIMIT 6')).rows;
  for(const r of rows){
    let secs=[];try{secs=JSON.parse(r.sections||'[]')}catch{}
    const items=[];for(const s of secs)for(const it of (s.items||[]))items.push(it.score);
    const scored=items.filter(x=>typeof x==='number');
    const low=scored.filter(x=>x<30).length;
    console.log(`id=${r.id} ${r.generated_at} 条目=${items.length} 带分=${scored.length} min=${scored.length?Math.min(...scored):'n/a'} <30=${low}`);
  }
})().catch(e=>{console.error('ERR',e.message);process.exitCode=1});
