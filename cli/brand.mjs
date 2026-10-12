const letters={
  H:['█   █','█   █','█████','█   █','█   █'],
  E:['█████','█    ','████ ','█    ','█████'],
  L:['█    ','█    ','█    ','█    ','█████'],
  O:[' ███ ','█   █','█   █','█   █',' ███ '],
  S:[' ████','█    ',' ███ ','    █','████ '],
  C:[' ████','█    ','█    ','█    ',' ████'],
  R:['████ ','█   █','████ ','█  █ ','█   █'],
  U:['█   █','█   █','█   █','█   █',' ███ '],
  M:['█   █','██ ██','█ █ █','█   █','█   █']
};
export const terminalWordmark=Array.from({length:5},(_,row)=>({
  helo:[...'HELO'].map(letter=>letters[letter][row]).join(' '),
  scrum:[...'SCRUM'].map(letter=>letters[letter][row]).join(' ')
}));
export const terminalMark=['╷  ╭──╮','│     │','├─────┤','│     │','╰──╯  ╵'];
export const useLargeBrand=(columns,rows,plain=false)=>!plain&&columns>=96&&rows>=30;
