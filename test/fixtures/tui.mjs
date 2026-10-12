// Full-screen, input-driven TUI fixture. No timer writes and no heartbeat text.
const role=process.argv[2]||'Test agent';
let selected=0,lastAction='Ready for keyboard input';
const choices=['Task overview','Recent messages','Toolbox'];
process.stdin.setRawMode?.(true);process.stdin.resume();
process.stdout.write('\x1b[?1049h\x1b[?25l');
function draw(){
  const cols=process.stdout.columns||80,rows=process.stdout.rows||24;
  const content=[`HeloScrum · ${role}`,`Full-screen TUI fixture · ${cols}×${rows}`,'',...choices.map((c,i)=>(selected===i?'› ':'  ')+c),'',`Selected: ${choices[selected]}`,lastAction,'','↑/↓ navigate · Enter select · q quit'];
  process.stdout.write('\x1b[H\x1b[2J'+content.slice(0,rows).map((line,i)=>`\x1b[${i+1};1H${i===0?'\x1b[36;1m':'\x1b[0m'}${line.slice(0,Math.max(1,cols-1))}`).join('')+'\x1b[0m');
}
function close(){process.stdout.write('\x1b[?25h\x1b[?1049l');process.exit(0);}
process.stdin.on('data',data=>{const text=data.toString();if(text==='q'||text==='\u0003')return close();if(text==='\x1b[B')selected=(selected+1)%choices.length;else if(text==='\x1b[A')selected=(selected+choices.length-1)%choices.length;else if(text==='\r')lastAction='Opened '+choices[selected];else lastAction='Input received';draw();});
process.stdout.on('resize',draw);process.once('SIGTERM',close);draw();
