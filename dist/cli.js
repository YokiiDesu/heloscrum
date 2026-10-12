import {NativeTerminal} from './native-terminal.js';
const query=new URLSearchParams(location.search),taskId=query.get('task'),status=document.querySelector('#terminal-status');
if(taskId){document.title='HeloScrum — Native agent terminal';document.querySelector('.brand small').textContent='Native agent';document.querySelector('main').setAttribute('aria-label','Native agent terminal');document.querySelector('footer span').textContent='Direct CLI input · Native commands · Closing this tab detaches';}
const terminal=new NativeTerminal(document.querySelector('#terminal'),{taskId,project:query.get('project')||undefined,onState:(text,state)=>{status.textContent=text;status.dataset.state=state;}});
if(taskId&&query.get('commands')==='open')terminal.whenReady().then(()=>terminal.showCommands()).catch(()=>{});
