import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
const root=path.dirname(fileURLToPath(import.meta.url));
const read=name=>readFileSync(path.join(root,name),'utf8');
const catalogCheck=vm.createContext({window:{},URL,console});
vm.runInContext(read('course-catalog.js')+'\n'+read('model.js')+'\nwindow.CenterModel.createStore(()=>{});',catalogCheck);
const shared=readFileSync(path.join(root,'..','src','styles.css'),'utf8');
const themeEnd=shared.indexOf('* { box-sizing:');
if(themeEnd<0)throw new Error('Shared theme variables not found.');
const script=text=>text.replace(/<\/script/gi,'<\\/script');
const html=read('template.html')
  .replace('/* THEME */',()=>shared.slice(0,themeEnd))
  .replace('/* STYLES */',()=>read('app.css')+'\n'+read('gatech-theme.css'))
  .replace('/* CATALOG */',()=>script(read('course-catalog.js')))
  .replace('/* MODEL */',()=>script(read('model.js')))
  .replace('/* APP */',()=>script(read('app.js')));
if(/\/\* (THEME|STYLES|CATALOG|MODEL|APP) \*\//.test(html))throw new Error('Unresolved build placeholder.');
writeFileSync(path.join(root,'HCI-Information-Center-Final.html'),html);
console.log(`Built HCI-Information-Center-Final.html (${Math.round(Buffer.byteLength(html)/1024)} KB).`);
