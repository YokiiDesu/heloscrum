import assert from 'node:assert/strict';
import {stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
export async function assertPrivate(file,mode=0o600){
  if(process.platform!=='win32'){assert.equal((await stat(file)).mode&0o777,mode);return;}
  const script=`$ErrorActionPreference='Stop'; $env:PSModulePath="$PSHOME\\Modules"; $acl=Get-Acl -LiteralPath $env:HELOSCRUM_ACL_TEST_PATH; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $rules=@($acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]) | ForEach-Object { @{sid=$_.IdentityReference.Value; allow=($_.AccessControlType -eq 'Allow'); rights=[int]$_.FileSystemRights} }); @{user=$sid; rules=$rules} | ConvertTo-Json -Depth 4 -Compress`;
  const {stdout}=await execute('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,env:{...process.env,HELOSCRUM_ACL_TEST_PATH:file}});
  const result=JSON.parse(stdout),allowed=new Set([result.user,'S-1-5-18','S-1-5-32-544']);
  assert(result.rules.some(rule=>rule.allow&&rule.sid===result.user&&(rule.rights&1)),'The current user must be able to read the private file');
  assert(result.rules.every(rule=>!rule.allow||allowed.has(rule.sid)),'Private file grants access to another Windows principal');
}
