from pathlib import Path
import hashlib,json,zipfile,datetime
root=Path.cwd()
files=[root/n for n in ['README.md','CLAUDE-INTEGRACION.md','THIRD-PARTY-NOTICES.txt','package.json','package-lock.json','index.html','app.js','AVATARES-AURA-DEMO.html','AVATARES-AURA-PREVIEW.mp4','AVATARES-AURA-VISTA.png']]
for folder in ['src','integration','assets','referencias','ant-onio-aprobado']:
 files.extend(p for p in (root/folder).rglob('*') if p.is_file())
files.extend(root/'tools'/n for n in ['build.mjs','qa.cjs','preview.cjs','validate.cjs','contracts.test.mjs','package.py'])
files.extend(p for p in (root/'qa').glob('*') if p.is_file() and p.suffix in ['.json','.png'])
validation=json.loads((root/'qa/gltf-validation.json').read_text())
runtime=json.loads((root/'qa/runtime-tests.json').read_text())
manifest={'name':'AURA · Avatares 3D','version':'1.0.0','built_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'repository_reviewed':'therealj94/ULTRON-APP','reviewed_commit':'794cc8369fa9c50600e283043217e6b55508d731','status':{'antonio':'Approved revision 2, unchanged GLB','claudio':'New 3D proposal','aura':'New refinement of selected Grafito · Orbe','deployment':'Not deployed','voice':'Not connected'},'runtime':runtime,'validation':{k:{'errors':v['issues']['numErrors'],'warnings':v['issues']['numWarnings']} for k,v in validation.items()},'files':[{'path':str(p.relative_to(root)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]}
(root/'MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');files.append(root/'MANIFEST.json')
out=root/'AVATARES-AURA-PARA-CLAUDE.zip'
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=8) as z:
 for p in files:z.write(p,'AVATARES-AURA/'+str(p.relative_to(root)))
with zipfile.ZipFile(out) as z:
 assert z.testzip() is None
 assert not any('node_modules' in n or '/frames/' in n for n in z.namelist())
print(json.dumps({'zip':out.name,'files':len(files),'bytes':out.stat().st_size,'validation':manifest['validation']}))
