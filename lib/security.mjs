export function validRequest(req,port){
  const hosts=[`127.0.0.1:${port}`,`localhost:${port}`];
  if(!hosts.includes(req.headers.host))return false;
  if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return false;
  return !['cross-site','same-site'].includes(req.headers['sec-fetch-site']);
}
