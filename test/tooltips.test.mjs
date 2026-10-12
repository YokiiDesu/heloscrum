import test from 'node:test';
import assert from 'node:assert/strict';
import {tooltipPosition} from '../dist/tooltips.js';

test('tooltips prefer below the control and flip above a bottom-edge composer',()=>{
  const viewport={width:900,height:700},size={width:300,height:110};
  assert.deepEqual(tooltipPosition({left:250,top:100,bottom:140,width:160},size,viewport),{left:180,top:148,side:'bottom'});
  assert.deepEqual(tooltipPosition({left:250,top:620,bottom:660,width:160},size,viewport),{left:180,top:502,side:'top'});
});
test('long labels stay within the left and right viewport edges',()=>{
  const viewport={width:375,height:667},size={width:351,height:110};
  for(const left of [0,20,340]){
    const p=tooltipPosition({left,top:200,bottom:240,width:30},size,viewport);
    assert(p.left>=12);assert(p.left+size.width<=viewport.width-12);
    assert(p.top>=12);assert(p.top+size.height<=viewport.height-12);
  }
});
test('a tall tooltip uses available space without a negative screen position',()=>{
  const result=tooltipPosition({left:10,top:120,bottom:150,width:60},{width:296,height:280},{width:320,height:304});
  assert.equal(result.left,12);assert.equal(result.top,12);
});
