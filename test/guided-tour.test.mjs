import test from 'node:test';
import assert from 'node:assert/strict';
import {readTourProgress,tourPosition,tourSteps,tourHighlightBounds} from '../dist/tour-steps.js';

test('tour resumes by stable step identity and ignores invalid or old progress',()=>{
  assert.equal(readTourProgress('{broken'),null);
  assert.equal(readTourProgress(JSON.stringify({version:0,status:'paused',step:'tasks'})),null);
  assert.equal(readTourProgress(JSON.stringify({version:1,status:'running',step:'tasks'})),null);
  assert.deepEqual(readTourProgress(JSON.stringify({version:1,status:'paused',step:'tasks'})),{status:'paused',index:tourSteps.findIndex(s=>s.id==='tasks')});
  assert.deepEqual(readTourProgress(JSON.stringify({version:1,status:'complete',step:'removed-step'})),{status:'complete',index:0});
});

test('tour places a card beside its target without covering it when space permits',()=>{
  const size={width:410,height:490},viewport={width:1440,height:900};
  for(const anchor of [{left:1200,right:1380,top:20,bottom:64,width:180,height:44},{left:100,right:260,top:790,bottom:830,width:160,height:40},{left:40,right:380,top:300,bottom:730,width:340,height:430}]){
    const p=tourPosition(anchor,size,viewport);
    assert.ok(p.left>=16&&p.top>=16);
    assert.ok(p.left+size.width<=viewport.width-16&&p.top+size.height<=viewport.height-16);
    const overlap=Math.max(0,Math.min(p.left+size.width,anchor.right)-Math.max(p.left,anchor.left))*Math.max(0,Math.min(p.top+size.height,anchor.bottom)-Math.max(p.top,anchor.top));
    assert.equal(overlap,0);
  }
});

test('tour remains inside a narrow viewport even with a missing or oversized target',()=>{
  const viewport={width:360,height:600},size={width:410,height:750};
  for(const target of [null,{left:-100,right:700,top:-200,bottom:900,width:800,height:1100}]){
    const p=tourPosition(target,size,viewport);
    assert.equal(p.left,16);assert.equal(p.top,16);
  }
});

test('context tips leave nearby form controls clickable when there is free space',()=>{
  const field={left:30,right:400,top:40,bottom:80,width:370,height:40};
  const actions={left:16,right:440,top:110,bottom:500};
  const size={width:410,height:300};
  const place=tourPosition(field,size,{width:1000,height:700},[field,actions]);
  for(const rect of [field,actions]){
    const overlap=Math.max(0,Math.min(place.left+size.width,rect.right)-Math.max(place.left,rect.left))*Math.max(0,Math.min(place.top+size.height,rect.bottom)-Math.max(place.top,rect.top));
    assert.equal(overlap,0);
  }
});

test('scrolling keeps the current side until moving avoids a blocked close control',()=>{
  const size={width:320,height:300},viewport={width:1400,height:900};
  let previous={side:'right',left:778,top:200};
  for(const top of [340,338,334,328]){
    const anchor={left:560,right:760,top,bottom:top+40,width:200,height:40};
    const position=tourPosition(anchor,size,viewport,[],previous);
    assert.equal(position.side,'right');
    assert.ok(Math.abs(position.top-previous.top)<20);
    previous=position;
  }
  const closeButton={left:800,right:850,top:300,bottom:340,weight:1000};
  const moved=tourPosition({left:560,right:760,top:328,bottom:368},size,viewport,[closeButton],previous);
  assert.notEqual(moved.side,'right');
});

test('a target leaving the scroll area keeps the tip in place and resize clamps it',()=>{
  const size={width:410,height:400},previous={side:'left',left:40,top:60};
  assert.deepEqual(tourPosition(null,size,{width:1440,height:900},[],previous),previous);
  assert.deepEqual(tourPosition(null,size,{width:360,height:380},[],previous),{side:'left',left:16,top:16});
});

test('a panel that fills its clipping area keeps all four highlight edges visible',()=>{
  const bounds={left:26,top:269,right:713,bottom:677};
  const outline=tourHighlightBounds(bounds,bounds);
  assert.ok(outline.left>bounds.left&&outline.top>bounds.top);
  assert.ok(outline.left+outline.width<bounds.right&&outline.top+outline.height<bounds.bottom);
  assert.ok(outline.width>bounds.right-bounds.left-20&&outline.height>bounds.bottom-bounds.top-20);
});

test('field highlights retain spacing and remain within the visible scroll area',()=>{
  const clip={left:20,top:150,right:1000,bottom:700};
  assert.deepEqual(tourHighlightBounds({left:100,top:200,right:500,bottom:240},clip),{left:95,top:195,width:410,height:50});
  const partial=tourHighlightBounds({left:100,top:680,right:500,bottom:730},clip);
  assert.ok(partial.top+partial.height<clip.bottom);
  assert.equal(tourHighlightBounds({left:100,top:710,right:500,bottom:750},clip),null);
});
