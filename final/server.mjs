import http from 'node:http';
import {readFileSync} from 'node:fs';
const port=Number(process.env.PORT||43122);
http.createServer((request,response)=>{
  const url=new URL(request.url,`http://127.0.0.1:${port}`);
  if(url.pathname==='/health'){response.writeHead(200,{'Content-Type':'application/json'});response.end('{"ok":true,"app":"hci-final-candidate"}');return;}
  if(url.pathname==='/favicon.ico'){response.writeHead(204);response.end();return;}
  if(!['/','/HCI-Information-Center-Final.html'].includes(url.pathname)){response.writeHead(404);response.end('Not found');return;}
  response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'});
  response.end(readFileSync(new URL('HCI-Information-Center-Final.html',import.meta.url)));
}).on('error',error=>{console.error(error.message);process.exitCode=1;})
  .listen(port,'127.0.0.1',()=>console.log(`Information Center: http://127.0.0.1:${port}`));
