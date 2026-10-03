// Starts a preview with its own SQLite database; never uses the source DB as DB_PATH.
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const Database = require('better-sqlite3');
const root=path.resolve(__dirname,'..');
const previewDir=path.join(root,'.preview');
const target=path.join(previewDir,'nfl-pickem.db');
const index=process.argv.indexOf('--source-db');
const source= index>=0 ? process.argv[index+1] : process.env.PREVIEW_SOURCE_DB;
(async()=>{
    if(fs.existsSync(previewDir) && fs.lstatSync(previewDir).isSymbolicLink()) throw new Error('Preview directory must not be a symlink.');
    fs.mkdirSync(previewDir,{recursive:true});
    if(source) {
        const sourcePath=fs.realpathSync(source);
        if(path.resolve(sourcePath)===path.resolve(target) || (fs.existsSync(target) && (fs.realpathSync(target)===sourcePath || (fs.statSync(target).ino===fs.statSync(sourcePath).ino && fs.statSync(target).dev===fs.statSync(sourcePath).dev)))) throw new Error('Preview source and target must be different files.');
    }
    if(fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('Preview database must not be a symlink.');
    if(!fs.existsSync(target) && source) {
        const db=new Database(fs.realpathSync(source),{readonly:true,fileMustExist:true});
        try {await db.backup(target);}finally{db.close();}
        console.log('Created a consistent snapshot for preview. The source database stays read-only.');
    }
    const host=process.env.HOST || '127.0.0.1',port=process.env.PORT || '3101';
    if(String(port)==='3000') throw new Error('Port 3000 is reserved for the live app. Choose a separate preview port.');
    console.log(`Preview: http://${host}:${port}; database: ${target}`);
    const child=fork(path.join(root,'server.js'),[],{cwd:root,env:{...process.env,HOST:host,PORT:port,DB_PATH:target,APP_PREVIEW:'1',INSIGHTS_CACHE_DIR:path.join(previewDir,'insights-cache')},stdio:'inherit'});
    for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill('SIGINT'));
    child.on('exit',code=>process.exit(code || 0));
})().catch(error=>{console.error(error.message);process.exit(1);});
