// Cursor's display timestamps contain an explicit offset in parentheses. V8
// treats those parentheses as a comment, so Date.parse alone uses the host TZ.
export function providerTimestamp(value) {
  const text=String(value||'').trim();
  const displayed=text.match(/^(?:[A-Za-z]+,\s*)?([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)\s*\(UTC(?:([+-])(\d{1,2})(?::(\d{2}))?)?\)$/i);
  if(displayed){
    const [,month,day,year,hour,minute,second='0',period,sign,offsetHour='0',offsetMinute='0']=displayed;
    const m=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(month.toLowerCase());
    if(m<0||+year<100||+hour<1||+hour>12||+minute>59||+second>59||+offsetHour>14||+offsetMinute>59||+offsetHour===14&&+offsetMinute!==0)return NaN;
    const h=+hour%12+(period.toUpperCase()==='PM'?12:0);
    const local=Date.UTC(+year,m,+day,h,+minute,+second),date=new Date(local);
    if(date.getUTCFullYear()!==+year||date.getUTCMonth()!==m||date.getUTCDate()!==+day)return NaN;
    return local-(sign==='-'?-1:1)*(+offsetHour*60+ +offsetMinute)*60000;
  }
  // Only accept fallback formats with a timezone. A missing/invalid offset is
  // unknown evidence, not permission to guess the developer machine's zone.
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)?Date.parse(text):NaN;
}
