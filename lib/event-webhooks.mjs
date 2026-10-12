import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import ipaddr from 'ipaddr.js';
import {Webhook} from 'standardwebhooks';

export function callbackURL(value){
  let url;try{url=new URL(value);}catch{throw Error('Invalid callback URL');}
  if(url.protocol!=='https:'||url.username||url.password||url.hash||(url.port&&url.port!=='443'))throw Error('Callback must be HTTPS on port 443 without credentials or fragment');
  return url;
}
export function publicAddress(address){
  try { const parsed=ipaddr.process(address);return parsed.range()==='unicast'; } catch{return false;}
}
export function signingSecret(value){
  if(typeof value!=='string'||!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(value))throw Error('Invalid webhook signing secret');
  const bytes=Buffer.from(value.slice(6),'base64');
  if(bytes.length<24||bytes.length>64||bytes.toString('base64').replace(/=+$/,'')!==value.slice(6).replace(/=+$/,''))throw Error('Webhook key must contain 24–64 bytes');
  return value;
}

// Resolve every connection, validate the entire answer set, and pin the actual
// connection while preserving the hostname for certificate verification/SNI.
export async function webhookFetch(target,{headers,body,signal},resolve=lookup){
  const url=callbackURL(target),hostname=url.hostname.replace(/^\[|\]$/g,'');
  const addresses=isIP(hostname)?[{address:hostname,family:isIP(hostname)}]:await resolve(hostname,{all:true,verbatim:true});
  if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw Error('Callback resolves to a non-public address');
  const address=addresses[0];
  return new Promise((accept,reject)=>{
    const req=https.request(url,{method:'POST',agent:false,signal,headers,lookup:(_host,options,done)=>options.all?done(null,[address]):done(null,address.address,address.family)},res=>{
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>64*1024){res.destroy(Error('Callback response is too large'));return;}chunks.push(chunk);});
      res.on('error',reject);res.on('end',()=>accept({status:res.statusCode,ok:res.statusCode>=200&&res.statusCode<300,json:async()=>JSON.parse(Buffer.concat(chunks).toString())}));
    });
    req.on('error',reject);req.end(body);
  });
}
export async function signedPost(subscription,eventId,value,fetcher=webhookFetch,now=Date.now()){
  const body=JSON.stringify(value);
  if(Buffer.byteLength(body)>256*1024)throw Error('Event payload exceeds 256 KiB');
  const time=new Date(now),keys=[subscription.secret,...(subscription.previousSecret&&subscription.previousSecretUntil>now?[subscription.previousSecret]:[])];
  const signature=keys.map(key=>new Webhook(key).sign(eventId,time,body)).join(' ');
  return fetcher(subscription.url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10_000),headers:{'Content-Type':'application/json','webhook-id':eventId,'webhook-timestamp':String(Math.floor(now/1000)),'webhook-signature':signature,'X-MCP-Subscription-Id':subscription.id},body});
}
