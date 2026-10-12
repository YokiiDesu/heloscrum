// Presentation only: option values and provider requests retain the exact ID.
export function modelName(id,label){
  const value=label||id||'Provider default';
  const gpt=/^gpt-(\d+(?:\.\d+)?)(?:-([a-z]+(?:-[a-z]+)*))?$/i.exec(value);
  if(gpt)return 'GPT-'+gpt[1]+(gpt[2]?' '+gpt[2].split('-').map(word=>word[0].toUpperCase()+word.slice(1).toLowerCase()).join(' '):'');
  const claude=/^(?:claude-)?(opus|sonnet|haiku|fable)(?:-(\d+(?:[.-]\d{1,2})?))?(?:-\d{8})?$/i.exec(value);
  if(claude)return 'Claude '+claude[1][0].toUpperCase()+claude[1].slice(1).toLowerCase()+(claude[2]?' '+claude[2].replace('-','.'):'');
  return value;
}
