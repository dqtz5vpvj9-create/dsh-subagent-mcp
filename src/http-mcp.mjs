import {createServer} from 'node:http';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {join} from 'node:path';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {readJson, writeJson} from './platform.mjs';

// Stateless MCP: idle chats own no bridge process, server object or listener.
// A pending wait owns only its request and is cancelled when the caller leaves.
export async function startHttpMcp(state, makeServer) {
  const file=join(state,'http.json');
  const saved=readJson(file);
  const token=saved?.token??randomBytes(32).toString('hex');
  const expected=Buffer.from('Bearer '+token);
  const active=new Set();
  const listener=createServer(async(req,res)=>{
    const authority=`127.0.0.1:${listener.address().port}`;
    if(req.headers.host!==authority || (req.headers.origin&&req.headers.origin!==`http://${authority}`)) {
      res.writeHead(403).end();return;
    }
    const supplied=Buffer.from(req.headers.authorization??'');
    if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)) {
      res.writeHead(401).end();return;
    }
    if(req.url!=='/mcp'){res.writeHead(404).end();return;}
    // This service has no unsolicited notifications or retained HTTP sessions.
    if(req.method==='GET'||req.method==='DELETE'){res.writeHead(405).end();return;}
    if(req.method!=='POST'){res.writeHead(405).end();return;}
    const server=makeServer();
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    active.add(server);
    res.once('close',()=>{active.delete(server);server.close().catch(()=>{});});
    try {await server.connect(transport);await transport.handleRequest(req,res);}
    catch(error) {console.error('HTTP MCP request failed: '+error.message);if(!res.headersSent)res.writeHead(500).end();else res.end();}
  });
  listener.requestTimeout=0; // dsh_wait is intentionally unbounded.
  listener.headersTimeout=10000;
  listener.keepAliveTimeout=1000;
  await new Promise((resolve,reject)=>{
    listener.once('error',reject);
    listener.listen({host:'127.0.0.1',port:saved?.port??0},resolve);
  });
  writeJson(file,{port:listener.address().port,token});
  return {
    stats:()=>({requests:active.size}),
    close:async()=>{
      listener.close();
      await Promise.allSettled([...active].map(server=>server.close()));
      listener.closeAllConnections();
    },
  };
}
