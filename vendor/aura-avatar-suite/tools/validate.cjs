// Valida con el glTF Validator de Khronos: el GLB aprobado de ANT-ONIO (intacto) y los GLB móviles
// de assets/movil/. Sale con error si hay errores o advertencias. Informe: qa/gltf-validation.json.
const fs=require('node:fs'),path=require('node:path'),validator=require('gltf-validator');
(async()=>{
 const raiz=path.join(__dirname,'..');
 const lista=[['ANT-ONIO (aprobado, original)','assets/ANT-ONIO.glb']];
 const movil=path.join(raiz,'assets/movil');
 if(fs.existsSync(movil))for(const f of fs.readdirSync(movil).filter(f=>f.endsWith('.glb')).sort())lista.push([f,'assets/movil/'+f]);
 const reports={};
 for(const [nombre,ruta] of lista){
  const abs=path.join(raiz,ruta);if(!fs.existsSync(abs)){console.log(nombre,'no existe');continue;}
  const report=await validator.validateBytes(new Uint8Array(fs.readFileSync(abs)),{uri:path.basename(ruta),maxIssues:200});
  reports[nombre]=report;console.log(nombre.padEnd(34),JSON.stringify({errores:report.issues.numErrors,avisos:report.issues.numWarnings,infos:report.issues.numInfos}));
  for(const m of report.issues.messages.filter(m=>m.severity<2).slice(0,8))console.log('   ',m.code,m.message,m.pointer||'');
 }
 fs.writeFileSync(path.join(raiz,'qa/gltf-validation.json'),JSON.stringify(reports,null,1));
 if(Object.values(reports).some(r=>r.issues.numErrors||r.issues.numWarnings))process.exitCode=1;
})();
